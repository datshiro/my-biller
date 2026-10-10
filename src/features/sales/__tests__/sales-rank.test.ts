import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSalesRankCache, loadSalesRank } from '../sales-rank'
import { db } from '@/db/db'
import { createItem } from '@/db/repositories/items'
import { createOrder, voidOrder, WIDE_QUERY } from '@/db/repositories/orders'
import { installTestDevice, testGid } from '@/test-fixtures'

const { lineQuery, docDon } = vi.hoisted(() => ({
  lineQuery: vi.fn<(orderCount: number) => void>(),
  docDon: { loi: false, soLanDoc: 0 },
}))

vi.mock('@/db/repositories/orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/repositories/orders')>()
  return {
    ...actual,
    listOrdersBetween: (from: number, to: number) => {
      docDon.soLanDoc += 1
      if (docDon.loi) return Promise.reject(new Error('Đọc đơn hỏng'))
      return actual.listOrdersBetween(from, to)
    },
    listOrderLinesOfOrders: (orderIds: readonly number[]) => {
      lineQuery(orderIds.length)
      return actual.listOrderLinesOfOrders(orderIds)
    },
  }
})

const MOT_GIO = 3_600_000
const MOT_NGAY = 86_400_000
/** 10:00 ngày 11/10/2026 theo giờ địa phương, cùng múi giờ với bộ test (Asia/Ho_Chi_Minh). */
const BAY_GIO = new Date(2026, 9, 11, 10).getTime()

beforeEach(async () => {
  resetSalesRankCache()
  lineQuery.mockClear()
  docDon.loi = false
  docDon.soLanDoc = 0
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await installTestDevice()
})

const taoMon = (name: string, unitPrice: number) =>
  createItem({ name, groupId: null, unit: 'ly', unitPrice, costPrice: 0, isActive: 1 })

/** Một đơn tiền mặt trả đủ, mỗi phần tử là `[itemId, tên, đơn giá, số lượng]`. */
function banDon(lines: [number, string, number, number][], soldAt: number) {
  const total = lines.reduce((sum, [, , price, qty]) => sum + price * qty, 0)
  return createOrder({
    customerId: null,
    customerName: 'Khách lẻ',
    lines: lines.map(([itemId, name, unitPrice, qty]) => ({
      itemId,
      name,
      unit: 'ly',
      unitPrice,
      costPrice: 0,
      qty,
    })),
    discount: 0,
    surcharge: 0,
    soldAt,
    note: '',
    payment: { amount: total, method: 'cash', note: '' },
  })
}

describe('thứ hạng bán chạy', () => {
  it('đơn đã huỷ không đưa món vào thứ hạng', async () => {
    const pho = await taoMon('Phở bò', 55_000)
    const tra = await taoMon('Trà đá', 3_000)
    const { id: donHuy } = await banDon([[pho, 'Phở bò', 55_000, 10]], BAY_GIO - MOT_GIO)
    await banDon([[tra, 'Trà đá', 3_000, 1]], BAY_GIO - 2 * MOT_GIO)
    await voidOrder(donHuy)

    const rank = await loadSalesRank(BAY_GIO)

    expect(rank.get(pho)).toBeUndefined()
    expect(rank.get(tra)).toBe(0)
    expect(rank.size).toBe(1)
  })

  it('xếp theo doanh thu như bảng bán chạy của Báo cáo, không theo số lượng bán', async () => {
    const pho = await taoMon('Phở bò', 55_000)
    const tra = await taoMon('Trà đá', 3_000)
    // Trà đá bán 10 ly mà chỉ 30.000; Phở bò bán 1 tô mà 55.000 — theo doanh thu Phở đứng trước.
    await banDon([[tra, 'Trà đá', 3_000, 10]], BAY_GIO - MOT_GIO)
    await banDon([[pho, 'Phở bò', 55_000, 1]], BAY_GIO - MOT_GIO)

    const rank = await loadSalesRank(BAY_GIO)

    expect(rank.get(pho)).toBe(0)
    expect(rank.get(tra)).toBe(1)
  })

  it('cùng ngày dùng lại kết quả đã đọc, sang ngày mới thì đọc lại', async () => {
    const pho = await taoMon('Phở bò', 55_000)
    const tra = await taoMon('Trà đá', 3_000)
    await banDon([[tra, 'Trà đá', 3_000, 1]], BAY_GIO - 2 * MOT_GIO)
    const sangNay = await loadSalesRank(BAY_GIO)

    await banDon([[pho, 'Phở bò', 55_000, 4]], BAY_GIO - MOT_GIO)

    // Cùng ngày: trả đúng đối tượng đã cache, đơn mới chưa vào thứ hạng.
    const cungNgay = await loadSalesRank(BAY_GIO + MOT_GIO)
    expect(cungNgay).toBe(sangNay)
    expect(cungNgay.get(pho)).toBeUndefined()

    // Sang ngày mới: đọc lại sổ, đơn vừa bán đưa Phở bò lên đầu.
    const ngayMai = await loadSalesRank(BAY_GIO + MOT_NGAY)
    expect(ngayMai).not.toBe(sangNay)
    expect(ngayMai.get(pho)).toBe(0)
    expect(ngayMai.get(tra)).toBe(1)
  })

  it('đọc hỏng thì trả thứ hạng rỗng, báo lỗi, và lượt sau cùng ngày không đọc lại', async () => {
    const pho = await taoMon('Phở bò', 55_000)
    await banDon([[pho, 'Phở bò', 55_000, 1]], BAY_GIO - MOT_GIO)
    docDon.loi = true
    const loi = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const hong = await loadSalesRank(BAY_GIO)

    expect(hong.size).toBe(0)
    expect(loi).toHaveBeenCalledWith('Không đọc được thứ hạng bán chạy:', expect.any(Error))
    loi.mockRestore()

    // Sổ đọc được trở lại trong ngày vẫn không đổi thứ hạng: lưới không được xếp lại giữa ca.
    docDon.loi = false
    const lanSau = await loadSalesRank(BAY_GIO + MOT_GIO)
    expect(lanSau).toBe(hong)
    expect(docDon.soLanDoc).toBe(1)
  })

  it('từ 1.500 đơn trở lên không đi nhánh quét cả bảng: hỏi dòng hàng dưới ngưỡng', async () => {
    const tra = await taoMon('Trà đá', 3_000)
    const mau = await banDon([[tra, 'Trà đá', 3_000, 1]], BAY_GIO - MOT_GIO)
    const [mauDon, mauDong] = await Promise.all([db.orders.get(mau.id), db.orderLines.where('orderId').equals(mau.id).first()])
    if (!mauDon || !mauDong) throw new Error('Không dựng được đơn mẫu.')

    const donThem = Array.from({ length: WIDE_QUERY + 100 }, (_, i) => ({
      ...mauDon,
      gid: testGid(10_000 + i),
      code: `THU-${i}`,
      soldAt: BAY_GIO - (i + 2) * 60_000,
    }))
    donThem.forEach((don) => delete don.id)
    const idDon = await db.orders.bulkAdd(donThem, { allKeys: true })
    const dongThem = idDon.map((orderId, i) => ({ ...mauDong, gid: testGid(50_000 + i), orderId }))
    dongThem.forEach((dong) => delete dong.id)
    await db.orderLines.bulkAdd(dongThem)

    const rank = await loadSalesRank(BAY_GIO)

    expect(lineQuery).toHaveBeenCalledTimes(1)
    // 1.601 đơn trong kỳ, giữ WIDE_QUERY - 1 đơn mới nhất: đúng 1.499 id, không phải 1.500.
    expect(lineQuery.mock.calls[0]?.[0]).toBe(WIDE_QUERY - 1)
    expect(rank.get(tra)).toBe(0)
  }, 60_000)
})
