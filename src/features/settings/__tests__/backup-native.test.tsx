// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { replaceAllData } from '@/db/backup'
import { db } from '@/db/db'
import type { BackupData } from '@/domain/schema'
import { ledgerK, shiftIds } from '@/domain/__tests__/backup-merge-fixtures'
import { createItem } from '@/db/repositories/items'
import { getAppState } from '@/db/repositories/settings'

// Vỏ APK: plugin `DownloadFile` thay cho `<a download>`. Robot lái đường này bằng cầu nối giả; ở đây
// khoá luật đóng dấu mốc sao lưu theo kết quả plugin.
const cap = vi.hoisted(() => ({
  saveToDownloads: vi.fn<
    (o: { filename: string; mimeType: string; text: string }) => Promise<{ displayName: string; relativePath: string }>
  >(),
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({ saveToDownloads: cap.saveToDownloads }),
}))

import { downloadPreparedBackup, downloadRecoveryBackup, prepareBackup } from '../backup'
import { SaoLuuPage } from '../sao-luu-page'

const NOW = new Date(2026, 7, 7, 14, 0).getTime()

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  localStorage.clear()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  await createItem({ name: 'Phở', groupId: null, unit: 'tô', unitPrice: 50_000, costPrice: null, isActive: 1 })
})

afterEach(() => {
  cleanup()
  cap.saveToDownloads.mockReset()
  vi.restoreAllMocks()
})

describe('sao lưu trong APK', () => {
  it('plugin lưu xong ⇒ trả tên thật, đóng dấu mốc, không bấm <a download>', async () => {
    cap.saveToDownloads.mockResolvedValue({ displayName: 'my-biller-backup-260807-1400 (1).json', relativePath: 'Download/' })
    const prepared = await prepareBackup(NOW)

    const outcome = await downloadPreparedBackup(prepared)

    expect(cap.saveToDownloads).toHaveBeenCalledWith({
      filename: 'my-biller-backup-260807-1400.json',
      mimeType: 'application/json',
      text: prepared.text,
    })
    expect(outcome).toMatchObject({ savedAs: 'my-biller-backup-260807-1400 (1).json', location: 'Download/', verified: true })
    expect((await getAppState()).lastBackupAt).toBe(NOW)
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
  })

  it('plugin báo lỗi ⇒ ném, KHÔNG đóng dấu mốc sao lưu', async () => {
    cap.saveToDownloads.mockRejectedValue(new Error('Chưa lưu được file vào thư mục Tải về: đĩa đầy'))
    const prepared = await prepareBackup(NOW)

    await expect(downloadPreparedBackup(prepared)).rejects.toThrow('đĩa đầy')
    expect((await getAppState()).lastBackupAt).toBeNull()
  })

  it('đường cứu hộ không bao giờ đóng dấu, kể cả khi plugin lưu xong', async () => {
    cap.saveToDownloads.mockResolvedValue({ displayName: 'x.json', relativePath: 'Download/' })

    await downloadRecoveryBackup(await prepareBackup(NOW))

    expect((await getAppState()).lastBackupAt).toBeNull()
  })

  it('màn sao lưu nói "Đã lưu" kèm nơi và tên thật; lỗi plugin hiện báo động và màn vẫn ghi chưa sao lưu', async () => {
    cap.saveToDownloads.mockResolvedValueOnce({ displayName: 'my-biller-backup-260807-1400 (2).json', relativePath: 'Download/' })
    render(
      <MemoryRouter>
        <SaoLuuPage />
      </MemoryRouter>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'SAO LƯU RA FILE' }))
    expect(await screen.findByText('Đã lưu: Download/my-biller-backup-260807-1400 (2).json.')).toBeDefined()

    cap.saveToDownloads.mockRejectedValueOnce(new Error('Chưa cho phép ghi vào bộ nhớ, nên chưa lưu được file.'))
    await db.settings.clear()
    await userEvent.click(screen.getByRole('button', { name: 'SAO LƯU RA FILE' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/Chưa cho phép ghi vào bộ nhớ/)
    expect(await screen.findByText('Chưa sao lưu lần nào')).toBeDefined()
    expect(screen.queryByText(/^Đã lưu:/)).toBeNull()
  })
})

describe('gộp trong APK', () => {
  const fileText = (data: BackupData) =>
    JSON.stringify({ app: 'my-biller', version: 4, appVersion: '2.11.0', exportedAt: new Date(NOW).toISOString(), data })

  async function openMergeAndAnswer() {
    const device = ledgerK()
    device.payments[0] = { ...device.payments[0]!, unallocatedStatus: 'refunded' }
    await db.items.clear()
    await replaceAllData(device)
    render(
      <MemoryRouter>
        <SaoLuuPage />
      </MemoryRouter>,
    )
    fireEvent.change(await screen.findByLabelText('Chọn file sao lưu'), {
      target: { files: [new File([fileText(shiftIds(ledgerK(), 10))], 'ban-sao.json', { type: 'application/json' })] },
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Gộp vào sổ trên máy' }))
    const card = (await screen.findByRole('dialog', { name: 'Gộp file vào sổ trên máy' })).querySelector<HTMLElement>(
      `[data-conflict-gid="${device.payments[0]!.gid}"]`,
    )!
    await userEvent.click(within(card).getByLabelText('Lấy bản trong file'))
    return device
  }

  it('plugin lưu file an toàn xong ⇒ gộp luôn, không có cửa "Đã thấy file"', async () => {
    const reload = vi.fn()
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } })
    cap.saveToDownloads.mockResolvedValue({ displayName: 'an-toan.json', relativePath: 'Download/' })
    const device = await openMergeAndAnswer()

    await userEvent.click(screen.getByRole('button', { name: 'GỘP' }))

    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(screen.queryByRole('alertdialog', { name: 'Đã thấy file an toàn trong Tải về?' })).toBeNull()
    expect(cap.saveToDownloads).toHaveBeenCalledTimes(1)
    expect((await db.payments.get(device.payments[0]!.id))?.unallocatedStatus ?? 'pending').toBe('pending')
  })

  it('file an toàn không nhập lại được ⇒ hỏi "Bản sao an toàn KHÔNG nhập lại được" trước khi ghi', async () => {
    const reload = vi.fn()
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } })
    cap.saveToDownloads.mockResolvedValue({ displayName: 'an-toan.json', relativePath: 'Download/' })
    const device = await openMergeAndAnswer()
    await db.items.add({ gid: '00000000-0000-4000-8000-000000000999', name: 'Hàng lạ', groupId: null, unit: '', unitPrice: 25_500.5, costPrice: null, isActive: 1, note: '', createdAt: 1, updatedAt: 1 })

    await userEvent.click(screen.getByRole('button', { name: 'GỘP' }))

    const accept = await screen.findByRole('alertdialog', { name: 'Bản sao an toàn KHÔNG nhập lại được' })
    expect((await db.payments.get(device.payments[0]!.id))?.unallocatedStatus).toBe('refunded')
    await userEvent.click(within(accept).getByRole('button', { name: 'Vẫn gộp — mất cũng được' }))

    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect((await db.payments.get(device.payments[0]!.id))?.unallocatedStatus ?? 'pending').toBe('pending')
  })

  it('plugin báo lỗi khi lưu file an toàn ⇒ báo lỗi, không ghi gì', async () => {
    const reload = vi.fn()
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } })
    cap.saveToDownloads.mockRejectedValue(new Error('Chưa lưu được file vào thư mục Tải về: đĩa đầy'))
    const device = await openMergeAndAnswer()

    await userEvent.click(screen.getByRole('button', { name: 'GỘP' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/đĩa đầy/)
    expect((await db.payments.get(device.payments[0]!.id))?.unallocatedStatus).toBe('refunded')
    expect(reload).not.toHaveBeenCalled()
  })
})
