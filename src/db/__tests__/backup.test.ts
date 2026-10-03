import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  collectBackup,
  countAllRecords,
  getRestoreBlock,
  mergeAllDataAndRecalculate,
  replaceAllData,
  replaceAllDataAndRecalculate,
  RestoreBlockedError,
  wipeAllData,
} from '../backup'
import { getLedgerOverview } from '../doi-soat-snapshot'
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
import { findPaymentConflicts, MergeReviewError, previewMerge, type PaymentChoice } from '@/domain/backup-merge'
import { buildRestoreReport, expectedAfterReplace, toReportActual } from '@/domain/backup-report'
import { ledgerTotals } from '@/domain/doi-soat'
import type { BackupData } from '@/domain/schema'
import { emptyLedger, g, ledgerK, mk, shiftIds } from '@/domain/__tests__/backup-merge-fixtures'

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
    logo: 'data:image/png;base64,iVBORw0KGgo=',
    labelWatermark: { enabled: true, position: 'corner', strength: 'dark', align: 'right' },
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

const K = g(3)
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
  expiresAt: Date.now() + 60_000,
}
const writeBlockRow = { key: 'writeBlock' as const, reason: 'revoked' as const, shopId: null, createdAt: 1 }

async function ledgerNow(): Promise<BackupData> {
  return (await collectBackup(exportedAt)).data
}

async function reseed(data: BackupData): Promise<void> {
  await wipeAllData()
  await replaceAllData(data)
}

/** Đúng đường màn xem trước sẽ đi: đọc sổ, tính dấu vân tay, rồi mới ghi với các câu trả lời. */
async function mergeAnswering(file: BackupData, choices: Readonly<Record<string, PaymentChoice>>) {
  const answered = findPaymentConflicts(await ledgerNow(), file).map((conflict) => conflict.fingerprint)
  return mergeAllDataAndRecalculate(file, choices, answered)
}

async function debtNow(customerGid = K): Promise<number> {
  return (await getLedgerOverview()).totals.debtByCustomerGid.get(customerGid) ?? 0
}

async function reportNow(expected: Parameters<typeof buildRestoreReport>[0]) {
  return buildRestoreReport(expected, toReportActual(await getLedgerOverview()))
}

function omit<T extends object, Key extends keyof T>(row: T, ...keys: Key[]): Omit<T, Key> {
  const copy = { ...row }
  for (const key of keys) delete copy[key]
  return copy
}

/** File sao lưu của sổ K ở từng version, đúng hình dạng bản cũ đã ghi ra (v1–v3 mã đơn chưa có chữ máy). */
function fileText(version: 1 | 2 | 3 | 4): string {
  const data = ledgerK()
  const letterless = data.orders.map((row, index) => ({ ...row, code: `PBH-261001-${String(index + 1).padStart(3, '0')}` }))
  const v4 = { ...data, orders: version === 4 ? data.orders : letterless }
  const v3 = { ...v4, payments: v4.payments.map((row) => omit(row, 'allocatedOrderId')) }
  const noGid = <T extends { gid: string }>(rows: T[]) => rows.map((row) => omit(row, 'gid'))
  const v2 = {
    settings: v3.settings,
    itemGroups: noGid(v3.itemGroups),
    items: noGid(v3.items),
    customers: noGid(v3.customers),
    customerPrices: noGid(v3.customerPrices),
    orders: noGid(v3.orders),
    orderLines: noGid(v3.orderLines),
    payments: noGid(v3.payments),
    expenseCategories: noGid(v3.expenseCategories),
    expenses: noGid(v3.expenses),
  }
  const byVersion = { 1: omit(v2, 'customerPrices'), 2: v2, 3: v3, 4: v4 }
  return JSON.stringify({ app: 'my-biller', version, appVersion: '1.0.0', exportedAt: new Date(exportedAt).toISOString(), data: byVersion[version] })
}

/** Máy: khoản 1 đã trả lại khách, khoản 2 đã bỏ. File: cả hai còn `pending`. */
function twoConflicts() {
  const device = ledgerK()
  device.payments[0] = { ...device.payments[0]!, unallocatedStatus: 'refunded', resolutionNote: 'Đã trả lại' }
  device.payments[1] = { ...device.payments[1]!, unallocatedStatus: 'discarded', resolutionNote: 'Ghi nhầm' }
  return { device, file: shiftIds(ledgerK(), 10) }
}

describe('getRestoreBlock và chốt chặn', () => {
  it('trả đúng lý do cho từng khoá deviceState, null khi không có gì', async () => {
    expect(await getRestoreBlock()).toBeNull()

    for (const [row, reason] of [
      [connectionRow, 'connected'],
      [pairingRow, 'pairing'],
      [writeBlockRow, 'revoked'],
    ] as const) {
      await db.deviceState.put(row)
      expect(await getRestoreBlock()).toBe(reason)
      await db.deviceState.delete(row.key)
    }
  })

  it('ghép lại máy đã bị thu hồi ⇒ đang ghép; đang ghép đã lưu kết nối ⇒ vẫn là đang ghép', async () => {
    await db.deviceState.bulkPut([writeBlockRow, pairingRow])
    expect(await getRestoreBlock()).toBe('pairing')

    await db.deviceState.delete('writeBlock')
    await db.deviceState.put(connectionRow)
    expect(await getRestoreBlock()).toBe('pairing')
  })

  it.each([
    [connectionRow, 'connected'],
    [pairingRow, 'pairing'],
    [writeBlockRow, 'revoked'],
  ] as const)('%#: Gộp và Ghi đè ném RestoreBlockedError đúng lý do, giữ câu cũ, không đụng dữ liệu', async (row, reason) => {
    await replaceAllData(ledgerK())
    const before = await ledgerNow()
    await db.deviceState.put(row)

    for (const write of [
      () => mergeAllDataAndRecalculate(shiftIds(ledgerK(), 10), {}, []),
      () => replaceAllDataAndRecalculate(emptyLedger()),
    ]) {
      const error = await write().catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(RestoreBlockedError)
      expect(error).toMatchObject({ reason, message: expect.stringMatching(/Máy đã ghép, đang ghép hoặc đã bị thu hồi/) })
    }
    expect(await ledgerNow()).toEqual(before)
  })

  /**
   * Màn xem trước đọc "chưa ghép" rồi một tab khác ghi `connection` ngay trước khi lệnh gộp mở khoá. Lệnh
   * ghi kết nối được xếp hàng trước nên IndexedDB chạy nó trước; kiểm trong khoá phải thấy nó và chặn.
   * Không thể chen vào **giữa** callback: khoá rw giữ `deviceState` nên ghi đến sau phải đợi khoá đóng.
   */
  it('một tab ghi connection ngay trước khi khoá gộp mở ⇒ RestoreBlockedError, sổ nguyên', async () => {
    const { device, file } = twoConflicts()
    await replaceAllData(device)
    const before = await ledgerNow()
    const conflicts = findPaymentConflicts(before, file)
    expect(await getRestoreBlock()).toBeNull()

    const competing = db.deviceState.put(connectionRow)
    const merge = mergeAllDataAndRecalculate(
      file,
      Object.fromEntries(conflicts.map((conflict) => [conflict.gid, 'file' as const])),
      conflicts.map((conflict) => conflict.fingerprint),
    )

    await expect(merge).rejects.toMatchObject({ name: 'RestoreBlockedError', reason: 'connected' })
    await competing
    expect(await ledgerNow()).toEqual(before)
  })
})

describe('mergeAllDataAndRecalculate', () => {
  it.each<PaymentChoice>(['device', 'file'])('gộp cùng file hai lần với lựa chọn %s ⇒ sổ sau lần một và lần hai giống hệt', async (choice) => {
    const { device, file } = twoConflicts()
    file.orders.push(mk.order(60, 60, 70_000, { code: 'PBH-261001-A001', customerId: 11 }))
    file.payments.push(mk.payment(60, 61, 60, 20_000, { customerId: 11 }))
    await replaceAllData(device)
    const answer = async () =>
      Object.fromEntries(findPaymentConflicts(await ledgerNow(), file).map((conflict) => [conflict.gid, choice]))

    await mergeAnswering(file, await answer())
    const first = await ledgerNow()
    await mergeAnswering(file, await answer())

    expect(await ledgerNow()).toEqual(first)
    expect(await db.payments.count()).toBe(device.payments.length + 1)
  })

  type Kind = 'phân bổ khác đơn' | 'hoàn tiền' | 'bỏ'
  const kinds: Kind[] = ['phân bổ khác đơn', 'hoàn tiền', 'bỏ']
  const choices: PaymentChoice[] = ['device', 'file', 'append']

  it.each(kinds.flatMap((kind) => choices.map((choice) => [kind, choice] as const)))(
    '%s + %s ⇒ dòng khoản thu, tiền đơn và nợ khách trong DB khớp đúng số xem trước báo',
    async (kind, choice) => {
      const device = ledgerK()
      const file = shiftIds(ledgerK(), 10)
      if (kind === 'phân bổ khác đơn') file.payments[2] = { ...file.payments[2]!, allocatedOrderId: 11 }
      if (kind === 'hoàn tiền') device.payments[0] = { ...device.payments[0]!, unallocatedStatus: 'refunded' }
      if (kind === 'bỏ') device.payments[1] = { ...device.payments[1]!, unallocatedStatus: 'discarded' }
      await replaceAllData(device)
      const [conflict] = findPaymentConflicts(device, file)
      const answer = { [conflict!.gid]: choice }
      const preview = previewMerge(device, file, answer, 'A')
      if (preview.blocked !== null) throw new Error('blocked')

      const { expected } = await mergeAnswering(file, answer)

      const stored = await db.payments.where('gid').equals(conflict!.gid).first()
      const source = choice === 'file' ? conflict!.file : conflict!.device
      expect(stored?.unallocatedStatus ?? 'pending').toBe(source.unallocatedStatus ?? 'pending')
      expect(stored?.id).toBe(conflict!.device.id)
      expect(await db.payments.count()).toBe(device.payments.length + (choice === 'append' ? 1 : 0))
      expect(await debtNow()).toBe(preview.debtByCustomer[K]?.after)
      expect((await getLedgerOverview()).totals.collected).toBe(preview.totals.collected.after)
      const orders = await db.orders.toArray()
      expect(orders.map(({ gid, paidAmount, status }) => ({ gid, paidAmount, status }))).toEqual(
        expected.data.orders.map(({ gid, paidAmount, status }) => ({ gid, paidAmount, status })),
      )
    },
  )

  it('hai xung đột cùng khách K: với cả 9 tổ hợp, nợ xem trước bằng nợ đọc từ DB sau khi ghi', async () => {
    const { device, file } = twoConflicts()
    const [first, second] = findPaymentConflicts(device, file).map((conflict) => conflict.gid) as [string, string]

    for (const a of choices) {
      for (const b of choices) {
        await reseed(device)
        const answer = { [first]: a, [second]: b }
        const preview = previewMerge(device, file, answer, 'A')
        if (preview.blocked !== null) throw new Error('blocked')

        await mergeAnswering(file, answer)

        expect(await debtNow()).toBe(preview.debtByCustomer[K]?.after)
      }
    }
  })

  it('sổ đổi giữa xem trước và ghi — thêm một xung đột mới ⇒ ném, dữ liệu nguyên', async () => {
    const device = ledgerK()
    device.payments[0] = { ...device.payments[0]!, unallocatedStatus: 'refunded' }
    const file = shiftIds(ledgerK(), 10)
    await replaceAllData(device)
    const conflicts = findPaymentConflicts(device, file)
    await db.payments.update(device.payments[1]!.id, { unallocatedStatus: 'discarded' })
    const before = await ledgerNow()

    await expect(
      mergeAllDataAndRecalculate(file, { [conflicts[0]!.gid]: 'file' }, conflicts.map((conflict) => conflict.fingerprint)),
    ).rejects.toThrow(MergeReviewError)
    expect(await ledgerNow()).toEqual(before)
  })

  it('sổ đổi giữa xem trước và ghi — cùng gid, nội dung khoản thu đang xung đột đổi ⇒ ném, dữ liệu nguyên', async () => {
    const device = ledgerK()
    device.payments[0] = { ...device.payments[0]!, unallocatedStatus: 'refunded' }
    const file = shiftIds(ledgerK(), 10)
    await replaceAllData(device)
    const conflicts = findPaymentConflicts(device, file)
    // Trên máy, khoản đã trả lại được gắn vào đơn nợ sau khi xem trước: gid y nguyên, nội dung khác.
    await db.payments.update(device.payments[0]!.id, { unallocatedStatus: 'pending', allocatedOrderId: 1 })
    const before = await ledgerNow()
    expect(findPaymentConflicts(before, file).map((conflict) => conflict.gid)).toEqual(conflicts.map((conflict) => conflict.gid))

    await expect(
      mergeAllDataAndRecalculate(file, { [conflicts[0]!.gid]: 'file' }, conflicts.map((conflict) => conflict.fingerprint)),
    ).rejects.toThrow(/Sổ vừa thay đổi/)
    expect(await ledgerNow()).toEqual(before)
  })

  it('bộ lựa chọn làm sổ hỏng lọt tới bước ghi ⇒ ném câu cho người bán, dữ liệu nguyên', async () => {
    const device = ledgerK()
    device.payments[0] = { ...device.payments[0]!, unallocatedStatus: 'refunded' }
    const file = shiftIds(ledgerK(), 10)
    file.payments[0] = { ...file.payments[0]!, orderId: 404 }
    await replaceAllData(device)
    const before = await ledgerNow()

    await expect(mergeAnswering(file, { [device.payments[0]!.gid]: 'file' })).rejects.toThrow(/Lựa chọn này làm sổ hỏng/)
    expect(await ledgerNow()).toEqual(before)
  })

  it('máy có đơn bán sau lần sao lưu trùng code với đơn trong file ⇒ không ConstraintError, đơn file mang mã mới', async () => {
    const device = ledgerK()
    device.orders.push(mk.order(5, 91, 10_000, { code: 'PBH-261001-A005' }))
    const file = shiftIds(ledgerK(), 10)
    file.orders.push(mk.order(15, 90, 20_000, { code: 'PBH-261001-A005', customerId: 11 }))
    await replaceAllData(device)

    const { summary } = await mergeAnswering(file, {})

    expect(await db.orders.where('gid').equals(g(90)).first()).toMatchObject({ code: 'PBH-261001-A006', originalCode: 'PBH-261001-A005' })
    expect(await db.orders.where('gid').equals(g(91)).first()).toMatchObject({ code: 'PBH-261001-A005' })
    expect(summary.codeChanges).toHaveLength(1)
  })

  it('paidAmount/status sau gộp theo payments: đơn có khoản thu chỉ ở file, đơn chỉ ở máy', async () => {
    const device = ledgerK()
    device.orders.push(mk.order(5, 91, 10_000, { code: 'PBH-261001-A005', paidAmount: 10_000, status: 'paid' }))
    device.payments.push(mk.payment(5, 92, 5, 10_000))
    const file = shiftIds(ledgerK(), 10)
    file.payments.push(mk.payment(30, 93, 11, 100_000, { customerId: 11 }))
    await replaceAllData(device)

    await mergeAnswering(file, {})

    expect(await db.orders.where('gid').equals(g(10)).first()).toMatchObject({ paidAmount: 100_000, status: 'partial' })
    expect(await db.orders.where('gid').equals(g(91)).first()).toMatchObject({ paidAmount: 10_000, status: 'paid' })
  })

  it('đọc chữ máy trong khoá: file v1 mã không chữ gộp vào sổ đã có chính nó ⇒ mã mới chữ A, đơn gấp đôi', async () => {
    await replaceAllData(parseBackupFile(fileText(1)).data)
    const file = parseBackupFile(fileText(1))

    const { summary } = await mergeAnswering(file.data, {})

    expect(await db.orders.count()).toBe(8)
    expect(summary.codeChanges.map((change) => change.code)).toEqual(['PBH-261001-A001', 'PBH-261001-A002', 'PBH-261001-A003', 'PBH-261001-A004'])
  })

  it('máy chưa có danh tính ⇒ chữ dự phòng B', async () => {
    await db.deviceState.delete('identity')
    await replaceAllData(parseBackupFile(fileText(1)).data)

    const { summary } = await mergeAnswering(parseBackupFile(fileText(1)).data, {})

    expect(summary.codeChanges[0]?.code).toBe('PBH-261001-B001')
  })

  /**
   * Bản kỳ vọng tính thuần từ sổ gộp phải bằng sổ DB sau `recalcAll`. Ca này gom đủ những thứ làm
   * `paidAmount` đổi: khoản thu mới trừ vào đơn đã có, khoản thu *Thêm riêng*, và đơn bị huỷ trong file
   * (mới hơn) trong khi máy còn khoản thu đang trừ vào chính đơn đó — `recalcAll` phải bỏ phân bổ.
   */
  it('parity Gộp: báo cáo ok, tổng nợ và paidAmount từng đơn của bản kỳ vọng bằng DB', async () => {
    const device = ledgerK()
    device.payments[0] = { ...device.payments[0]!, unallocatedStatus: 'refunded' }
    device.payments.push(mk.payment(9, 29, 4, 40_000))
    device.orders[3] = { ...device.orders[3]!, paidAmount: 100_000, status: 'paid' }
    const file = shiftIds(ledgerK(), 10)
    file.payments.push(mk.payment(40, 70, 11, 40_000, { customerId: 11 }))
    file.orders[3] = { ...file.orders[3]!, status: 'void', paidAmount: 0, updatedAt: 9 }
    file.payments[2] = { ...file.payments[2]!, allocatedOrderId: 0 }
    await replaceAllData(device)
    const answer = { [device.payments[0]!.gid]: 'append' as const, [device.payments[2]!.gid]: 'device' as const }

    const { expected } = await mergeAnswering(file, answer)
    const overview = await getLedgerOverview()
    const report = buildRestoreReport(expected, toReportActual(overview))

    expect(report.ok).toBe(true)
    expect(ledgerTotals(expected.data).debtTotal).toBe(overview.totals.debtTotal)
    const dbOrders = await db.orders.toArray()
    expect(dbOrders.map(({ gid, paidAmount, status }) => ({ gid, paidAmount, status }))).toEqual(
      expected.data.orders.map(({ gid, paidAmount, status }) => ({ gid, paidAmount, status })),
    )
    const dbPayments = await db.payments.toArray()
    expect(dbPayments.map(({ gid, allocatedOrderId }) => ({ gid, allocatedOrderId }))).toEqual(
      expected.data.payments.map(({ gid, allocatedOrderId }) => ({ gid, allocatedOrderId })),
    )
    expect(await db.payments.where('allocatedOrderId').equals(4).count()).toBe(0)
  })

  it('parity Ghi đè: bản kỳ vọng thuần bằng DB sau replaceAllDataAndRecalculate', async () => {
    const data = ledgerK()
    data.orders[0] = { ...data.orders[0]!, paidAmount: 999, status: 'partial' }
    data.orders[3] = { ...data.orders[3]!, status: 'void' }
    data.customerPrices.push(mk.price(9, 99, 404, 404))

    await replaceAllDataAndRecalculate(data)
    const expected = expectedAfterReplace(data)
    const overview = await getLedgerOverview()

    expect(ledgerTotals(expected.data).debtTotal).toBe(overview.totals.debtTotal)
    expect((await reportNow(expected)).ok).toBe(true)
  })

  it('cố tình làm lệch: xoá một khoản thu sau khi ghi ⇒ báo cáo ok=false, dòng khoản thu lệch', async () => {
    await replaceAllData(ledgerK())
    const { expected } = await mergeAnswering(shiftIds(ledgerK(), 10), {})
    await db.payments.delete(1)

    const report = await reportNow(expected)

    expect(report.ok).toBe(false)
    expect(report.rows.find((row) => row.key === 'payments')).toMatchObject({ matches: false, expected: 3, actual: 2 })
  })

  it.each([1, 2, 3, 4] as const)('tương thích ngược v%s: Ghi đè ⇒ báo cáo ok; Gộp vào sổ rỗng ⇒ báo cáo ok', async (version) => {
    const file = parseBackupFile(fileText(version))

    await replaceAllDataAndRecalculate(file.data)
    expect((await reportNow(expectedAfterReplace(file.data))).ok).toBe(true)

    await wipeAllData()
    const { expected } = await mergeAnswering(file.data, {})
    expect((await reportNow(expected)).ok).toBe(true)
    expect(await db.orders.count()).toBe(4)
  })

  it('v2 gộp vào sổ đã có chính dữ liệu đó ⇒ mọi bảng gấp đôi (đúng cảnh báo trước khi gộp)', async () => {
    await replaceAllData(parseBackupFile(fileText(2)).data)
    const before = await ledgerNow()

    const { expected } = await mergeAnswering(parseBackupFile(fileText(2)).data, {})

    const after = await ledgerNow()
    for (const table of ['itemGroups', 'items', 'customers', 'orders', 'orderLines', 'payments', 'expenseCategories', 'expenses'] as const) {
      expect(after[table]).toHaveLength(before[table].length * 2)
    }
    expect((await reportNow(expected)).ok).toBe(true)
  })

  it('lỗi giữa chừng khi ghi ⇒ rollback, sổ máy nguyên như trước', async () => {
    const { device, file } = twoConflicts()
    await replaceAllData(device)
    const before = await ledgerNow()
    const answer = Object.fromEntries(findPaymentConflicts(device, file).map((conflict) => [conflict.gid, 'append' as const]))
    const spy = vi.spyOn(db.payments, 'bulkPut').mockRejectedValueOnce(new Error('Đĩa đầy'))

    try {
      await expect(mergeAnswering(file, answer)).rejects.toThrow('Đĩa đầy')
    } finally {
      spy.mockRestore()
    }
    expect(await ledgerNow()).toEqual(before)
  })
})
