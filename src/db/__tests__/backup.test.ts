import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { collectBackup, countAllRecords, replaceAllData, wipeAllData } from '../backup'
import { db } from '../db'
import { recalcAll } from '../recalc'
import { createExpense, createExpenseCategory } from '../repositories/expenses'
import { createGroup, createItem, deleteItem } from '../repositories/items'
import { createCustomer, deleteCustomer } from '../repositories/customers'
import { savePriceBook } from '../repositories/customer-prices'
import { cleanPriceRows, parseBackupFile } from '@/domain/backup'
import { createOrder } from '../repositories/orders'
import { addOrderPayment } from '../repositories/payments'
import { saveShop } from '../repositories/settings'
import {
  beginDevicePairing,
  getDeviceConnection,
  savePairedDevice,
} from '../repositories/device-state'
import { installTestDevice, testGid } from '@/test-fixtures'

const soldAt = new Date(2026, 7, 7, 10, 0).getTime()
const exportedAt = new Date(2026, 7, 7, 14, 0).getTime()

/**
 * Một cửa hàng thu nhỏ nhưng đủ mọi bảng — sao lưu mà rơi một bảng là mất tiền thật.
 *
 * Mọi trường tuỳ chọn đều được điền **khác giá trị mặc định** (ghi chú, địa chỉ, nhóm, giá nhập,
 * giảm giá, phụ thu): để trống thì một bản sao lưu đánh rơi hẳn trường đó vẫn khớp lại y hệt và
 * không test nào kêu.
 */
async function seedShop() {
  await saveShop({
    name: 'Tạp hoá Cô Ba',
    phone: '0900000000',
    address: '12 Lê Lợi, P.3',
    footerNote: 'Hẹn gặp lại!',
  })
  const groupId = await createGroup({ name: 'Món nước', sortOrder: 10 })
  const customerId = await createCustomer({
    name: 'Chị Hoa',
    phone: '0911',
    address: 'Cuối hẻm 5',
    note: 'Trả cuối tháng',
  })
  const itemId = await createItem({
    name: 'Phở',
    groupId,
    unit: 'tô',
    unitPrice: 50_000,
    costPrice: 20_000,
    isActive: 1,
    note: 'Không hành',
  })
  await savePriceBook(customerId, [{ itemId, unitPrice: 45_000 }])
  const categoryId = await createExpenseCategory({ name: 'Nguyên liệu' })
  await createExpense({ categoryId, amount: 300_000, note: 'Chợ', spentAt: soldAt })

  const { id } = await createOrder({
    customerId,
    customerName: 'Chị Hoa',
    lines: [{ itemId, name: 'Phở', unit: 'tô', unitPrice: 50_000, costPrice: 20_000, qty: 2 }],
    discount: 5_000,
    surcharge: 5_000,
    soldAt,
    note: 'Giao trước 11h',
    payment: null,
  })
  await addOrderPayment({ orderId: id, amount: 40_000, method: 'cash', paidAt: soldAt, note: 'Trả trước' })
  return id
}

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await installTestDevice()
})

describe('collectBackup', () => {
  it('gom đủ mọi bảng và đóng dấu app/version để nhận ra file lạ', async () => {
    await seedShop()

    const file = await collectBackup(exportedAt)

    expect(file.app).toBe('my-biller')
    expect(file.version).toBe(4)
    expect(file.exportedAt).toBe(new Date(exportedAt).toISOString())
    expect(Object.entries(file.data).filter(([, rows]) => rows.length === 0)).toEqual([])
  })

  it('một bản ghi lạ không làm chết cả lần sao lưu', async () => {
    await seedShop()
    // Ghi thẳng vào bảng, không qua schema: giả cảnh bản build cũ hoặc người dùng sửa tay qua DevTools.
    // Sao lưu chết ở đây là khoá luôn đường nhập file, vì nhập file có xuất bản an toàn trước.
    await db.items.add({
      gid: testGid(99),
      name: 'Hàng lạ',
      groupId: null,
      unit: '',
      unitPrice: 25_500.5,
      costPrice: null,
      isActive: 1,
      note: '',
      createdAt: soldAt,
      updatedAt: soldAt,
    })

    expect((await collectBackup(exportedAt)).data.items).toHaveLength(2)
  })
})

describe('xuất → xoá → nhập', () => {
  it('mọi số khớp lại 100%, id giữ nguyên nên dòng đơn vẫn dính đúng đơn', async () => {
    const orderId = await seedShop()
    const file = await collectBackup(exportedAt)
    const before = await countAllRecords()

    await wipeAllData()
    expect(await countAllRecords()).toBe(0)

    await replaceAllData(file.data)

    expect(await countAllRecords()).toBe(before)
    expect(await db.orders.get(orderId)).toMatchObject({ total: 100_000, paidAmount: 40_000, status: 'partial' })
    expect(await db.orderLines.where('orderId').equals(orderId).count()).toBe(1)
    expect(await db.payments.where('orderId').equals(orderId).count()).toBe(1)
    expect((await collectBackup(exportedAt)).data).toEqual(file.data)
  })

  it('file có paidAmount sai thì recalcAll dựng lại theo payments, không tin con số trong file', async () => {
    const orderId = await seedShop()
    const file = await collectBackup(exportedAt)

    // Giả cảnh file bị sửa tay hoặc đến từ bản cũ có bug: đơn ghi đã trả đủ mà chỉ có 1 phiếu thu 40k.
    const broken = {
      ...file.data,
      orders: file.data.orders.map((order) => ({ ...order, paidAmount: order.total, status: 'paid' as const })),
    }

    await replaceAllData(broken)
    expect(await recalcAll()).toBe(1)
    expect(await db.orders.get(orderId)).toMatchObject({ paidAmount: 40_000, status: 'partial' })
  })

  it('đơn huỷ vẫn là huỷ sau khi nhập, phiếu thu còn nguyên nhưng không phân bổ', async () => {
    const orderId = await seedShop()
    // Đặt thẳng `status` chứ không gọi `voidOrder`: giả đúng cảnh file sao lưu có đơn huỷ mà phiếu
    // thu vẫn còn — `recalcAll` không được để đơn "Đã huỷ" hiện "Đã thu 40.000 đ".
    await db.orders.update(orderId, { status: 'void' })
    const file = await collectBackup(exportedAt)

    await wipeAllData()
    await replaceAllData(file.data)
    await recalcAll()

    expect(await db.orders.get(orderId)).toMatchObject({ status: 'void', paidAmount: 0 })
    expect(await db.payments.where('orderId').equals(orderId).toArray()).toMatchObject([
      { amount: 40_000, allocatedOrderId: 0 },
    ])
  })

  it('recalcAll không đóng dấu ngày nhập lên đơn cũ', async () => {
    const orderId = await seedShop()
    await db.orders.update(orderId, { paidAmount: 999, updatedAt: soldAt })

    expect(await recalcAll()).toBe(1)
    expect((await db.orders.get(orderId))?.updatedAt).toBe(soldAt)
  })
})

describe('replaceAllData', () => {
  it('nạp file rỗng thì sạch bảng, không trộn với dữ liệu cũ', async () => {
    await seedShop()
    const empty = (await collectBackup(exportedAt)).data
    for (const key of Object.keys(empty) as (keyof typeof empty)[]) {
      Object.assign(empty, { [key]: [] })
    }

    await replaceAllData(empty)

    expect(await countAllRecords()).toBe(0)
  })

  /**
   * Rác trong bảng giá **không** chặn cả file: dòng mồ côi không bao giờ được đọc nên không đụng tới
   * đồng nào, mà chặn thì đường ra duy nhất là sửa tay JSON. Bỏ dòng, và số dòng bỏ đã được nói ra ở
   * cửa xác nhận trước đó.
   */
  it('dòng giá mồ côi trong file bị bỏ, phần còn lại vẫn nhập bình thường', async () => {
    await seedShop()
    const data = (await collectBackup(exportedAt)).data
    const mồCôi = { gid: testGid(99), id: 99, customerId: 404, itemId: 404, unitPrice: 1_000, createdAt: soldAt, updatedAt: soldAt }

    await replaceAllData({ ...data, customerPrices: [...data.customerPrices, mồCôi] })

    expect(await db.customerPrices.count()).toBe(1)
    expect(await db.customerPrices.get(99)).toBeUndefined()
  })

  /**
   * Xoá món và xoá khách kéo theo dòng giá riêng **trong cùng transaction** (`deleteByItem` /
   * `deleteByCustomer`). Ca này soi hệ quả ở đúng chỗ đắt nhất: file xuất ngay sau lần xoá. Sót lại một
   * dòng mồ côi thì file vẫn nhập được — bảng giá là bảng mềm — nhưng mỗi vòng sao lưu lại đội thêm một
   * dòng rác và một dòng "sẽ bị bỏ" ở cửa xác nhận, huấn luyện người bán bấm-cho-qua.
   */
  it('xoá món và xoá khách chưa từng bán → file xuất ngay sau đó nhập lại được, không đẻ dòng mồ côi', async () => {
    await seedShop()
    const customerId = await createCustomer({ name: 'Anh Tư', phone: '', address: '', note: '' })
    const itemId = await createItem({
      name: 'Trà đá',
      groupId: null,
      unit: 'ly',
      unitPrice: 3_000,
      costPrice: null,
      isActive: 1,
    })
    await savePriceBook(customerId, [{ itemId, unitPrice: 2_000 }])

    await deleteItem(itemId)
    await deleteCustomer(customerId)

    const file = await collectBackup(exportedAt)
    const parsed = parseBackupFile(JSON.stringify(file))
    expect(cleanPriceRows(parsed.data).dropped).toBe(0)

    await replaceAllData(parsed.data)
    expect(await db.customerPrices.count()).toBe(1)
  })
})

describe('khóa ghi đè sổ khi ghép máy', () => {
  it('kiểm lại trong transaction dù tab nhập file đã thấy trạng thái chưa kết nối trước đó', async () => {
    await seedShop()
    const before = await collectBackup(exportedAt)
    const beforeCount = await countAllRecords()

    // Kết quả này tượng trưng cho pre-check đã cũ của tab nhập file. Quyết định cuối cùng phải nằm
    // trong transaction của `replaceAllData`, sau transaction ghép máy đang giữ cùng các bảng.
    expect(await getDeviceConnection()).toBeUndefined()
    const pairing = await beginDevicePairing()
    await expect(wipeAllData()).rejects.toThrow(/đang ghép/)
    await savePairedDevice({
      pairingAttemptId: pairing.attemptId,
      admissionExpiresAt: Date.now() + 60_000,
      deviceId: '00000000-0000-4000-8000-000000000011',
      label: 'Quầy trước',
      letter: 'A',
      shopId: '00000000-0000-4000-8000-000000000012',
      token: 'token-thu-nghiem-du-dai-cho-ket-noi-1234567890',
      syncUrl: 'https://sync.example.com',
    })
    const staged = await db.outbox.count()

    const empty = structuredClone(before.data)
    for (const key of Object.keys(empty) as (keyof typeof empty)[]) empty[key] = []
    await expect(replaceAllData(empty)).rejects.toThrow(/đã ghép/)

    expect(await countAllRecords()).toBe(beforeCount)
    expect(await db.outbox.count()).toBe(staged)
    expect(staged).toBe(beforeCount)
    expect(await db.deviceState.get('pairing')).toMatchObject({ connectionSaved: true })
  })
})
