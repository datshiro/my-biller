// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GhepMayPage } from '../ghep-may-page'
import { db } from '@/db/db'
import {
  beginDevicePairing,
  completeDevicePairing,
  getDeviceSyncState,
  leaveSharedLedger,
  markDeviceRevoked,
  saveDeviceIdentity,
  savePairedDevice,
} from '@/db/repositories/device-state'
import { createItem } from '@/db/repositories/items'
import { createOrder } from '@/db/repositories/orders'
import { SyncApiError } from '@/db/sync/client'
import { SYNC_WAKE_EVENT } from '@/db/sync/runner'
import { UnpairBlockedError, UnpairUncertainError } from '@/db/sync/unpair'
import { installTestDevice, testGid } from '@/test-fixtures'

const DEVICE_ID = testGid(10)
const TOKEN = 't'.repeat(43)
const currentDevice = { id: DEVICE_ID, letter: 'A', label: 'Quầy trước', createdAt: 1, revokedAt: null, current: true }
const otherActiveDevice = { id: testGid(11), letter: 'B', label: 'Quầy sau', createdAt: 2, revokedAt: null, current: false }
const otherRevokedDevice = { ...otherActiveDevice, revokedAt: 3 }

const syncMocks = vi.hoisted(() => ({
  listShopDevices: vi.fn(),
  pairDevice: vi.fn(),
  revokeShopDevice: vi.fn(),
}))

vi.mock('@/db/sync/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/sync/client')>()
  return {
    ...original,
    listShopDevices: syncMocks.listShopDevices,
    pairDevice: syncMocks.pairDevice,
    revokeShopDevice: syncMocks.revokeShopDevice,
  }
})

const unpairMocks = vi.hoisted(() => ({
  unpairThisDevice: vi.fn(),
}))

vi.mock('@/db/sync/unpair', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/sync/unpair')>()
  return { ...original, unpairThisDevice: unpairMocks.unpairThisDevice }
})

const LEAVE_TITLE = 'Huỷ ghép “Quầy trước”?'
const LEAVE_BODY =
  'Máy này sẽ rời sổ chung và thành máy chưa ghép. Sổ trên máy được giữ nguyên làm sổ cục bộ, đúng như lúc huỷ ghép; máy khác sẽ không thấy thay đổi mới của máy này nữa. Muốn ghép lại vào sổ chung sau này phải sao lưu rồi xoá sổ trên máy trước, và dùng một chữ cái khác.'
const LAST_DEVICE_WARNING =
  'Đây là máy cuối cùng còn ghép vào sổ chung. Huỷ ghép xong thì sổ chung không còn máy nào dùng được nữa.'
const PENDING_TEXT = 'Còn 2 thay đổi chưa lên sổ chung. Chờ đồng bộ xong rồi huỷ ghép.'
const OFFLINE_TEXT =
  'Huỷ ghép cần mạng để các máy khác biết máy này đã rời sổ chung. Kết nối Internet rồi thử lại.'
const UNCERTAIN_TEXT =
  'Chưa chắc lệnh huỷ ghép đã tới sổ chung. Có mạng lại thì bấm Huỷ ghép máy này lần nữa.'
const LEFT_BASE = 'Máy này đã rời sổ chung. Sổ trên máy giữ nguyên và giờ là sổ cục bộ.'
const LEFT_WITH_DROPPED =
  `${LEFT_BASE} 2 thay đổi ghi trong lúc huỷ ghép có thể chưa lên sổ chung — xem lại trên máy khác trước khi nhập lại.`
const REVOKED_TITLE = 'Dùng máy này như máy chưa ghép?'
const REVOKED_BODY =
  'Sổ trên máy được giữ nguyên làm sổ cục bộ, dừng ở lúc máy bị thu hồi, và không lên sổ chung nữa. Muốn quay lại sổ chung thì đừng bấm nút này — ghép lại ngay bằng mã mới; bấm rồi thì phải sao lưu và xoá sổ trên máy trước khi ghép lại.'
const REVOKED_PENDING_SUFFIX = ' Còn 2 thay đổi chưa từng lên sổ chung; chúng chỉ còn trên máy này.'
const NETWORK_TEXT = 'Chưa huỷ ghép được vì mất mạng. Kết nối Internet rồi thử lại.'
const RESYNC_TEXT = 'Máy đang kéo lại sổ chung. Chờ xong rồi huỷ ghép.'

const item = (name: string) => ({
  name,
  groupId: null,
  unit: 'tô',
  unitPrice: 50_000,
  costPrice: null,
  isActive: 1 as const,
})

function recordSale() {
  return createOrder({
    customerId: null,
    customerName: 'Khách lẻ',
    lines: [{ itemId: null, name: 'Trà đá', unit: 'ly', unitPrice: 3_000, costPrice: null, qty: 2 }],
    discount: 0,
    surcharge: 0,
    soldAt: Date.now(),
    note: '',
    payment: { amount: 6_000, method: 'cash', note: '' },
  })
}

async function ledgerSnapshot() {
  const [items, orders, orderLines, payments] = await Promise.all([
    db.items.toArray(),
    db.orders.toArray(),
    db.orderLines.toArray(),
    db.payments.toArray(),
  ])
  return {
    counts: {
      items: items.length,
      orders: orders.length,
      orderLines: orderLines.length,
      payments: payments.length,
    },
    paymentAmountSum: payments.reduce((total, payment) => total + payment.amount, 0),
    orderTotalSum: orders.reduce((total, order) => total + order.total, 0),
  }
}

async function ledgerFingerprint() {
  const [snapshot, outbox, deviceStateKeys] = await Promise.all([
    ledgerSnapshot(),
    db.outbox.count(),
    db.deviceState.toCollection().primaryKeys(),
  ])
  return { ...snapshot, outbox, deviceStateKeys: [...deviceStateKeys].map(String).sort() }
}

/** Dựng máy đã ghép đúng khuôn outbox.test.ts: identity → pairing → savePairedDevice → completeDevicePairing. */
async function pairThisDevice() {
  await saveDeviceIdentity({ label: 'Quầy trước', letter: 'A' })
  const pairing = await beginDevicePairing()
  await savePairedDevice({
    pairingAttemptId: pairing.attemptId,
    admissionExpiresAt: Date.now() + 60_000,
    deviceId: DEVICE_ID,
    label: 'Quầy trước',
    letter: 'A',
    shopId: testGid(500),
    token: TOKEN,
    syncUrl: 'https://sync.example.com',
  })
  await completeDevicePairing(pairing.attemptId)
}

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await installTestDevice()
  syncMocks.listShopDevices
    .mockReset()
    .mockResolvedValue({
      devices: [
        { id: DEVICE_ID, letter: 'A', label: 'Quầy trước', createdAt: 1, revokedAt: null, current: true },
      ],
      latestSeq: 0,
    })
  unpairMocks.unpairThisDevice.mockReset()
  syncMocks.pairDevice.mockReset()
  syncMocks.revokeShopDevice.mockReset().mockResolvedValue({ revoked: true, deviceId: DEVICE_ID })
})

afterEach(cleanup)

const renderPage = () =>
  render(
    <MemoryRouter>
      <GhepMayPage />
    </MemoryRouter>,
  )

const huyGhepButton = () => screen.getByRole('button', { name: 'Huỷ ghép máy này' }) as HTMLButtonElement

async function openLeaveDialog() {
  await waitFor(() => expect(huyGhepButton().disabled).toBe(false))
  await userEvent.click(huyGhepButton())
  return screen.findByRole('alertdialog', { name: LEAVE_TITLE })
}

describe('huỷ ghép máy này ở màn Máy bán hàng', () => {
  it('hàng đợi rỗng: hộp xác nhận nêu hệ quả ghép lại, bấm Huỷ ghép gọi unpairThisDevice đúng một lần', async () => {
    await pairThisDevice()
    syncMocks.listShopDevices.mockResolvedValue({ devices: [currentDevice, otherActiveDevice], latestSeq: 0 })
    unpairMocks.unpairThisDevice.mockResolvedValue({ droppedOperations: 0 })
    renderPage()

    const dialog = await openLeaveDialog()
    expect(within(dialog).getByText(LEAVE_BODY)).toBeDefined()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Huỷ ghép' }))
    await waitFor(() => expect(unpairMocks.unpairThisDevice).toHaveBeenCalledTimes(1))
  })

  it('chỉ còn máy này đang hoạt động, máy khác đã thu hồi: hộp xác nhận hiện cảnh báo máy cuối cùng trước nội dung cũ', async () => {
    await pairThisDevice()
    syncMocks.listShopDevices.mockResolvedValue({ devices: [currentDevice, otherRevokedDevice], latestSeq: 0 })
    renderPage()

    const dialog = await openLeaveDialog()
    expect(within(dialog).getByText(`${LAST_DEVICE_WARNING} ${LEAVE_BODY}`)).toBeDefined()
  })

  it('không còn máy nào khác trong danh sách: hộp xác nhận hiện cảnh báo máy cuối cùng', async () => {
    await pairThisDevice()
    renderPage()

    const dialog = await openLeaveDialog()
    expect(within(dialog).getByText(`${LAST_DEVICE_WARNING} ${LEAVE_BODY}`)).toBeDefined()
  })

  it('còn máy khác đang hoạt động: hộp xác nhận chỉ có nội dung cũ, không có cảnh báo máy cuối cùng', async () => {
    await pairThisDevice()
    syncMocks.listShopDevices.mockResolvedValue({ devices: [currentDevice, otherActiveDevice], latestSeq: 0 })
    renderPage()

    const dialog = await openLeaveDialog()
    expect(within(dialog).getByText(LEAVE_BODY)).toBeDefined()
    expect(within(dialog).queryByText(/Đây là máy cuối cùng/)).toBeNull()
  })

  it('mở hộp xác nhận tải lại danh sách máy: máy khác vừa ngừng hoạt động thì hiện cảnh báo máy cuối cùng', async () => {
    await pairThisDevice()
    syncMocks.listShopDevices
      .mockResolvedValueOnce({ devices: [currentDevice, otherActiveDevice], latestSeq: 0 })
      .mockResolvedValueOnce({ devices: [currentDevice], latestSeq: 0 })
    renderPage()
    await waitFor(() => expect(syncMocks.listShopDevices).toHaveBeenCalledTimes(1))

    const dialog = await openLeaveDialog()

    expect(syncMocks.listShopDevices).toHaveBeenCalledTimes(2)
    expect(await within(dialog).findByText(`${LAST_DEVICE_WARNING} ${LEAVE_BODY}`)).toBeDefined()
  })

  it('đang hiện cảnh báo máy cuối cùng vẫn bấm Huỷ ghép thì gọi unpairThisDevice đúng một lần', async () => {
    await pairThisDevice()
    unpairMocks.unpairThisDevice.mockResolvedValue({ droppedOperations: 0 })
    renderPage()

    const dialog = await openLeaveDialog()
    expect(within(dialog).getByText(`${LAST_DEVICE_WARNING} ${LEAVE_BODY}`)).toBeDefined()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Huỷ ghép' }))
    await waitFor(() => expect(unpairMocks.unpairThisDevice).toHaveBeenCalledTimes(1))
  })

  it('mở hộp xác nhận có cảnh báo máy cuối cùng không đổi sổ, hàng đợi hay khoá ghép', async () => {
    await pairThisDevice()
    await createItem(item('Phở'))
    await recordSale()
    await db.outbox.clear()
    renderPage()
    await waitFor(() => expect(huyGhepButton().disabled).toBe(false))
    const before = await ledgerFingerprint()

    await userEvent.click(huyGhepButton())
    const dialog = await screen.findByRole('alertdialog', { name: LEAVE_TITLE })
    expect(within(dialog).getByText(`${LAST_DEVICE_WARNING} ${LEAVE_BODY}`)).toBeDefined()

    expect(await ledgerFingerprint()).toEqual(before)
  })

  it('còn thay đổi chưa lên sổ chung: nút huỷ ghép khoá, hiện số, Đồng bộ ngay đánh thức sync đúng một lần', async () => {
    await pairThisDevice()
    await createItem(item('Phở'))
    await createItem(item('Bún'))
    renderPage()

    expect(await screen.findByText(PENDING_TEXT)).toBeDefined()
    expect(huyGhepButton().disabled).toBe(true)

    const onWake = vi.fn()
    window.addEventListener(SYNC_WAKE_EVENT, onWake)
    try {
      await userEvent.click(screen.getByRole('button', { name: 'Đồng bộ ngay' }))
      expect(onWake).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener(SYNC_WAKE_EVENT, onWake)
    }
    expect(unpairMocks.unpairThisDevice).not.toHaveBeenCalled()
  })

  it('lỗi mất mạng hoặc chưa chắc sau khi gửi lệnh: báo đúng câu, đóng hộp, vẫn còn nút tạo mã ghép', async () => {
    await pairThisDevice()
    unpairMocks.unpairThisDevice.mockRejectedValueOnce(new UnpairBlockedError('offline'))
    renderPage()

    const dialog = await openLeaveDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Huỷ ghép' }))

    expect((await screen.findByRole('alert')).textContent).toBe(OFFLINE_TEXT)
    expect(screen.queryByRole('alertdialog', { name: LEAVE_TITLE })).toBeNull()
    expect(screen.getByRole('button', { name: 'TẠO MÃ GHÉP' })).toBeDefined()

    unpairMocks.unpairThisDevice.mockRejectedValueOnce(new UnpairUncertainError(UNCERTAIN_TEXT))
    const again = await openLeaveDialog()
    await userEvent.click(within(again).getByRole('button', { name: 'Huỷ ghép' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(UNCERTAIN_TEXT))
  })

  it('hết giờ chờ sổ chung thì báo mất mạng bằng tiếng Việt, không lộ lỗi trình duyệt', async () => {
    await pairThisDevice()
    unpairMocks.unpairThisDevice.mockRejectedValueOnce(
      new DOMException('signal timed out', 'TimeoutError'),
    )
    renderPage()

    const dialog = await openLeaveDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Huỷ ghép' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Chưa huỷ ghép được vì mất mạng. Kết nối Internet rồi thử lại.',
    )
  })

  it('huỷ ghép xong về màn ghép, báo số thay đổi ghi trong lúc huỷ ghép có thể chưa lên sổ chung', async () => {
    await pairThisDevice()
    unpairMocks.unpairThisDevice.mockImplementation(async () => {
      await createItem(item('Bún'))
      await createItem(item('Trà đá'))
      await leaveSharedLedger({ kind: 'connected', token: TOKEN })
      return { droppedOperations: 2 }
    })
    renderPage()

    const dialog = await openLeaveDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Huỷ ghép' }))

    expect(await screen.findByRole('button', { name: 'GHÉP MÁY NÀY' })).toBeDefined()
    expect((await screen.findByRole('status')).textContent).toBe(LEFT_WITH_DROPPED)
    expect(await db.outbox.count()).toBe(0)
    expect(await db.items.count()).toBe(2)
  })

  it('máy bị thu hồi: Dùng như máy chưa ghép xoá khoá thu hồi, giữ sổ và báo đã rời sổ chung', async () => {
    await pairThisDevice()
    await markDeviceRevoked()
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Dùng máy này như máy chưa ghép' }))
    const dialog = await screen.findByRole('alertdialog', { name: REVOKED_TITLE })
    expect(within(dialog).getByText(REVOKED_BODY)).toBeDefined()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Dùng như máy chưa ghép' }))

    expect((await screen.findByRole('status')).textContent).toBe(LEFT_BASE)
    expect(screen.queryByText(/Máy này đã bị thu hồi/)).toBeNull()
    expect(await db.deviceState.get('writeBlock')).toBeUndefined()
  })

  it('máy bị thu hồi còn thay đổi chưa từng lên sổ chung: hộp xác nhận nói đúng số đó', async () => {
    await pairThisDevice()
    await createItem(item('Phở'))
    await createItem(item('Bún'))
    await markDeviceRevoked()
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Dùng máy này như máy chưa ghép' }))
    const dialog = await screen.findByRole('alertdialog', { name: REVOKED_TITLE })
    expect(within(dialog).getByText(`${REVOKED_BODY}${REVOKED_PENDING_SUFFIX}`)).toBeDefined()
  })

  it('máy chưa từng ghép không có nút Dùng máy này như máy chưa ghép', async () => {
    renderPage()

    expect(await screen.findByLabelText('Mã ghép máy')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Dùng máy này như máy chưa ghép' })).toBeNull()
  })

  it('đang huỷ ghép thì nút tạo mã ghép giữ nguyên chữ và bị khoá', async () => {
    await pairThisDevice()
    let finish: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      finish = resolve
    })
    unpairMocks.unpairThisDevice.mockImplementation(async () => {
      await gate
      await leaveSharedLedger({ kind: 'connected', token: TOKEN })
      return { droppedOperations: 0 }
    })
    renderPage()

    const dialog = await openLeaveDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Huỷ ghép' }))
    await waitFor(() => expect(unpairMocks.unpairThisDevice).toHaveBeenCalledTimes(1))

    expect(screen.queryByRole('button', { name: 'Đang tạo…' })).toBeNull()
    const generate = screen.getByRole('button', { name: 'TẠO MÃ GHÉP' }) as HTMLButtonElement
    expect(generate.disabled).toBe(true)

    finish()
    expect(await screen.findByRole('button', { name: 'GHÉP MÁY NÀY' })).toBeDefined()
  })

  it('ghép thử sau khi đã rời sổ chung thì xoá thông báo đã rời sổ chung', async () => {
    await pairThisDevice()
    unpairMocks.unpairThisDevice.mockImplementation(async () => {
      await leaveSharedLedger({ kind: 'connected', token: TOKEN })
      return { droppedOperations: 0 }
    })
    renderPage()

    const dialog = await openLeaveDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Huỷ ghép' }))
    expect(await screen.findByText(LEFT_BASE)).toBeDefined()

    syncMocks.pairDevice.mockRejectedValueOnce(
      new SyncApiError('Mã ghép không hợp lệ.', 'invalid-code', 400),
    )
    await userEvent.type(screen.getByLabelText('Mã ghép máy'), 'ABC123')
    await userEvent.click(screen.getByRole('button', { name: 'GHÉP MÁY NÀY' }))

    expect(await screen.findByText('Mã ghép không hợp lệ.')).toBeDefined()
    expect(screen.queryByText(/Máy này đã rời sổ chung/)).toBeNull()
  })

  it('huỷ ghép lỗi SyncApiError mất mạng thì báo đúng câu mất mạng', async () => {
    await pairThisDevice()
    unpairMocks.unpairThisDevice.mockRejectedValueOnce(new SyncApiError('x', 'network', 0))
    renderPage()

    const dialog = await openLeaveDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Huỷ ghép' }))

    expect((await screen.findByRole('alert')).textContent).toBe(NETWORK_TEXT)
  })

  it('bản sao đang kéo lại: hiện câu chờ, khoá nút huỷ ghép và không hiện Đồng bộ ngay', async () => {
    await pairThisDevice()
    await db.deviceState.put({ ...(await getDeviceSyncState()), resyncRequired: true })
    renderPage()

    expect(await screen.findByText(RESYNC_TEXT)).toBeDefined()
    expect(huyGhepButton().disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Đồng bộ ngay' })).toBeNull()
  })

  it('huỷ ghép thật từ màn hình giữ nguyên số dòng và tổng tiền của sổ', async () => {
    await pairThisDevice()
    await createItem(item('Phở'))
    await recordSale()
    await db.outbox.clear()
    const before = await ledgerSnapshot()
    const { lastSeq } = await getDeviceSyncState()
    syncMocks.listShopDevices.mockResolvedValue({
      devices: [
        { id: DEVICE_ID, letter: 'A', label: 'Quầy trước', createdAt: 1, revokedAt: null, current: true },
      ],
      latestSeq: lastSeq,
    })
    const actual = await vi.importActual<typeof import('@/db/sync/unpair')>('@/db/sync/unpair')
    unpairMocks.unpairThisDevice.mockImplementation(actual.unpairThisDevice)
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })

    try {
      renderPage()
      const dialog = await openLeaveDialog()
      await userEvent.click(within(dialog).getByRole('button', { name: 'Huỷ ghép' }))

      expect(await screen.findByRole('button', { name: 'GHÉP MÁY NÀY' })).toBeDefined()
      expect((await screen.findByRole('status')).textContent).toBe(LEFT_BASE)
      expect(await db.deviceState.get('connection')).toBeUndefined()
      expect(await ledgerSnapshot()).toEqual(before)
    } finally {
      Reflect.deleteProperty(navigator, 'onLine')
    }
  })
})
