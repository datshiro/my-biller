// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MergePreviewSheet } from '../merge-preview-sheet'
import { SaoLuuPage } from '../sao-luu-page'
import { saveRestoreReport, type StoredRestoreReport } from '../restore-report-store'
import { collectBackup, replaceAllData } from '@/db/backup'
import type { PaymentChoice } from '@/domain/backup-merge'
import type { BackupData } from '@/domain/schema'
import { ledgerK, mk, shiftIds } from '@/domain/__tests__/backup-merge-fixtures'
import { db } from '@/db/db'
import { createItem } from '@/db/repositories/items'
import { installTestDevice, testGid } from '@/test-fixtures'

const NOW = new Date(2026, 7, 7, 14, 0).getTime()

const connectionRow = {
  key: 'connection' as const,
  shopId: testGid(500),
  token: 'token-thu-nghiem-du-dai-cho-ket-noi-1234567890',
  syncUrl: 'https://sync.example.com',
}
const pairingRow = {
  key: 'pairing' as const,
  attemptId: testGid(501),
  hasLocalLedger: false,
  localLedgerRows: 0,
  connectionSaved: false,
  expiresAt: NOW + 60_000,
}
const writeBlockRow = { key: 'writeBlock' as const, reason: 'revoked' as const, shopId: null, createdAt: 1 }

let reload: ReturnType<typeof vi.fn>

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await installTestDevice()
  sessionStorage.clear()
  localStorage.clear()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  reload = vi.fn()
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const renderPage = () =>
  render(
    <MemoryRouter>
      <SaoLuuPage />
    </MemoryRouter>,
  )

const seedItem = (name = 'Phở') =>
  createItem({ name, groupId: null, unit: 'tô', unitPrice: 50_000, costPrice: null, isActive: 1 })

const pick = async (contents: string, name = 'backup.json') =>
  fireEvent.change(await screen.findByLabelText('Chọn file sao lưu'), {
    target: { files: [new File([contents], name, { type: 'application/json' })] },
  })

const pickOverwrite = async (contents: string, name = 'backup.json') => {
  await pick(contents, name)
  await userEvent.click(await screen.findByRole('button', { name: 'Ghi đè' }))
}

describe('máy bị chặn khôi phục thấy vì sao và đường đang có', () => {
  it('đã ghép: lời giải thích + Kéo lại từ đầu, không có nút nhập', async () => {
    await db.deviceState.put(connectionRow)
    renderPage()

    expect(await screen.findByText(/Máy này đã ghép sổ chung/)).toBeDefined()
    expect(screen.getByText(/làm trên một máy chưa ghép/)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Kéo lại từ đầu' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Nhập từ file sao lưu' })).toBeNull()
    expect(screen.queryByText(/huỷ ghép/i)).toBeNull()
  })

  it('đang ghép: bảo chờ ghép xong, không có nút nhập lẫn Kéo lại', async () => {
    await db.deviceState.put(pairingRow)
    renderPage()

    expect(await screen.findByText(/Máy đang ghép vào sổ chung/)).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Nhập từ file sao lưu' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Kéo lại từ đầu' })).toBeNull()
  })

  it('bị thu hồi: chỉ đường ghép lại', async () => {
    await db.deviceState.put(writeBlockRow)
    renderPage()

    expect(await screen.findByText(/Máy này đã bị thu hồi khỏi sổ chung/)).toBeDefined()
    expect(screen.getByText(/Cài đặt › Máy bán hàng/)).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Nhập từ file sao lưu' })).toBeNull()
  })

  it('ghép lại máy đã bị thu hồi ⇒ câu đang ghép (đang ghép đứng trước)', async () => {
    await db.deviceState.bulkPut([writeBlockRow, pairingRow])
    renderPage()

    expect(await screen.findByText(/Máy đang ghép vào sổ chung/)).toBeDefined()
    expect(screen.queryByText(/bị thu hồi/)).toBeNull()
  })

  it('ghép bắt đầu ở tab khác ⇒ nút nhập biến mất ngay (đọc live)', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: 'Nhập từ file sao lưu' })).toBeDefined()

    await db.deviceState.put(pairingRow)

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Nhập từ file sao lưu' })).toBeNull())
    expect(await screen.findByText(/Máy đang ghép vào sổ chung/)).toBeDefined()
  })

  it('khoá ghi chặn giữa chừng (đua giữa hai tab) ⇒ hiện câu giải thích, không phải câu kỹ thuật', async () => {
    await seedItem()
    const file = await collectBackup(NOW)
    renderPage()

    await pickOverwrite(JSON.stringify(file))
    await userEvent.click(await screen.findByRole('button', { name: 'Tải file an toàn' }))
    await screen.findByRole('button', { name: 'Đã thấy — ghi đè' })
    await db.deviceState.put(connectionRow)
    await userEvent.click(screen.getByRole('button', { name: 'Đã thấy — ghi đè' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/Máy này đã ghép sổ chung/)
    expect(screen.queryByText(/không thể nhập file sao lưu từ đây/)).toBeNull()
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('ghi đè có xem trước và báo cáo đối chiếu', () => {
  it('hộp xác nhận nói cả số trong file lẫn số đang có trên máy', async () => {
    await seedItem()
    const file = await collectBackup(NOW)
    await seedItem('Bún')
    renderPage()

    await pickOverwrite(JSON.stringify(file))

    const dialog = await screen.findByRole('alertdialog', { name: 'Ghi đè toàn bộ dữ liệu?' })
    expect(dialog.textContent).toMatch(/File có 0 đơn · 1 mặt hàng/)
    expect(dialog.textContent).toMatch(/Đang có trên máy: 0 đơn · 2 mặt hàng/)
    expect(await db.items.count()).toBe(2)
  })

  it('ghi đè xong lưu báo cáo vào sessionStorage rồi mới tải lại trang', async () => {
    await seedItem()
    const file = await collectBackup(NOW)
    await seedItem('Bún')
    renderPage()

    await pickOverwrite(JSON.stringify(file), 'ban-sao-cu.json')
    await userEvent.click(await screen.findByRole('button', { name: 'Tải file an toàn' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Đã thấy — ghi đè' }))

    await waitFor(() => expect(reload).toHaveBeenCalled())
    const stored = JSON.parse(sessionStorage.getItem('my-biller.restore-report') ?? 'null') as StoredRestoreReport
    expect(stored).toMatchObject({ mode: 'overwrite', sourceName: 'ban-sao-cu.json', report: { ok: true } })
    expect(stored.safety?.savedAs).toBe('my-biller-backup-260807-1400.json')
  })
})

describe('thẻ báo cáo sau khôi phục', () => {
  const stored = (over: Partial<StoredRestoreReport['report']> = {}): StoredRestoreReport => ({
    mode: 'overwrite',
    sourceName: 'ban-sao-cu.json',
    safety: { savedAs: 'an-toan.json', location: 'Tải về (Download)' },
    codeChanges: 0,
    report: {
      ok: true,
      overpaidOrders: 0,
      rows: [
        { key: 'orders', label: 'Đơn', expected: 2, actual: 2, matches: true },
        { key: 'debtTotal', label: 'Tổng nợ', expected: 100_000, actual: 100_000, matches: true },
      ],
      ...over,
    },
  })

  it('khớp ⇒ thẻ "Khôi phục khớp" hiện một lần rồi khoá bị xoá', async () => {
    saveRestoreReport(stored())
    const first = renderPage()

    expect(await screen.findByText('Khôi phục khớp')).toBeDefined()
    expect(screen.getAllByText('100.000 đ').length).toBeGreaterThan(0)
    await waitFor(() => expect(sessionStorage.getItem('my-biller.restore-report')).toBeNull())

    first.unmount()
    renderPage()
    await screen.findByRole('button', { name: 'SAO LƯU RA FILE' })
    expect(screen.queryByText('Khôi phục khớp')).toBeNull()
  })

  it('lệch ⇒ báo động LỆCH kèm bảng lệch và tên file an toàn', async () => {
    saveRestoreReport(
      stored({
        ok: false,
        rows: [
          { key: 'orders', label: 'Đơn', expected: 2, actual: 1, matches: false },
          { key: 'debtTotal', label: 'Tổng nợ', expected: 100_000, actual: 100_000, matches: true },
        ],
      }),
    )
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Khôi phục LỆCH ở: Đơn/)
    expect(alert.textContent).toMatch(/an-toan\.json/)
    expect(screen.getByText('LỆCH')).toBeDefined()
  })

  it('có đơn thu vượt tổng ⇒ nói rõ số đơn đó', async () => {
    saveRestoreReport(stored({ overpaidOrders: 2 }))
    renderPage()

    expect(await screen.findByText(/2 đơn có tiền thu vượt tổng đơn/)).toBeDefined()
  })
})

/** Máy: khoản 1 (30k) đã trả lại khách, khoản 2 (20k) đã bỏ. File: cả hai còn chờ xử lý — hai xung đột của Chị Hoa. */
function twoConflicts() {
  const device = ledgerK()
  device.customers[0] = { ...device.customers[0]!, name: 'Chị Hoa' }
  device.payments[0] = { ...device.payments[0]!, unallocatedStatus: 'refunded', resolutionNote: 'Đã trả lại' }
  device.payments[1] = { ...device.payments[1]!, unallocatedStatus: 'discarded', resolutionNote: 'Ghi nhầm' }
  return { device, file: shiftIds(ledgerK(), 10) }
}

const fileText = (data: BackupData, version: 2 | 4 = 4) =>
  JSON.stringify({ app: 'my-biller', version, appVersion: '2.11.0', exportedAt: new Date(NOW).toISOString(), data })

async function openMerge(data: BackupData, version: 2 | 4 = 4) {
  await pick(fileText(data, version), 'ban-sao.json')
  await screen.findByRole('dialog', { name: 'Khôi phục từ file' })
  await userEvent.click(screen.getByRole('button', { name: 'Gộp vào sổ trên máy' }))
  if (version === 2) {
    await userEvent.click(await screen.findByRole('button', { name: 'Vẫn gộp' }))
  }
  return screen.findByRole('dialog', { name: 'Gộp file vào sổ trên máy' })
}

const card = (gid: string) => document.querySelector<HTMLElement>(`[data-conflict-gid="${gid}"]`)!
const choose = (gid: string, label: string) => userEvent.click(within(card(gid)).getByLabelText(label))
const mergeButton = () => screen.getByRole('button', { name: 'GỘP' }) as HTMLButtonElement

describe('khôi phục: chọn Ghi đè hay Gộp', () => {
  it('đọc file xong hỏi chế độ, chưa ghi gì', async () => {
    await replaceAllData(ledgerK())
    renderPage()

    await pick(fileText(shiftIds(ledgerK(), 10)))

    const dialog = await screen.findByRole('dialog', { name: 'Khôi phục từ file' })
    expect(within(dialog).getByRole('button', { name: 'Ghi đè' })).toBeDefined()
    expect(within(dialog).getByRole('button', { name: 'Gộp vào sổ trên máy' })).toBeDefined()
    expect(await db.payments.count()).toBe(3)
  })

  it('file v1/v2: Gộp phải qua cửa cảnh báo nhân đôi; Quay lại không mở xem trước, không ghi gì', async () => {
    await replaceAllData(ledgerK())
    renderPage()

    await pick(fileText(ledgerK(), 2))
    await userEvent.click(await screen.findByRole('button', { name: 'Gộp vào sổ trên máy' }))

    const warning = await screen.findByRole('alertdialog', { name: 'File từ bản cũ — gộp sẽ nhân đôi' })
    expect(warning.textContent).toMatch(/nhân đôi/)
    expect(warning.textContent).toMatch(/Thường nên chọn Ghi đè/)
    await userEvent.click(within(warning).getByRole('button', { name: 'Huỷ' }))

    expect(screen.queryByRole('dialog', { name: 'Gộp file vào sổ trên máy' })).toBeNull()
    expect(await db.orders.count()).toBe(4)
  })
})

describe('xem trước Gộp', () => {
  it('không chọn sẵn lựa chọn nào; GỘP khoá tới khi mọi xung đột có câu trả lời', async () => {
    const { device, file } = twoConflicts()
    await replaceAllData(device)
    renderPage()

    await openMerge(file)

    expect(document.querySelectorAll('input[type=radio]:checked')).toHaveLength(0)
    expect(mergeButton().disabled).toBe(true)
    await choose(device.payments[0]!.gid, 'Giữ bản trên máy')
    expect(mergeButton().disabled).toBe(true)
    await choose(device.payments[1]!.gid, 'Lấy bản trong file')
    expect(mergeButton().disabled).toBe(false)
  })

  it('đổi lựa chọn xung đột 1 thì Nợ sau gộp và số dưới lựa chọn của xung đột 2 đổi theo', async () => {
    const { device, file } = twoConflicts()
    await replaceAllData(device)
    renderPage()

    await openMerge(file)
    const first = device.payments[0]!.gid
    const second = device.payments[1]!.gid

    expect(screen.getByText(/Chị Hoa: hiện 540\.000 đ → sau gộp 540\.000 đ/)).toBeDefined()
    expect(screen.getByText(/tạm tính — còn 2 xung đột chưa chọn/)).toBeDefined()
    expect(within(card(second)).getAllByText(/Chọn cái này thì nợ Chị Hoa sau gộp: 520\.000 đ/).length).toBeGreaterThan(0)

    await choose(first, 'Lấy bản trong file')

    expect(screen.getByText(/Chị Hoa: hiện 540\.000 đ → sau gộp 510\.000 đ/)).toBeDefined()
    expect(within(card(second)).getAllByText(/Chọn cái này thì nợ Chị Hoa sau gộp: 490\.000 đ/).length).toBeGreaterThan(0)
  })

  it('Thêm riêng nói có thể tính tiền hai lần; khoản đã trừ vào đơn thì nói phần dư mất khỏi công nợ', async () => {
    const device = ledgerK()
    const file = shiftIds(ledgerK(), 10)
    file.payments[2] = { ...file.payments[2]!, amount: 100_000 }
    await replaceAllData(device)
    renderPage()

    await openMerge(file)

    const conflict = card(device.payments[2]!.gid)
    expect(within(conflict).getByText(/Có thể tính tiền hai lần/)).toBeDefined()
    expect(within(conflict).getByText(/Khoản này đã trừ vào đơn PBH-261001-A004/)).toBeDefined()
    expect(within(conflict).getByText(/phần dư không thành tiền dư của khách mà mất khỏi công nợ/)).toBeDefined()
  })

  it('liệt kê tên thứ chỉ có trong file sẽ được thêm vào máy', async () => {
    await replaceAllData(ledgerK())
    const file = shiftIds(ledgerK(), 10)
    file.items.push(mk.item(30, 91, { name: 'Trà đá' }))
    file.customers.push(mk.customer(30, 92, { name: 'Anh Tư' }))
    renderPage()

    const dialog = await openMerge(file)

    expect(within(dialog).getByText(/Sẽ thêm vào máy — có thể gồm thứ bạn đã xoá sau lần sao lưu này/)).toBeDefined()
    expect(within(dialog).getByText(/Mặt hàng: Trà đá/)).toBeDefined()
    expect(within(dialog).getByText(/Khách: Anh Tư/)).toBeDefined()
    expect(mergeButton().disabled).toBe(false)
  })

  it('Đã thu và Tổng nợ hiện → sau gộp; báo số đơn sẽ thu vượt tổng', async () => {
    const device = ledgerK()
    device.payments.push(mk.payment(9, 71, 4, 40_000))
    device.orders[3] = { ...device.orders[3]!, paidAmount: 100_000, status: 'paid' }
    const file = shiftIds(ledgerK(), 10)
    file.payments.push(mk.payment(40, 70, 14, 40_000, { customerId: 11 }))
    await replaceAllData(device)
    renderPage()

    const dialog = await openMerge(file)

    expect(within(dialog).getByText(/Đã thu: hiện 150\.000 đ → sau gộp 190\.000 đ/)).toBeDefined()
    expect(within(dialog).getByText(/Tổng nợ: hiện 450\.000 đ → sau gộp 450\.000 đ/)).toBeDefined()
    expect(within(dialog).getByText(/1 đơn sẽ có tiền thu vượt tổng đơn/)).toBeDefined()
  })
})

describe('bấm GỘP', () => {
  it('web: lưu file an toàn trước, dừng ở cửa "Đã thấy file an toàn"; Huỷ không ghi gì', async () => {
    const { device, file } = twoConflicts()
    await replaceAllData(device)
    renderPage()
    await openMerge(file)
    await choose(device.payments[0]!.gid, 'Lấy bản trong file')
    await choose(device.payments[1]!.gid, 'Lấy bản trong file')

    await userEvent.click(mergeButton())

    const gate = await screen.findByRole('alertdialog', { name: 'Đã thấy file an toàn trong Tải về?' })
    expect(gate.textContent).toMatch(/Đã yêu cầu tải file "my-biller-backup-260807-1400\.json"/)
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1)
    expect((await db.payments.get(device.payments[0]!.id))?.unallocatedStatus).toBe('refunded')

    await userEvent.click(within(gate).getByRole('button', { name: 'Huỷ' }))
    expect((await db.payments.get(device.payments[0]!.id))?.unallocatedStatus).toBe('refunded')
    expect(reload).not.toHaveBeenCalled()
  })

  it('web: Đã thấy — gộp thì ghi theo đúng lựa chọn, lưu báo cáo gộp rồi tải lại trang', async () => {
    const { device, file } = twoConflicts()
    await replaceAllData(device)
    renderPage()
    await openMerge(file)
    await choose(device.payments[0]!.gid, 'Lấy bản trong file')
    await choose(device.payments[1]!.gid, 'Giữ bản trên máy')
    await userEvent.click(mergeButton())
    await userEvent.click(await screen.findByRole('button', { name: 'Đã thấy — gộp' }))

    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect((await db.payments.get(device.payments[0]!.id))?.unallocatedStatus ?? 'pending').toBe('pending')
    expect((await db.payments.get(device.payments[1]!.id))?.unallocatedStatus).toBe('discarded')
    const stored = JSON.parse(sessionStorage.getItem('my-biller.restore-report') ?? 'null') as StoredRestoreReport
    expect(stored).toMatchObject({
      mode: 'merge',
      sourceName: 'ban-sao.json',
      safety: { savedAs: 'my-biller-backup-260807-1400.json' },
      report: { ok: true },
    })
  })

  it('sổ đổi giữa xem trước và ghi ⇒ quay về xem trước với câu "Sổ vừa thay đổi", không ghi gì', async () => {
    const { device, file } = twoConflicts()
    await replaceAllData(device)
    renderPage()
    await openMerge(file)
    await choose(device.payments[0]!.gid, 'Lấy bản trong file')
    await choose(device.payments[1]!.gid, 'Lấy bản trong file')
    await userEvent.click(mergeButton())
    await screen.findByRole('alertdialog', { name: 'Đã thấy file an toàn trong Tải về?' })
    await db.payments.update(device.payments[0]!.id, { resolutionNote: 'Sửa ở tab khác' })

    await userEvent.click(screen.getByRole('button', { name: 'Đã thấy — gộp' }))

    const dialog = await screen.findByRole('dialog', { name: 'Gộp file vào sổ trên máy' })
    expect(await within(dialog).findByText(/Sổ vừa thay đổi/)).toBeDefined()
    expect((await db.payments.get(device.payments[1]!.id))?.unallocatedStatus).toBe('discarded')
    expect(reload).not.toHaveBeenCalled()
  })
})

/**
 * File đã qua `parseBackupFile` và sổ máy lành thì không dựng được bộ lựa chọn làm sổ hỏng từ giao diện;
 * khoá GỘP theo `integrity` vẫn phải đúng nên kiểm thẳng thẻ xem trước với một file dựng tay.
 */
describe('xem trước Gộp: lựa chọn làm sổ hỏng', () => {
  it('báo động và khoá GỘP; đổi sang lựa chọn lành thì mở khoá', () => {
    const device = ledgerK()
    device.payments[0] = { ...device.payments[0]!, unallocatedStatus: 'refunded' }
    const file = shiftIds(ledgerK(), 10)
    file.payments[0] = { ...file.payments[0]!, orderId: 404 }
    const gid = device.payments[0]!.gid
    const sheet = (choice: PaymentChoice) => (
      <MergePreviewSheet
        current={device}
        incoming={file}
        choices={{ [gid]: choice }}
        fallbackLetter="A"
        notice={null}
        busy={false}
        onChoose={() => {}}
        onMerge={() => {}}
        onClose={() => {}}
      />
    )

    const { rerender } = render(sheet('file'))
    expect(screen.getByRole('alert').textContent).toMatch(/Lựa chọn hiện tại làm sổ hỏng/)
    expect(mergeButton().disabled).toBe(true)

    rerender(sheet('device'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mergeButton().disabled).toBe(false)
  })
})
