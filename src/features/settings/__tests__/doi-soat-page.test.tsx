// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DoiSoatPage } from '../doi-soat-page'
import { db } from '@/db/db'
import { getLedgerOverview } from '@/db/doi-soat-snapshot'
import { SyncApiError } from '@/db/sync/client'
import type { OutboxRow } from '@/db/sync/outbox'
import { installTestDevice, testGid } from '@/test-fixtures'

const syncMocks = vi.hoisted(() => ({ listShopDevices: vi.fn() }))
vi.mock('@/db/sync/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/sync/client')>()
  return { ...original, listShopDevices: syncMocks.listShopDevices }
})

const deviceStateMocks = vi.hoisted(() => ({ markDeviceRevoked: vi.fn() }))
vi.mock('@/db/repositories/device-state', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/repositories/device-state')>()
  return { ...original, markDeviceRevoked: deviceStateMocks.markDeviceRevoked }
})

const NEO = { name: 'Neo đồng bộ' }
const NÚT = { name: 'Kiểm tra lại' }

// So bằng đúng chuỗi và chờ: nhánh 6–12 đi qua "Đang kiểm tra…" trước khi máy chủ trả lời.
async function chờNeo(text: string) {
  await waitFor(() => expect(screen.getByRole('status', NEO).textContent).toBe(text))
}

const outboxRow = (n: number): OutboxRow => ({
  eventId: testGid(100 + n),
  txId: testGid(200 + n),
  txOrder: 0,
  table: 'customers',
  entityKey: testGid(300 + n),
  entityGid: testGid(300 + n),
  operation: 'create',
  before: null,
  after: { gid: testGid(300 + n), name: 'Khách' },
  refs: {},
  localId: n + 1,
  status: 'pending',
  createdAt: Date.now(),
})

async function seed({
  connection = true,
  lastSeq = 5,
  resyncRequired = false,
  pairingSaved = false,
  revoked = false,
  pendingTx = 0,
} = {}) {
  await db.transaction('rw', db.deviceState, db.outbox, async () => {
    if (connection) {
      await db.deviceState.put({
        key: 'connection',
        shopId: testGid(1),
        token: 'token-thu-nghiem-du-dai-cho-ket-noi-1234567890',
        syncUrl: 'https://sync.example.com',
      })
    }
    await db.deviceState.put({ key: 'sync', lastSeq, revision: 1, resyncRequired, lastConnectedAt: null })
    if (pairingSaved) {
      await db.deviceState.put({
        key: 'pairing',
        attemptId: testGid(2),
        hasLocalLedger: false,
        localLedgerRows: 0,
        connectionSaved: true,
        expiresAt: Date.now() + 60_000,
      })
    }
    if (revoked) {
      await db.deviceState.put({ key: 'writeBlock', reason: 'revoked', shopId: testGid(1), createdAt: Date.now() })
    }
    for (let n = 0; n < pendingTx; n += 1) await db.outbox.add(outboxRow(n))
  })
}

const server = (latestSeq?: number) => (latestSeq === undefined ? { devices: [] } : { devices: [], latestSeq })

function renderPage() {
  return render(
    <MemoryRouter>
      <DoiSoatPage />
    </MemoryRouter>,
  )
}

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await installTestDevice()
  syncMocks.listShopDevices.mockReset().mockResolvedValue(server(5))
  deviceStateMocks.markDeviceRevoked.mockReset()
})

afterEach(cleanup)

describe('neo đồng bộ — 12 nhánh xét theo thứ tự', () => {
  it('1. máy đã bị thu hồi: câu đóng băng, không hỏi sổ chung, không có nút', async () => {
    await seed({ connection: false, revoked: true })
    renderPage()
    await chờNeo(
      'Máy này đã bị thu hồi khỏi sổ chung. Số dưới đây là bản đóng băng lúc bị thu hồi.',
    )
    expect(await screen.findByText('DOANH THU')).toBeDefined()
    expect(screen.queryByRole('button', NÚT)).toBeNull()
    expect(syncMocks.listShopDevices).not.toHaveBeenCalled()
  })

  it('2. đang kéo lại sổ: ẩn hẳn khối tổng', async () => {
    await seed({ resyncRequired: true })
    renderPage()
    await chờNeo(
      'App đang kéo lại toàn bộ sổ — chưa so được. Đợi băng trên đầu màn tắt rồi mở lại.',
    )
    expect(screen.queryByText('DOANH THU')).toBeNull()
    expect(screen.queryByRole('button', NÚT)).toBeNull()
    expect(syncMocks.listShopDevices).not.toHaveBeenCalled()
  })

  it('3. chưa ghép: sổ của riêng máy này, không hỏi sổ chung', async () => {
    await seed({ connection: false })
    renderPage()
    await chờNeo(
      'Máy này chưa ghép sổ chung. Số dưới đây là sổ của riêng máy này.',
    )
    expect(await screen.findByText('DOANH THU')).toBeDefined()
    expect(screen.queryByRole('button', NÚT)).toBeNull()
    expect(syncMocks.listShopDevices).not.toHaveBeenCalled()
  })

  it('4. đang hoàn tất ghép: không gọi /devices bằng token đang chờ admission', async () => {
    await seed({ pairingSaved: true })
    renderPage()
    await chờNeo(
      'Đang hoàn tất ghép máy — chưa đối soát được.',
    )
    expect(screen.queryByRole('button', NÚT)).toBeNull()
    expect(syncMocks.listShopDevices).not.toHaveBeenCalled()
  })

  it('4b. ghép xong (xoá dòng pairing): trang tự hỏi sổ chung, không kẹt ở "đang hoàn tất"', async () => {
    await seed({ pairingSaved: true, lastSeq: 5 })
    renderPage()
    await chờNeo('Đang hoàn tất ghép máy — chưa đối soát được.')
    await db.deviceState.delete('pairing')
    await chờNeo('✓ Khớp sổ chung — máy này ở thay đổi #5')
    expect(syncMocks.listShopDevices).toHaveBeenCalledTimes(1)
  })

  it('5. chưa có kết quả lần đọc đầu: đang kiểm tra, nút khoá', async () => {
    syncMocks.listShopDevices.mockReturnValue(new Promise(() => undefined))
    await seed()
    renderPage()
    await chờNeo('Đang kiểm tra sổ chung…')
    expect(await screen.findByRole('button', NÚT)).toHaveProperty('disabled', true)
  })

  it('6. mất mạng nhận biết bằng SyncApiError network, không đọc navigator.onLine', async () => {
    syncMocks.listShopDevices.mockRejectedValue(new SyncApiError('Chưa có mạng.', 'network', 0))
    await seed()
    renderPage()
    await chờNeo(
      'Chưa có mạng — số dưới đây là bản trên máy này.',
    )
    expect(await screen.findByRole('button', NÚT)).toBeDefined()
  })

  it('6b. mất mạng mà còn hàng đợi: câu neo vẫn nói số thay đổi chưa lên sổ chung', async () => {
    syncMocks.listShopDevices.mockRejectedValue(new SyncApiError('Chưa có mạng.', 'network', 0))
    await seed({ pendingTx: 2 })
    renderPage()
    await chờNeo(
      'Chưa có mạng — số dưới đây là bản trên máy này. 2 thay đổi trên máy này chưa lên sổ chung.',
    )
  })

  it('7. Worker cũ trả 200 thiếu latestSeq: chưa hỗ trợ, không rơi vào nhánh khớp', async () => {
    syncMocks.listShopDevices.mockResolvedValue(server())
    await seed()
    renderPage()
    await chờNeo(
      'Sổ chung chưa hỗ trợ đối soát — cần cập nhật máy chủ.',
    )
    // Đoạn hướng dẫn cuối trang có chữ "✓ Khớp sổ chung" hợp lệ — chỉ neo mới không được nói khớp.
    expect(screen.getByRole('status', NEO).textContent).not.toMatch(/Khớp/)
  })

  it('8. lỗi máy chủ khác: chưa đọc được', async () => {
    syncMocks.listShopDevices.mockRejectedValue(new SyncApiError('Lỗi', 'server', 500))
    await seed()
    renderPage()
    await chờNeo(
      'Chưa đọc được sổ chung — số dưới đây là bản trên máy này.',
    )
  })

  it('8b. 401 từ /devices: câu thu hồi, và trang không tự gọi markDeviceRevoked', async () => {
    syncMocks.listShopDevices.mockRejectedValue(new SyncApiError('Thu hồi', 'unauthorized', 401))
    await seed()
    renderPage()
    await chờNeo(
      'Máy này đã bị thu hồi khỏi sổ chung. Số dưới đây là bản đóng băng lúc bị thu hồi.',
    )
    expect(deviceStateMocks.markDeviceRevoked).not.toHaveBeenCalled()
  })

  it('9. còn hàng đợi: đếm theo txId, đứng trước nhánh so seq', async () => {
    await seed({ pendingTx: 2, lastSeq: 5 })
    renderPage()
    await chờNeo(
      '2 thay đổi trên máy này chưa lên sổ chung.',
    )
    // Neo tự tính lại theo outbox nhưng nội dung connection không đổi → chỉ hỏi sổ chung một lần.
    expect(syncMocks.listShopDevices).toHaveBeenCalledTimes(1)
  })

  it('10. sổ chung đi trước: còn N thay đổi chưa về máy này', async () => {
    syncMocks.listShopDevices.mockResolvedValue(server(7))
    await seed({ lastSeq: 3 })
    renderPage()
    await chờNeo(
      'Còn 4 thay đổi chưa về máy này.',
    )
  })

  it('11. số máy chủ cũ: tự hỏi lại một lần rồi mới bảo bấm Kiểm tra lại', async () => {
    syncMocks.listShopDevices.mockResolvedValue(server(5))
    await seed({ lastSeq: 9 })
    renderPage()
    await waitFor(() => expect(syncMocks.listShopDevices).toHaveBeenCalledTimes(2), { timeout: 5_000 })
    await chờNeo(
      'Sổ chung vừa có thay đổi mới — bấm Kiểm tra lại.',
    )

    // Một lần hỏi lại cho MỖI lastSeq mới, không phải một lần mỗi mount.
    await db.deviceState.put({ key: 'sync', lastSeq: 10, revision: 2, resyncRequired: false, lastConnectedAt: null })
    await waitFor(() => expect(syncMocks.listShopDevices).toHaveBeenCalledTimes(3), { timeout: 5_000 })
  }, 15_000)

  it('11b. lần hỏi lại trả số mới đủ: về nhánh khớp', async () => {
    syncMocks.listShopDevices.mockResolvedValueOnce(server(5)).mockResolvedValue(server(9))
    await seed({ lastSeq: 9 })
    renderPage()
    await waitFor(
      () =>
        expect(screen.getByRole('status', NEO).textContent).toBe('✓ Khớp sổ chung — máy này ở thay đổi #9'),
      { timeout: 5_000 },
    )
    expect(syncMocks.listShopDevices).toHaveBeenCalledTimes(2)
  }, 15_000)

  it('12. khớp: cùng seq, outbox rỗng — kèm bốn tổng và số dòng', async () => {
    await seed({ lastSeq: 5 })
    renderPage()
    await chờNeo(
      '✓ Khớp sổ chung — máy này ở thay đổi #5',
    )
    await screen.findByText('DOANH THU')
    for (const label of ['DOANH THU', 'ĐÃ THU', 'CHI PHÍ', 'CÒN NỢ']) {
      expect(screen.getByText(label)).toBeDefined()
    }
    expect(screen.getByText('Khoản thu')).toBeDefined()
    expect(screen.getByText(/gồm đơn đã hủy/)).toBeDefined()
    expect(screen.getByText(/so 2 máy/)).toBeDefined()
  })
})

describe('truy vấn tổng không chạm outbox', () => {
  it('getLedgerOverview không gọi db.outbox.toArray', async () => {
    const spy = vi.spyOn(db.outbox, 'toArray')
    const overview = await getLedgerOverview()
    expect(spy).not.toHaveBeenCalled()
    expect(overview.counts.map((row) => row.table)).not.toContain('settings')
    expect(overview.counts).toHaveLength(9)
    spy.mockRestore()
  })
})
