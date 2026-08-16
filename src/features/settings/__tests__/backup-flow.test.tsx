// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '../settings-page'
import { downloadRecoveryBackup, prepareBackup } from '../backup'
import { collectBackup } from '@/db/backup'
import { db } from '@/db/db'
import { createItem } from '@/db/repositories/items'
import { getAppState, saveAppState } from '@/db/repositories/settings'
import { testGid } from '@/test-fixtures'

const NOW = new Date(2026, 7, 7, 14, 0).getTime()
const DAY = 24 * 60 * 60 * 1000

/** Tên các file mà app đã bảo trình duyệt tải về trong một ca test. */
let downloads: string[] = []
let downloadedFiles: File[] = []

const setWebShare = ({
  canShare = () => true,
  share = async () => {},
}: {
  canShare?: (data: ShareData) => boolean
  share?: (data: ShareData) => Promise<void>
} = {}) => {
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn(canShare) })
  Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn(share) })
  return {
    canShare: navigator.canShare as ReturnType<typeof vi.fn<(data: ShareData) => boolean>>,
    share: navigator.share as ReturnType<typeof vi.fn<(data: ShareData) => Promise<void>>>,
  }
}

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  localStorage.clear()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)

  // jsdom không có Blob URL lẫn cơ chế tải file; ghi lại tên file thay cho việc mở thư mục Tải về.
  downloads = []
  downloadedFiles = []
  URL.createObjectURL = vi.fn((blob: Blob) => {
    if (blob instanceof File) downloadedFiles.push(blob)
    return 'blob:test'
  })
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download)
  })
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined })
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const renderPage = () =>
  render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  )

const seedItem = () =>
  createItem({ name: 'Phở', groupId: null, unit: 'tô', unitPrice: 50_000, costPrice: null, isActive: 1 })

const pick = (contents: string) =>
  fireEvent.change(screen.getByLabelText('Chọn file sao lưu'), {
    target: { files: [new File([contents], 'backup.json', { type: 'application/json' })] },
  })

describe('sao lưu trong recovery chỉ đọc', () => {
  it('tải đúng snapshot nhưng không ghi mốc hoặc tạo outbox', async () => {
    await seedItem()
    const prepared = await prepareBackup(NOW)
    expect(JSON.parse(await prepared.file.text())).toMatchObject({ appVersion: '2.0.0' })

    await downloadRecoveryBackup(prepared)

    expect(downloads).toEqual(['my-biller-backup-260807-1400.json'])
    expect((await getAppState()).lastBackupAt).toBeNull()
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('sao lưu thủ công chưa có dữ liệu nghiệp vụ', () => {
  it('chỉ mở cảnh báo; huỷ không tải, không báo thành công và không ghi mốc', async () => {
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'SAO LƯU RA FILE' }))

    const dialog = await screen.findByRole('alertdialog', {
      name: 'Bản sao này chưa có dữ liệu bán hàng',
    })
    expect(dialog.textContent).toMatch(/thông tin cửa hàng/)
    expect(dialog.textContent).toMatch(/Màn hình chính/)
    expect(dialog.textContent).not.toMatch(/file trống|content-free/i)
    expect(downloads).toEqual([])
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(screen.queryByText(/Đã gửi yêu cầu tải bản sao/)).toBeNull()
    expect((await getAppState()).lastBackupAt).toBeNull()
    expect((screen.getByRole('button', { name: 'SAO LƯU RA FILE', hidden: true }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Nhập từ file sao lưu', hidden: true }) as HTMLButtonElement).disabled).toBe(true)
    const background = screen.getByRole('heading', { name: 'Cài đặt', hidden: true }).closest('[inert]')
    expect(background?.getAttribute('aria-hidden')).toBe('true')

    pick(JSON.stringify({ app: 'my-biller', version: 2, exportedAt: NOW, data: {} }))
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(downloads).toEqual([])
    expect((await getAppState()).lastBackupAt).toBeNull()
  })

  it('xác nhận consume đúng prepared File một lần dù bấm nhanh hai lần', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'SAO LƯU RA FILE' }))
    const confirm = await screen.findByRole('button', { name: 'Vẫn tải bản sao này' })

    confirm.click()
    confirm.click()

    await waitFor(() => expect(downloads).toEqual(['my-biller-backup-260807-1400.json']))
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1)
    expect(downloadedFiles).toHaveLength(1)
    expect((await getAppState()).lastBackupAt).toBe(NOW)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    const exportButton = screen.getByRole('button', { name: 'SAO LƯU RA FILE' })
    expect((exportButton as HTMLButtonElement).disabled).toBe(false)
    expect(document.activeElement).toBe(exportButton)
  })

  it('chỉ cần một record nghiệp vụ là giữ luồng tải một chạm', async () => {
    await seedItem()
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'SAO LƯU RA FILE' }))

    expect(await screen.findByText(/Đã gửi yêu cầu tải bản sao với tên đề xuất/)).toBeDefined()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(downloads).toEqual(['my-biller-backup-260807-1400.json'])
  })

  it('file không nhập lại được ưu tiên đường cứu: tải ngay, không cảnh báo rỗng, không stamp/share', async () => {
    await db.items.add({
      gid: testGid(98),
      name: 'Hàng lạ',
      groupId: null,
      unit: '',
      unitPrice: 25_500.5,
      costPrice: null,
      isActive: 1,
      note: '',
      createdAt: NOW,
      updatedAt: NOW,
    })
    setWebShare()
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'SAO LƯU RA FILE' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/KHÔNG nhập lại được/)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'CHIA SẺ FILE VỪA SAO LƯU' })).toBeNull()
    expect(downloads).toEqual(['my-biller-backup-260807-1400.json'])
    expect((await getAppState()).lastBackupAt).toBeNull()
  })
})

describe('chia sẻ đúng file vừa sao lưu', () => {
  it('probe và share nhận chính File đã phát download; share không tải hoặc stamp lần hai', async () => {
    await seedItem()
    const webShare = setWebShare()
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'SAO LƯU RA FILE' }))
    const shareButton = await screen.findByRole('button', { name: 'CHIA SẺ FILE VỪA SAO LƯU' })
    const file = downloadedFiles[0]
    expect(file).toBeDefined()
    expect(file?.name).toBe('my-biller-backup-260807-1400.json')
    expect(file?.type).toBe('application/json')
    expect(webShare.canShare).toHaveBeenCalledWith({ files: [file] })
    const stampedAt = (await getAppState()).lastBackupAt

    await userEvent.click(shareButton)

    expect(webShare.share).toHaveBeenCalledWith({ files: [file] })
    expect(downloads).toEqual(['my-biller-backup-260807-1400.json'])
    expect((await getAppState()).lastBackupAt).toBe(stampedAt)
    expect(screen.queryByRole('button', { name: 'CHIA SẺ FILE VỪA SAO LƯU' })).toBeNull()
  })

  it.each([
    ['canShare trả false', () => false],
    ['canShare ném lỗi', () => { throw new Error('Capability hỏng') }],
  ])('%s thì backup vẫn thành công và không hiện nút treo', async (_case, canShare) => {
    await seedItem()
    setWebShare({ canShare })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'SAO LƯU RA FILE' }))

    expect(await screen.findByText(/Đã gửi yêu cầu tải bản sao với tên đề xuất/)).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'CHIA SẺ FILE VỪA SAO LƯU' })).toBeNull()
    expect((await getAppState()).lastBackupAt).toBe(NOW)
  })

  it('thiếu Web Share vẫn backup bình thường và không hiện CTA', async () => {
    await seedItem()
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'SAO LƯU RA FILE' }))

    expect(await screen.findByText(/Đã gửi yêu cầu tải bản sao với tên đề xuất/)).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'CHIA SẺ FILE VỪA SAO LƯU' })).toBeNull()
  })

  it('getter share ném lỗi cũng được coi là unsupported', async () => {
    await seedItem()
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      get: () => {
        throw new Error('Không đọc được share')
      },
    })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn(() => true) })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'SAO LƯU RA FILE' }))

    expect(await screen.findByText(/Đã gửi yêu cầu tải bản sao với tên đề xuất/)).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'CHIA SẺ FILE VỪA SAO LƯU' })).toBeNull()
  })

  it('AbortError im lặng và giữ file để thử lại', async () => {
    await seedItem()
    const webShare = setWebShare({
      share: async () => Promise.reject(new DOMException('Đã huỷ', 'AbortError')),
    })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'SAO LƯU RA FILE' }))

    await userEvent.click(await screen.findByRole('button', { name: 'CHIA SẺ FILE VỪA SAO LƯU' }))

    await waitFor(() => expect(webShare.share).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'CHIA SẺ FILE VỪA SAO LƯU' })).toBeDefined()
  })

  it('lỗi thật báo rõ, giữ fallback và không phát download trùng', async () => {
    await seedItem()
    setWebShare({ share: async () => Promise.reject(new Error('Share target hỏng')) })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'SAO LƯU RA FILE' }))

    await userEvent.click(await screen.findByRole('button', { name: 'CHIA SẺ FILE VỪA SAO LƯU' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/Hãy kiểm tra thư mục Tải về/)
    expect(screen.getByRole('button', { name: 'CHIA SẺ FILE VỪA SAO LƯU' })).toBeDefined()
    expect(downloads).toHaveLength(1)
  })

  it('share là single-flight; thành công dọn đúng target', async () => {
    await seedItem()
    let resolveShare: (() => void) | undefined
    const webShare = setWebShare({
      share: () => new Promise<void>((resolve) => { resolveShare = resolve }),
    })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'SAO LƯU RA FILE' }))
    const button = await screen.findByRole('button', { name: 'CHIA SẺ FILE VỪA SAO LƯU' })

    act(() => {
      button.click()
      button.click()
    })

    expect(webShare.share).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: 'Đang mở chia sẻ…' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => resolveShare?.())
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'CHIA SẺ FILE VỪA SAO LƯU' })).toBeNull(),
    )
  })

  it('share cũ hoàn tất không được dọn target của lần sao lưu mới', async () => {
    await seedItem()
    let resolveFirstShare: (() => void) | undefined
    setWebShare({
      share: () => new Promise<void>((resolve) => { resolveFirstShare = resolve }),
    })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'SAO LƯU RA FILE' }))
    await userEvent.click(await screen.findByRole('button', { name: 'CHIA SẺ FILE VỪA SAO LƯU' }))

    await userEvent.click(screen.getByRole('button', { name: 'SAO LƯU RA FILE' }))
    await waitFor(() => expect(downloads).toHaveLength(2))
    expect(await screen.findByRole('button', { name: 'Đang mở chia sẻ…' })).toBeDefined()

    await act(async () => resolveFirstShare?.())

    expect(await screen.findByRole('button', { name: 'CHIA SẺ FILE VỪA SAO LƯU' })).toBeDefined()
  })

  it('target hết hạn sau 10 phút và cũng dọn khi pagehide', async () => {
    await seedItem()
    setWebShare()
    const timeoutSpy = vi.spyOn(window, 'setTimeout')
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'SAO LƯU RA FILE' }))
    expect(await screen.findByRole('button', { name: 'CHIA SẺ FILE VỪA SAO LƯU' })).toBeDefined()

    await waitFor(() =>
      expect(timeoutSpy.mock.calls.some(([, delay]) => delay === 10 * 60 * 1000)).toBe(true),
    )
    const expire = timeoutSpy.mock.calls.find(([, delay]) => delay === 10 * 60 * 1000)?.[0]
    expect(expire).toBeTypeOf('function')
    act(() => {
      if (typeof expire === 'function') expire()
    })
    expect(screen.queryByRole('button', { name: 'CHIA SẺ FILE VỪA SAO LƯU' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'SAO LƯU RA FILE' }))
    expect(await screen.findByRole('button', { name: 'CHIA SẺ FILE VỪA SAO LƯU' })).toBeDefined()
    fireEvent(window, new Event('pagehide'))
    expect(screen.queryByRole('button', { name: 'CHIA SẺ FILE VỪA SAO LƯU' })).toBeNull()
  })

  it('chọn nhập file xoá target cũ trước khi đọc file', async () => {
    await seedItem()
    setWebShare()
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'SAO LƯU RA FILE' }))
    expect(await screen.findByRole('button', { name: 'CHIA SẺ FILE VỪA SAO LƯU' })).toBeDefined()

    pick('không phải JSON')

    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'CHIA SẺ FILE VỪA SAO LƯU' })).toBeNull()
  })
})

describe('nhập file sao lưu', () => {
  it('file hỏng: báo lỗi rõ và dữ liệu đang có không suy suyển', async () => {
    await seedItem()
    renderPage()

    pick('{ "app": "my-biller", "version": 1 }')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/hỏng/)
    // Không có hộp xác nhận nghĩa là chưa đi tới bước ghi đè.
    expect(screen.queryByText('Ghi đè toàn bộ dữ liệu?')).toBeNull()
    expect(await db.items.count()).toBe(1)
  })

  it('file của app khác cũng bị chặn trước khi đụng DB', async () => {
    await seedItem()
    renderPage()

    pick(JSON.stringify({ app: 'app-khac', version: 1 }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/ứng dụng khác/)
    expect(await db.items.count()).toBe(1)
  })

  it('file đúng: hỏi xác nhận kèm số bản ghi, chưa ghi gì cho tới khi bấm đồng ý', async () => {
    await seedItem()
    const file = await collectBackup(NOW)
    renderPage()

    pick(JSON.stringify(file))

    expect(await screen.findByText('Ghi đè toàn bộ dữ liệu?')).toBeDefined()
    expect(screen.getByText(/1 mặt hàng/)).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }))
    expect(await db.items.count()).toBe(1)
  })

  /**
   * Cửa thứ hai không phải thủ tục thừa: `exportBackup` chỉ bấm `link.click()` rồi trả về, webview
   * Zalo hay PWA iOS có thể nuốt cú tải mà không báo gì. Ghi đè trước khi người bán tự mắt thấy file
   * là xoá dữ liệu mà không có đường về.
   */
  it('tải file an toàn xong vẫn dừng lại hỏi; chỉ ghi đè sau khi người bán nói đã thấy file', async () => {
    await seedItem()
    const file = await collectBackup(NOW)
    await db.items.clear()
    await createItem({ name: 'Bún', groupId: null, unit: 'tô', unitPrice: 40_000, costPrice: null, isActive: 1 })
    renderPage()

    pick(JSON.stringify(file))
    await userEvent.click(await screen.findByRole('button', { name: 'Tải file an toàn' }))

    expect(await screen.findByText('Đã thấy file trong máy chưa?')).toBeDefined()
    expect(downloads).toEqual(['my-biller-backup-260807-1400.json'])
    // Dữ liệu hiện tại còn nguyên: mới chỉ tải file, chưa ghi đè.
    expect((await db.items.toArray()).map((item) => item.name)).toEqual(['Bún'])

    await userEvent.click(screen.getByRole('button', { name: 'Đã thấy — ghi đè' }))
    await waitFor(async () => expect((await db.items.toArray()).map((item) => item.name)).toEqual(['Phở']))
  })

  it('huỷ ở cửa thứ hai thì dữ liệu đang có vẫn nguyên', async () => {
    await seedItem()
    const file = await collectBackup(NOW)
    await db.items.clear()
    await createItem({ name: 'Bún', groupId: null, unit: 'tô', unitPrice: 40_000, costPrice: null, isActive: 1 })
    renderPage()

    pick(JSON.stringify(file))
    await userEvent.click(await screen.findByRole('button', { name: 'Tải file an toàn' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Huỷ' }))

    expect((await db.items.toArray()).map((item) => item.name)).toEqual(['Bún'])
  })
})

/**
 * Bản sao an toàn có thể xuất ra được mà không nhập lại được (bản build cũ, sửa tay qua DevTools).
 * Chặn cứng ở đó thì người bán mắc kẹt: không nhập được file mới mà cũng không xoá được để bắt đầu
 * lại. Nên vẫn cho đi, qua một cửa thứ ba nói thẳng là mất hẳn.
 */
describe('bản sao an toàn không nhập lại được', () => {
  /** Ghi thẳng vào bảng, không qua schema: `collectBackup` xuất được, `parseBackupFile` từ chối. */
  const addOddItem = () =>
    db.items.add({
      gid: testGid(99),
      name: 'Hàng lạ',
      groupId: null,
      unit: '',
      unitPrice: 25_500.5,
      costPrice: null,
      isActive: 1,
      note: '',
      createdAt: NOW,
      updatedAt: NOW,
    })

  const wipeUpToSecondGate = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Xoá toàn bộ dữ liệu' }))
    await userEvent.type(screen.getByLabelText('Gõ XOA'), 'XOA')
    await userEvent.click(screen.getByRole('button', { name: 'SAO LƯU RỒI XOÁ' }))
  }

  it('xoá sạch: dữ liệu lành thì vẫn chỉ hai cửa như cũ', async () => {
    await seedItem()
    renderPage()

    await wipeUpToSecondGate()

    expect(await screen.findByText('Đã thấy file trong máy chưa?')).toBeDefined()
    await userEvent.click(screen.getByRole('button', { name: 'Đã thấy — xoá tất cả' }))
    await waitFor(async () => expect(await db.items.count()).toBe(0))
  })

  it('xoá sạch: file hỏng thì dừng ở cửa thứ ba, huỷ ở đó là chưa xoá gì', async () => {
    await seedItem()
    await addOddItem()
    renderPage()

    await wipeUpToSecondGate()
    await userEvent.click(await screen.findByRole('button', { name: 'Đã thấy — đọc tiếp' }))

    const gate = await screen.findByText('Bản sao an toàn KHÔNG nhập lại được')
    expect(gate).toBeDefined()
    expect(screen.getByText(/data\.items\.\d+\.unitPrice/)).toBeDefined()
    expect(downloads).toEqual(['my-biller-backup-260807-1400.json'])

    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }))
    expect(await db.items.count()).toBe(2)
  })

  it('xoá sạch: qua cửa thứ ba thì mới thật sự xoá', async () => {
    await seedItem()
    await addOddItem()
    renderPage()

    await wipeUpToSecondGate()
    await userEvent.click(await screen.findByRole('button', { name: 'Đã thấy — đọc tiếp' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Vẫn xoá — mất cũng được' }))

    await waitFor(async () => expect(await db.items.count()).toBe(0))
  })

  it('nhập file: file hỏng thì thêm cửa thứ ba, chưa ghi đè cho tới khi qua nó', async () => {
    await seedItem()
    const file = await collectBackup(NOW)
    await db.items.clear()
    await createItem({ name: 'Bún', groupId: null, unit: 'tô', unitPrice: 40_000, costPrice: null, isActive: 1 })
    await addOddItem()
    renderPage()

    pick(JSON.stringify(file))
    await userEvent.click(await screen.findByRole('button', { name: 'Tải file an toàn' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Đã thấy — đọc tiếp' }))

    expect(await screen.findByText('Bản sao an toàn KHÔNG nhập lại được')).toBeDefined()
    // Chưa đụng gì tới DB: vẫn là dữ liệu hiện tại, chưa phải dữ liệu trong file.
    expect((await db.items.toArray()).map((item) => item.name)).toEqual(['Bún', 'Hàng lạ'])

    await userEvent.click(screen.getByRole('button', { name: 'Vẫn ghi đè — mất cũng được' }))
    await waitFor(async () => expect((await db.items.toArray()).map((item) => item.name)).toEqual(['Phở']))
  })

  /**
   * Khe lỗi của ô "Gõ XOA" nói về chữ người bán vừa gõ. Đổ lỗi sao lưu vào đó thì câu lỗi đọc như
   * "chữ XOA sai định dạng", và người bán sửa cái không hỏng.
   */
  it('lỗi không xuất được file hiện ra như báo động, không phải như lỗi của ô nhập', async () => {
    await seedItem()
    URL.createObjectURL = vi.fn(() => {
      throw new Error('Webview chặn tải file.')
    })
    renderPage()

    await wipeUpToSecondGate()

    expect((await screen.findByRole('alert')).textContent).toMatch(/Webview chặn tải file/)
    expect(screen.getByLabelText('Gõ XOA').getAttribute('aria-invalid')).toBeNull()
    expect(screen.queryByText('Đã thấy file trong máy chưa?')).toBeNull()
    expect(await db.items.count()).toBe(1)
  })
})

describe('banner nhắc sao lưu', () => {
  it('chưa sao lưu lần nào thì nhắc ngay', async () => {
    renderPage()
    expect(await screen.findByText(/Chưa sao lưu lần nào\./)).toBeDefined()
  })

  it('sao lưu hôm qua thì im lặng', async () => {
    await saveAppState({ lastBackupAt: NOW - DAY })
    renderPage()

    await screen.findByText('Lần cuối: 14:00 ngày 6/8/2026')
    expect(screen.queryByText(/chưa sao lưu/i)).toBeNull()
  })

  it('quá 7 ngày thì nhắc kèm số ngày', async () => {
    await saveAppState({ lastBackupAt: NOW - 8 * DAY })
    renderPage()
    expect(await screen.findByText(/Đã 8 ngày chưa sao lưu/)).toBeDefined()
  })

  it('đóng banner thì nó im 24 giờ chứ không tắt hẳn', async () => {
    await saveAppState({ lastBackupAt: NOW - 8 * DAY })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Ẩn nhắc sao lưu' }))
    await waitFor(() => expect(screen.queryByText(/Đã 8 ngày chưa sao lưu/)).toBeNull())

    cleanup()
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 25 * 60 * 60 * 1000)
    renderPage()
    expect(await screen.findByText(/Đã 9 ngày chưa sao lưu/)).toBeDefined()
  })
})
