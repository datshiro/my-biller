import { describe, expect, it } from 'vitest'
import { cleanPriceRows, parseBackupFile, validateBackupIntegrity } from '../backup'
import {
  findPaymentConflicts,
  isLegacyFile,
  MergeReviewError,
  mergeByGid,
  previewMerge,
  type PaymentChoice,
} from '../backup-merge'
import { withDerivedPaid } from '../backup-report'
import { ledgerTotals } from '../doi-soat'
import type { BackupData, Payment } from '../schema'
import { at, emptyLedger, g, ledgerK, mk, shiftIds } from './backup-merge-fixtures'

const K = g(3)

function omit<T extends object, Key extends keyof T>(row: T, ...keys: Key[]): Omit<T, Key> {
  const copy = { ...row }
  for (const key of keys) delete copy[key]
  return copy
}

function merged(outcome: ReturnType<typeof mergeByGid>) {
  if (outcome.blocked !== null) throw new Error(`blocked: ${outcome.blocked}`)
  return outcome
}

function debtOf(data: BackupData, customerGid = K): number {
  return ledgerTotals(withDerivedPaid(data).data).debtByCustomerGid.get(customerGid) ?? 0
}

/** Sổ đọc theo gid: id cục bộ bị bỏ, khoá ngoại thay bằng gid cha — hai sổ "giống nhau" khi bảng này bằng nhau. */
function byGid(data: BackupData) {
  const gidOf = (rows: readonly { id: number; gid: string }[]) => new Map(rows.map((row) => [row.id, row.gid]))
  const groups = gidOf(data.itemGroups)
  const items = gidOf(data.items)
  const customers = gidOf(data.customers)
  const orders = gidOf(data.orders)
  const categories = gidOf(data.expenseCategories)
  const ref = (map: Map<number, string>, id: number | null) => (id === null ? null : map.get(id) ?? `?${id}`)
  const sorted = <T extends { gid: string }>(rows: T[]) => [...rows].sort((a, b) => a.gid.localeCompare(b.gid))
  const strip = <T extends { id: number }>(row: T) => omit(row, 'id')
  return {
    settings: data.settings,
    itemGroups: sorted(data.itemGroups.map(strip)),
    items: sorted(data.items.map((row) => ({ ...strip(row), groupId: ref(groups, row.groupId) }))),
    customers: sorted(data.customers.map(strip)),
    customerPrices: sorted(data.customerPrices.map((row) => ({ ...strip(row), customerId: ref(customers, row.customerId), itemId: ref(items, row.itemId) }))),
    orders: sorted(data.orders.map((row) => ({ ...strip(row), customerId: ref(customers, row.customerId) }))),
    orderLines: sorted(data.orderLines.map((row) => ({ ...strip(row), orderId: ref(orders, row.orderId), itemId: ref(items, row.itemId) }))),
    payments: sorted(
      data.payments.map((row) => ({
        ...strip(row),
        orderId: ref(orders, row.orderId),
        allocatedOrderId: row.allocatedOrderId === 0 ? 0 : ref(orders, row.allocatedOrderId),
        customerId: ref(customers, row.customerId),
      })),
    ),
    expenseCategories: sorted(data.expenseCategories.map(strip)),
    expenses: sorted(data.expenses.map((row) => ({ ...strip(row), categoryId: ref(categories, row.categoryId) }))),
  }
}

function paymentByGid(data: BackupData, gid: string): Payment {
  const row = data.payments.find((payment) => payment.gid === gid)
  if (!row) throw new Error(`không có khoản thu ${gid}`)
  return row
}

const orderGidOf = (data: BackupData, id: number) => data.orders.find((order) => order.id === id)?.gid

/** Máy: khoản 1 đã trả lại khách, khoản 2 đã bỏ. File: cả hai còn `pending` — hai xung đột cùng khách K. */
function twoConflictsSameCustomer() {
  const device = ledgerK()
  device.payments[0] = { ...device.payments[0]!, unallocatedStatus: 'refunded', resolutionNote: 'Đã trả lại' }
  device.payments[1] = { ...device.payments[1]!, unallocatedStatus: 'discarded', resolutionNote: 'Ghi nhầm' }
  const file = shiftIds(ledgerK(), 10)
  return { device, file }
}

/** Đóng băng sâu để mọi lần sửa đầu vào ném ngay — `previewMerge` gọi gộp nhiều lần trên cùng `current`. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

describe('mergeByGid — cơ bản', () => {
  it('gộp file vào sổ rỗng ⇒ bằng file đã lọc giá rác', () => {
    const file = ledgerK()
    file.customerPrices.push(mk.price(2, 98, 404, 404))

    const { merged: result, summary } = merged(mergeByGid(emptyLedger(), file, {}, 'A'))

    expect(result).toEqual({ ...file, customerPrices: cleanPriceRows(file).rows })
    expect(summary.droppedPrices).toBe(1)
  })

  it('gộp file có id khác hẳn vào sổ rỗng ⇒ cùng nội dung theo gid, khoá ngoại vẫn trỏ đúng cha', () => {
    const file = shiftIds(ledgerK(), 50)

    const { merged: result } = merged(mergeByGid(emptyLedger(), file, {}, 'A'))

    expect(byGid(result)).toEqual(byGid(file))
    expect(validateBackupIntegrity(result)).toBeNull()
  })

  it('gộp chính nó ⇒ bằng chính nó, không có xung đột', () => {
    const data = ledgerK()

    expect(findPaymentConflicts(data, data)).toEqual([])
    expect(merged(mergeByGid(data, data, {}, 'A')).merged).toEqual(data)
  })

  it('chỉ khác id cục bộ ⇒ không xung đột, không thêm dòng nào', () => {
    const data = ledgerK()
    const file = shiftIds(data, 10)

    const { merged: result, summary } = merged(mergeByGid(data, file, {}, 'A'))

    expect(findPaymentConflicts(data, file)).toEqual([])
    expect(result).toEqual(data)
    expect(Object.values(summary.added).every((count) => count === 0)).toBe(true)
  })

  it.each<PaymentChoice>(['device', 'file'])('gộp hai lần cùng file với lựa chọn %s ⇒ lần hai bằng lần một', (choice) => {
    const { device, file } = twoConflictsSameCustomer()
    file.orders.push(mk.order(60, 60, 70_000, { code: 'PBH-261001-A001', customerId: 11 }))
    file.payments.push(mk.payment(60, 61, 60, 20_000, { customerId: 11 }))
    const choices = Object.fromEntries(findPaymentConflicts(device, file).map((c) => [c.gid, choice]))

    const first = withDerivedPaid(merged(mergeByGid(device, file, choices, 'A')).merged).data
    const again = Object.fromEntries(findPaymentConflicts(first, file).map((c) => [c.gid, choice]))
    const second = withDerivedPaid(merged(mergeByGid(first, file, again, 'A')).merged).data

    expect(second).toEqual(first)
    if (choice === 'file') expect(again).toEqual({})
  })

  it('không sửa đầu vào (previewMerge gộp nhiều lần trên cùng sổ)', () => {
    const { device, file } = twoConflictsSameCustomer()
    file.orders.push(mk.order(60, 60, 70_000, { code: 'PBH-261001-A001', customerId: 11 }))
    deepFreeze(device)
    deepFreeze(file)
    const conflicts = findPaymentConflicts(device, file)

    expect(() => mergeByGid(device, file, { [conflicts[0]!.gid]: 'file', [conflicts[1]!.gid]: 'append' }, 'A')).not.toThrow()
    expect(() => previewMerge(device, file, {}, 'A')).not.toThrow()
  })

  it('thiếu lựa chọn cho một xung đột ⇒ ném, không trả dữ liệu', () => {
    const { device, file } = twoConflictsSameCustomer()
    const [first] = findPaymentConflicts(device, file)

    expect(() => mergeByGid(device, file, { [first!.gid]: 'device' }, 'A')).toThrow(/chưa chọn/)
  })

  it('sổ máy có dòng hàng mồ côi ⇒ trả blocked kèm câu mô tả, không ném', () => {
    const device = ledgerK()
    device.orderLines.push(mk.line(9, 99, 404, 1_000))

    const outcome = mergeByGid(device, ledgerK(), {}, 'A')

    expect(outcome.blocked).toMatch(/đơn số 404/)
    expect(previewMerge(device, ledgerK(), {}, 'A').blocked).toMatch(/đơn số 404/)
  })

  it('settings: giữ bản máy, thêm khoá còn thiếu', () => {
    const device = { ...emptyLedger(), settings: [{ key: 'app' as const, value: { lastBackupAt: 5, seededExpenseCategories: true } }] }
    const file = {
      ...emptyLedger(),
      settings: [
        { key: 'app' as const, value: { lastBackupAt: 9, seededExpenseCategories: false } },
        { key: 'shop' as const, value: { name: 'Quán', phone: '', address: '', footerNote: '', logo: null, labelWatermark: { enabled: false, position: 'center' as const, strength: 'light' as const, align: 'center' as const } } },
      ],
    }

    const { merged: result } = merged(mergeByGid(device, file, {}, 'A'))

    expect(result.settings).toEqual([device.settings[0], file.settings[1]])
  })

  it('isLegacyFile: v1/v2 là bản cũ, v3/v4 không', () => {
    expect([1, 2, 3, 4].map((version) => isLegacyFile({ version: version as 1 | 2 | 3 | 4 }))).toEqual([true, true, false, false])
  })
})

describe('mergeByGid — bản mới hơn thắng', () => {
  type Case = { table: 'itemGroups' | 'items' | 'customers' | 'customerPrices' | 'orders' | 'expenseCategories' | 'expenses'; field: string; value: unknown }
  const cases: Case[] = [
    { table: 'itemGroups', field: 'name', value: 'Nhóm mới' },
    { table: 'items', field: 'unitPrice', value: 60_000 },
    { table: 'customers', field: 'phone', value: '0999' },
    { table: 'customerPrices', field: 'unitPrice', value: 40_000 },
    { table: 'orders', field: 'note', value: 'Sửa trong file' },
    { table: 'expenseCategories', field: 'name', value: 'Ga' },
    { table: 'expenses', field: 'amount', value: 99_000 },
  ]

  function scenario({ table, field, value }: Case, fileUpdatedAt: number) {
    const device = ledgerK()
    const file = shiftIds(ledgerK(), 10)
    const local = device[table][0] as unknown as Record<string, unknown>
    local.updatedAt = 5
    const incoming = file[table][0] as unknown as Record<string, unknown>
    incoming[field] = value
    incoming.updatedAt = fileUpdatedAt
    const result = merged(mergeByGid(device, file, {}, 'A'))
    return { device, row: result.merged[table][0] as unknown as Record<string, unknown>, summary: result.summary }
  }

  it.each(cases)('$table: file mới hơn ⇒ lấy nội dung file, giữ id máy', (testCase) => {
    const { row, summary } = scenario(testCase, 6)

    expect(row[testCase.field]).toEqual(testCase.value)
    expect(row.id).toBe(1)
    expect(row.updatedAt).toBe(6)
    expect(summary.updated[testCase.table]).toBe(1)
  })

  it.each(cases)('$table: file cũ hơn ⇒ giữ máy', (testCase) => {
    const { device, row } = scenario(testCase, 4)

    expect(row).toEqual(device[testCase.table][0])
  })

  it.each(cases)('$table: bằng nhau ⇒ giữ máy', (testCase) => {
    const { device, row, summary } = scenario(testCase, 5)

    expect(row).toEqual(device[testCase.table][0])
    expect(summary.keptLocal[testCase.table]).toBeGreaterThan(0)
  })

  it('file mới hơn trỏ khoá ngoại theo id file ⇒ ánh xạ về id máy qua gid', () => {
    const device = ledgerK()
    device.customers.push(mk.customer(2, 5, { name: 'Anh Ba' }))
    const file = shiftIds(device, 10)
    file.orders[0] = { ...file.orders[0]!, customerId: 12, updatedAt: 9 }

    const result = merged(mergeByGid(device, file, {}, 'A')).merged

    expect(result.orders[0]?.customerId).toBe(2)
  })
})

describe('findPaymentConflicts', () => {
  type Case = { name: string; change: Partial<Payment>; field: keyof Payment; index?: number }
  const cases: Case[] = [
    { name: 'amount', change: { amount: 61_000 }, field: 'amount', index: 2 },
    { name: 'allocatedOrderId (khác đơn)', change: { allocatedOrderId: 11 }, field: 'allocatedOrderId', index: 2 },
    { name: 'customerId', change: { customerId: null }, field: 'customerId' },
    { name: 'pending→refunded', change: { unallocatedStatus: 'refunded' }, field: 'unallocatedStatus' },
    { name: 'pending→discarded', change: { unallocatedStatus: 'discarded' }, field: 'unallocatedStatus' },
    { name: 'resolutionNote', change: { resolutionNote: 'Đã gọi khách' }, field: 'resolutionNote' },
    { name: 'method', change: { method: 'transfer' }, field: 'method' },
    { name: 'paidAt', change: { paidAt: at + 999 }, field: 'paidAt' },
  ]

  it.each(cases)('bắt khác biệt ở $name', ({ change, field, index = 0 }) => {
    const device = ledgerK()
    const file = shiftIds(ledgerK(), 10)
    file.payments[index] = { ...file.payments[index]!, ...change }

    const conflicts = findPaymentConflicts(device, file)

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ gid: device.payments[index]!.gid, changed: [field], customerGid: K })
    expect(conflicts[0]?.device).toEqual(device.payments[index])
    expect(conflicts[0]?.file).toEqual(file.payments[index])
  })

  it('unallocatedStatus vắng ≡ pending, resolutionNote vắng ≡ chuỗi rỗng', () => {
    const device = ledgerK()
    const file = shiftIds(ledgerK(), 10)
    file.payments[0] = { ...file.payments[0]!, unallocatedStatus: 'pending', resolutionNote: '' }

    expect(findPaymentConflicts(device, file)).toEqual([])
  })

  it('allocatedOrderCode là mã đơn mà dòng máy đang trừ vào', () => {
    const device = ledgerK()
    const file = shiftIds(ledgerK(), 10)
    file.payments[2] = { ...file.payments[2]!, allocatedOrderId: 11 }

    expect(findPaymentConflicts(device, file)[0]?.allocatedOrderCode).toBe(device.orders[3]?.code)
  })

  it('dấu vân tay: đổi một trường nội dung (giữ gid) ⇒ khác; chỉ đổi id cục bộ ⇒ giống', () => {
    const { device, file } = twoConflictsSameCustomer()
    const base = findPaymentConflicts(device, file).map((c) => c.fingerprint)

    const shifted = findPaymentConflicts(shiftIds(device, 100), shiftIds(file, 7)).map((c) => c.fingerprint)
    const edited = structuredClone(device)
    edited.payments[0] = { ...edited.payments[0]!, resolutionNote: 'Đổi ghi chú' }
    const changed = findPaymentConflicts(edited, file).map((c) => c.fingerprint)

    expect(shifted).toEqual(base)
    expect(changed[0]).not.toBe(base[0])
    expect(changed[1]).toBe(base[1])
  })
})

describe('mergeByGid — xung đột khoản thu', () => {
  type Kind = 'phân bổ khác đơn' | 'hoàn tiền' | 'bỏ'
  function conflictOf(kind: Kind) {
    const device = ledgerK()
    const file = shiftIds(ledgerK(), 10)
    if (kind === 'phân bổ khác đơn') file.payments[2] = { ...file.payments[2]!, allocatedOrderId: 11 }
    if (kind === 'hoàn tiền') device.payments[0] = { ...device.payments[0]!, unallocatedStatus: 'refunded' }
    if (kind === 'bỏ') device.payments[1] = { ...device.payments[1]!, unallocatedStatus: 'discarded' }
    const [conflict] = findPaymentConflicts(device, file)
    if (!conflict) throw new Error('fixture không có xung đột')
    return { device, file, conflict }
  }
  const kinds: Kind[] = ['phân bổ khác đơn', 'hoàn tiền', 'bỏ']

  it.each(kinds)('%s + device ⇒ dòng máy nguyên', (kind) => {
    const { device, file, conflict } = conflictOf(kind)

    const result = merged(mergeByGid(device, file, { [conflict.gid]: 'device' }, 'A')).merged

    expect(paymentByGid(result, conflict.gid)).toEqual(conflict.device)
    expect(result.payments).toHaveLength(device.payments.length)
  })

  it.each(kinds)('%s + file ⇒ nội dung file, giữ id và gid máy, khoá ngoại về id máy', (kind) => {
    const { device, file, conflict } = conflictOf(kind)

    const result = merged(mergeByGid(device, file, { [conflict.gid]: 'file' }, 'A')).merged
    const row = paymentByGid(result, conflict.gid)

    expect(row.id).toBe(conflict.device.id)
    expect(row.unallocatedStatus ?? 'pending').toBe(conflict.file.unallocatedStatus ?? 'pending')
    expect(row.allocatedOrderId === 0 ? 0 : orderGidOf(result, row.allocatedOrderId)).toBe(
      conflict.file.allocatedOrderId === 0 ? 0 : orderGidOf(file, conflict.file.allocatedOrderId),
    )
    expect(orderGidOf(result, row.orderId)).toBe(orderGidOf(file, conflict.file.orderId))
    expect(result.payments).toHaveLength(device.payments.length)
  })

  it.each(kinds)('%s + append ⇒ giữ dòng máy và thêm đúng một dòng gid mới, khoá ngoại đúng cha', (kind) => {
    const { device, file, conflict } = conflictOf(kind)

    const { merged: result, summary } = merged(mergeByGid(device, file, { [conflict.gid]: 'append' }, 'A'))
    const appended = result.payments.filter((row) => !device.payments.some((local) => local.gid === row.gid))

    expect(paymentByGid(result, conflict.gid)).toEqual(conflict.device)
    expect(result.payments).toHaveLength(device.payments.length + 1)
    expect(appended).toHaveLength(1)
    expect(appended[0]?.amount).toBe(conflict.file.amount)
    expect(appended[0]?.unallocatedStatus ?? 'pending').toBe(conflict.file.unallocatedStatus ?? 'pending')
    expect(orderGidOf(result, appended[0]!.orderId)).toBe(orderGidOf(file, conflict.file.orderId))
    expect(new Set(result.payments.map((row) => row.id)).size).toBe(result.payments.length)
    expect(summary.paymentChoices).toEqual({ [conflict.gid]: 'append' })
    expect(validateBackupIntegrity(result)).toBeNull()
  })

  it('append hai lần cùng file ⇒ thêm hai dòng (không idempotent theo thiết kế)', () => {
    const { device, file, conflict } = conflictOf('hoàn tiền')

    const first = merged(mergeByGid(device, file, { [conflict.gid]: 'append' }, 'A')).merged
    const again = findPaymentConflicts(first, file)
    const second = merged(mergeByGid(first, file, { [again[0]!.gid]: 'append' }, 'A')).merged

    expect(again.map((c) => c.gid)).toEqual([conflict.gid])
    expect(second.payments).toHaveLength(device.payments.length + 2)
  })
})

describe('previewMerge', () => {
  it('một xung đột máy refunded / file pending ⇒ nợ theo file thấp hơn theo device đúng bằng amount; append tăng collected đúng amount', () => {
    const device = ledgerK()
    device.payments[0] = { ...device.payments[0]!, unallocatedStatus: 'refunded' }
    const file = shiftIds(ledgerK(), 10)

    const preview = previewMerge(device, file, {}, 'A')
    if (preview.blocked !== null) throw new Error('blocked')
    const gid = device.payments[0]!.gid
    const effects = preview.optionEffects[gid]!

    expect(effects.device.debtByCustomer[K]).toBe(520_000)
    expect(effects.file.debtByCustomer[K]).toBe(520_000 - 30_000)
    expect(effects.append.collected - effects.device.collected).toBe(30_000)
    expect(preview.complete).toBe(false)
    expect(preview.debtByCustomer[K]).toEqual({ now: 520_000, after: 520_000 })
    expect(preview.appendLosesExcess[gid]).toBe(false)
  })

  it('hai xung đột cùng khách K: cả 9 tổ hợp, nợ sau gộp bằng nợ của sổ gộp với đúng bộ lựa chọn đó', () => {
    const { device, file } = twoConflictsSameCustomer()
    const [first, second] = findPaymentConflicts(device, file).map((c) => c.gid) as [string, string]
    const options: PaymentChoice[] = ['device', 'file', 'append']
    const expectedDebt: Record<string, number> = {
      'device/device': 540_000,
      'file/device': 510_000,
      'append/device': 510_000,
      'device/file': 520_000,
      'device/append': 520_000,
      'file/file': 490_000,
      'file/append': 490_000,
      'append/file': 490_000,
      'append/append': 490_000,
    }

    for (const a of options) {
      for (const b of options) {
        const choices = { [first]: a, [second]: b }
        const preview = previewMerge(device, file, choices, 'A')
        if (preview.blocked !== null) throw new Error('blocked')
        const actual = debtOf(merged(mergeByGid(device, file, choices, 'A')).merged)

        expect(preview.complete).toBe(true)
        expect(preview.debtByCustomer[K]?.after).toBe(actual)
        expect(actual).toBe(expectedDebt[`${a}/${b}`])
        for (const option of options) {
          const alone = debtOf(merged(mergeByGid(device, file, { [first]: option, [second]: b }, 'A')).merged)
          expect(preview.optionEffects[first]?.[option].debtByCustomer[K]).toBe(alone)
        }
      }
    }
  })

  it('optionEffects của xung đột 1 theo lựa chọn hiện tại của xung đột 2, không giả định device', () => {
    const { device, file } = twoConflictsSameCustomer()
    const [first, second] = findPaymentConflicts(device, file).map((c) => c.gid) as [string, string]

    const withDevice = previewMerge(device, file, { [second]: 'device' }, 'A')
    const withFile = previewMerge(device, file, { [second]: 'file' }, 'A')
    if (withDevice.blocked !== null || withFile.blocked !== null) throw new Error('blocked')

    expect(withDevice.optionEffects[first]?.file.debtByCustomer[K]).toBe(510_000)
    expect(withFile.optionEffects[first]?.file.debtByCustomer[K]).toBe(490_000)
  })

  it('appendLosesExcess: true khi dòng file đã trừ vào đơn; append khi đó không giảm nợ quá số đơn còn nợ', () => {
    const device = ledgerK()
    const file = shiftIds(ledgerK(), 10)
    file.payments[2] = { ...file.payments[2]!, amount: 100_000 }
    file.payments[0] = { ...file.payments[0]!, note: 'Sửa' }

    const preview = previewMerge(device, file, {}, 'A')
    if (preview.blocked !== null) throw new Error('blocked')
    const allocated = device.payments[2]!.gid
    const unallocated = device.payments[0]!.gid

    expect(preview.appendLosesExcess[allocated]).toBe(true)
    expect(preview.appendLosesExcess[unallocated]).toBe(false)
    // Đơn 4 còn nợ 40k; thêm riêng 100k chỉ xoá được 40k đó, 60k dư không thành tiền dư của K.
    expect(preview.optionEffects[allocated]?.device.debtByCustomer[K]).toBe(490_000)
    expect(preview.optionEffects[allocated]?.append.debtByCustomer[K]).toBe(450_000)
  })

  it('integrity khác null cho bộ lựa chọn làm hỏng sổ ⇒ trả mô tả, không ném', () => {
    const device = ledgerK()
    device.payments[0] = { ...device.payments[0]!, unallocatedStatus: 'refunded' }
    const file = shiftIds(ledgerK(), 10)
    file.payments[0] = { ...file.payments[0]!, orderId: 404 }
    const gid = device.payments[0]!.gid

    const keep = previewMerge(device, file, { [gid]: 'device' }, 'A')
    const take = previewMerge(device, file, { [gid]: 'file' }, 'A')
    if (keep.blocked !== null || take.blocked !== null) throw new Error('blocked')

    expect(keep.integrity).toBeNull()
    expect(take.integrity).toMatch(/không có đơn đó/)
    expect(() => mergeByGid(device, file, { [gid]: 'file' }, 'A')).toThrow(MergeReviewError)
    expect(() => mergeByGid(device, file, { [gid]: 'file' }, 'A')).toThrow(/Lựa chọn này làm sổ hỏng/)
  })

  it('willAdd liệt kê tên danh mục chỉ có trong file, không liệt kê dòng cùng gid', () => {
    const device = ledgerK()
    const file = shiftIds(ledgerK(), 10)
    file.itemGroups.push(mk.group(30, 90, { name: 'Nước' }))
    file.items.push(mk.item(30, 91, { name: 'Trà đá', groupId: 30 }))
    file.customers.push(mk.customer(30, 92, { name: 'Anh Tư' }))
    file.expenseCategories.push(mk.category(30, 93, { name: 'Ga' }))
    file.orders.push(mk.order(30, 94, 10_000, { code: 'PBH-261001-A030', customerId: 11 }))
    file.payments.push(mk.payment(30, 95, 30, 10_000, { customerId: 11 }))
    file.expenses.push(mk.expense(30, 96, 30, 5_000))

    const preview = previewMerge(device, file, {}, 'A')
    if (preview.blocked !== null) throw new Error('blocked')

    expect(preview.willAdd).toEqual({
      itemGroups: ['Nước'],
      items: ['Trà đá'],
      customers: ['Anh Tư'],
      expenseCategories: ['Ga'],
      orders: 1,
      payments: 1,
      expenses: 1,
    })
  })

  /**
   * Hai máy chưa ghép cùng ghi một lần trả tiền thật ⇒ hai gid, gộp theo gid không thấy xung đột. Con số
   * duy nhất lộ ra là đơn thu vượt tổng — xem trước phải cho người bán thấy "Đã thu" nhảy và số đơn đó.
   */
  it('totals: đã thu và tổng nợ trước → sau, đếm đơn thu vượt tổng khi cùng một lần trả nằm dưới hai gid', () => {
    const device = ledgerK()
    const file = shiftIds(ledgerK(), 10)
    file.payments.push(mk.payment(40, 70, 14, 40_000, { customerId: 11 }))
    device.payments.push(mk.payment(9, 71, 4, 40_000))
    device.orders[3] = { ...device.orders[3]!, paidAmount: 100_000, status: 'paid' }

    const preview = previewMerge(device, file, {}, 'A')
    if (preview.blocked !== null) throw new Error('blocked')

    expect(preview.totals.collected).toEqual({ now: 150_000, after: 190_000 })
    expect(preview.totals.debtTotal).toEqual({ now: 450_000, after: 450_000 })
    expect(preview.totals.overpaidOrders).toBe(1)
  })
})

describe('mergeByGid — thêm mới, khoá ngoại, mã đơn, giá riêng', () => {
  it('mọi dòng thêm trỏ đúng gid cha, sổ sau gộp lành', () => {
    const device = ledgerK()
    const file = shiftIds(ledgerK(), 10)
    file.customers.push(mk.customer(20, 80))
    file.items.push(mk.item(20, 81, { groupId: 11 }))
    file.customerPrices.push(mk.price(20, 82, 20, 20))
    file.orders.push(mk.order(20, 83, 30_000, { customerId: 20, code: 'PBH-261001-B001' }))
    file.orderLines.push(mk.line(20, 84, 20, 30_000, { itemId: 20 }))
    file.payments.push(mk.payment(20, 85, 20, 10_000, { customerId: 20 }))
    file.payments.push(mk.payment(21, 86, 20, 5_000, { customerId: 20, allocatedOrderId: 0 }))
    file.expenses.push(mk.expense(20, 87, 11, 2_000))

    const { merged: result, summary } = merged(mergeByGid(device, file, {}, 'A'))

    const view = byGid(result)
    expect(view.items.find((row) => row.gid === g(81))?.groupId).toBe(g(1))
    expect(view.customerPrices.find((row) => row.gid === g(82))).toMatchObject({ customerId: g(80), itemId: g(81) })
    expect(view.orders.find((row) => row.gid === g(83))?.customerId).toBe(g(80))
    expect(view.orderLines.find((row) => row.gid === g(84))).toMatchObject({ orderId: g(83), itemId: g(81) })
    expect(view.payments.find((row) => row.gid === g(85))).toMatchObject({ orderId: g(83), allocatedOrderId: g(83), customerId: g(80) })
    expect(view.payments.find((row) => row.gid === g(86))?.allocatedOrderId).toBe(0)
    expect(view.expenses.find((row) => row.gid === g(87))?.categoryId).toBe(g(40))
    expect(validateBackupIntegrity(result)).toBeNull()
    expect(summary.added).toMatchObject({ customers: 1, items: 1, customerPrices: 1, orders: 1, orderLines: 1, payments: 2, expenses: 1 })
    expect(Math.min(...result.orders.filter((row) => row.gid === g(83)).map((row) => row.id))).toBe(5)
  })

  it('trùng code khác gid ⇒ mã mới cùng chữ máy, originalCode = mã cũ, có trong codeChanges; hai đơn cùng ngày không trùng mã', () => {
    const device = ledgerK()
    const file = shiftIds(ledgerK(), 10)
    file.orders.push(
      mk.order(30, 90, 10_000, { code: 'PBH-261001-A001', soldAt: at, customerId: 11 }),
      mk.order(31, 91, 10_000, { code: 'PBH-261001-A002', soldAt: at, customerId: 11 }),
    )

    const { merged: result, summary } = merged(mergeByGid(device, file, {}, 'B'))
    const added = result.orders.filter((row) => row.gid === g(90) || row.gid === g(91))

    expect(added.map((row) => row.code)).toEqual(['PBH-261001-A005', 'PBH-261001-A006'])
    expect(added.map((row) => row.originalCode)).toEqual(['PBH-261001-A001', 'PBH-261001-A002'])
    expect(added.every((row) => row.updatedAt === 1)).toBe(true)
    expect(summary.codeChanges).toEqual([
      { orderGid: g(90), originalCode: 'PBH-261001-A001', code: 'PBH-261001-A005' },
      { orderGid: g(91), originalCode: 'PBH-261001-A002', code: 'PBH-261001-A006' },
    ])
    expect(new Set(result.orders.map((row) => row.code)).size).toBe(result.orders.length)
  })

  it('đã đổi mã một lần ⇒ gộp lại cùng file không đổi mã nữa', () => {
    const device = ledgerK()
    const file = shiftIds(ledgerK(), 10)
    file.orders.push(mk.order(30, 90, 10_000, { code: 'PBH-261001-A001', customerId: 11 }))

    const first = merged(mergeByGid(device, file, {}, 'A'))
    const second = merged(mergeByGid(first.merged, file, {}, 'A'))

    expect(second.summary.codeChanges).toEqual([])
    expect(second.merged).toEqual(first.merged)
  })

  it('mã cũ không chữ trùng mã ⇒ không ném, mã mới dùng chữ dự phòng', () => {
    const device = ledgerK()
    device.orders[0] = { ...device.orders[0]!, code: 'PBH-261001-001' }
    const file = shiftIds(ledgerK(), 10)
    file.orders.push(mk.order(30, 90, 10_000, { code: 'PBH-261001-001', soldAt: at, customerId: 11 }))

    const { merged: result, summary } = merged(mergeByGid(device, file, {}, 'C'))

    expect(result.orders.find((row) => row.gid === g(90))).toMatchObject({ code: 'PBH-261001-C001', originalCode: 'PBH-261001-001' })
    expect(summary.codeChanges).toHaveLength(1)
  })

  it('trùng cặp giá riêng khác gid ⇒ một dòng, giữ id/gid máy, giá theo bản mới hơn', () => {
    const device = ledgerK()
    const file = shiftIds(ledgerK(), 10)
    file.customerPrices[0] = { ...file.customerPrices[0]!, gid: g(77), unitPrice: 41_000, updatedAt: 9 }

    const { merged: result, summary } = merged(mergeByGid(device, file, {}, 'A'))

    expect(result.customerPrices).toEqual([{ ...device.customerPrices[0], unitPrice: 41_000, updatedAt: 9 }])
    expect(summary.priceConflicts).toBe(1)

    const older = shiftIds(ledgerK(), 10)
    older.customerPrices[0] = { ...older.customerPrices[0]!, gid: g(77), unitPrice: 41_000, updatedAt: 0 }
    expect(merged(mergeByGid(device, older, {}, 'A')).merged.customerPrices).toEqual(device.customerPrices)
  })

  it('withDerivedPaid(merged): thêm khoản thu vào đơn sẵn có ⇒ paidAmount đơn đó tăng', () => {
    const device = ledgerK()
    const file = shiftIds(ledgerK(), 10)
    file.payments.push(mk.payment(40, 70, 11, 40_000, { customerId: 11 }))

    const result = withDerivedPaid(merged(mergeByGid(device, file, {}, 'A')).merged).data

    expect(result.orders[0]).toMatchObject({ paidAmount: 40_000, status: 'partial' })
  })
})

describe('mergeByGid — file v1/v2', () => {
  /** File v1 thật: không gid, không bảng giá, mã đơn không chữ (chữ máy ra đời cùng gid). */
  function v1Text(): string {
    const data = ledgerK()
    const strip = <T extends { gid: string }>(row: T) => omit(row, 'gid')
    return JSON.stringify({
      app: 'my-biller',
      version: 1,
      appVersion: '1.0.0',
      exportedAt: new Date(at).toISOString(),
      data: {
        settings: data.settings,
        itemGroups: data.itemGroups.map(strip),
        items: data.items.map(strip),
        customers: data.customers.map(strip),
        orders: data.orders.map((row, index) => ({ ...strip(row), code: `PBH-261001-${String(index + 1).padStart(3, '0')}` })),
        orderLines: data.orderLines.map(strip),
        payments: data.payments.map((row) => omit(row, 'gid', 'allocatedOrderId')),
        expenseCategories: data.expenseCategories.map(strip),
        expenses: data.expenses.map(strip),
      },
    })
  }

  it('gộp file v1 vào sổ đã có chính dữ liệu đó ⇒ mọi bảng gấp đôi, đơn file mang mã mới chữ dự phòng, sổ lành', () => {
    const device = parseBackupFile(v1Text())
    const file = parseBackupFile(v1Text())

    const { merged: result, summary } = merged(mergeByGid(device.data, file.data, {}, 'B'))

    expect(isLegacyFile(file)).toBe(true)
    for (const table of ['itemGroups', 'items', 'customers', 'orders', 'orderLines', 'payments', 'expenseCategories', 'expenses'] as const) {
      expect(result[table]).toHaveLength(device.data[table].length * 2)
    }
    expect(summary.codeChanges).toHaveLength(device.data.orders.length)
    expect(summary.codeChanges.map((change) => change.code)).toEqual(['PBH-261001-B001', 'PBH-261001-B002', 'PBH-261001-B003', 'PBH-261001-B004'])
    expect(new Set(result.orders.map((row) => row.code)).size).toBe(result.orders.length)
    expect(validateBackupIntegrity(result)).toBeNull()
  })
})
