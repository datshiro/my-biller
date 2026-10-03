import { cleanPriceRows, validateBackupIntegrity } from './backup'
import { withDerivedPaid } from './backup-report'
import { ledgerTotals, type LedgerTotals } from './doi-soat'
import { newGid } from './gid'
import { buildOrderCode, nextSeqOfDay, orderCodeDatePart, parseOrderCode } from './order-code'
import type { BackupData, BackupFile, Payment } from './schema'

export type PaymentChoice = 'device' | 'file' | 'append'

type Table = keyof BackupData
type Row<T extends Table> = BackupData[T][number]
type BackupPayment = Row<'payments'>
type Versioned = { id: number; gid: string; updatedAt: number }

export type PaymentConflict = {
  gid: string
  /** Chuỗi JSON chuẩn hoá của cặp máy/file — đồng bộ, so bằng `===` trong khoá ghi. */
  fingerprint: string
  device: BackupPayment
  file: BackupPayment
  /** Khách của dòng máy; dòng máy không gắn khách thì lấy khách của dòng file. */
  customerGid: string | null
  /** Mã đơn mà dòng máy đang trừ vào; `null` khi chưa trừ đơn nào. */
  allocatedOrderCode: string | null
  changed: (keyof Payment)[]
}

export type CodeChange = { orderGid: string; originalCode: string; code: string }

export type MergeSummary = {
  added: Record<Table, number>
  updated: Record<Table, number>
  keptLocal: Record<Table, number>
  codeChanges: CodeChange[]
  /** Dòng giá riêng của file trùng cặp khách–món với một dòng khác gid trên máy. */
  priceConflicts: number
  paymentChoices: Record<string, PaymentChoice>
  /** Dòng giá rác của file bị bỏ trước khi gộp (`cleanPriceRows`). */
  droppedPrices: number
}

export type MergeOutcome =
  | { blocked: string }
  | { blocked: null; merged: BackupData; summary: MergeSummary }

/** Lựa chọn của người bán không còn ghi được — màn phải quay về xem trước. */
export class MergeReviewError extends Error {
  override name = 'MergeReviewError'
}

export function isLegacyFile(file: Pick<BackupFile, 'version'>): boolean {
  return file.version < 3
}

type Refs = { orders: Map<number, Row<'orders'>>; customers: Map<number, string> }

function refsOf(data: BackupData): Refs {
  return {
    orders: new Map(data.orders.map((order) => [order.id, order])),
    customers: new Map(data.customers.map((customer) => [customer.id, customer.gid])),
  }
}

/** Khoá ngoại trỏ vào chỗ trống vẫn phải phân biệt được với mọi gid thật. */
const orderRef = (refs: Refs, id: number) => refs.orders.get(id)?.gid ?? `#${id}`

/**
 * Dòng khoản thu nhìn theo gid: bỏ `id`, khoá ngoại thay bằng gid cha (id máy và id file khác nhau), trường
 * tuỳ chọn về giá trị mặc định đúng như `isCountedPayment` đọc. Kiểu `Record` buộc liệt kê đủ mọi trường —
 * thêm trường mới vào `Payment` mà quên ở đây thì `tsc` kêu.
 */
function normalizePayment(payment: BackupPayment, refs: Refs): Record<Exclude<keyof Payment, 'id'>, unknown> {
  return {
    gid: payment.gid,
    orderId: orderRef(refs, payment.orderId),
    allocatedOrderId: payment.allocatedOrderId === 0 ? 0 : orderRef(refs, payment.allocatedOrderId),
    customerId: payment.customerId === null ? null : refs.customers.get(payment.customerId) ?? `#${payment.customerId}`,
    amount: payment.amount,
    method: payment.method,
    paidAt: payment.paidAt,
    note: payment.note,
    unallocatedStatus: payment.unallocatedStatus ?? 'pending',
    resolutionNote: payment.resolutionNote ?? '',
  }
}

/** Khoá sắp xếp ⇒ cùng nội dung luôn ra cùng chuỗi, không phụ thuộc thứ tự trường trong object. */
function canonical(rows: readonly Record<string, unknown>[]): string {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))].sort()
  return JSON.stringify(rows, keys)
}

/** Khoản thu cùng gid mà máy và file khác nhau. Sắp theo gid để tập dấu vân tay so được như nhau. */
export function findPaymentConflicts(current: BackupData, incoming: BackupData): PaymentConflict[] {
  const deviceRefs = refsOf(current)
  const fileRefs = refsOf(incoming)
  const fileByGid = new Map(incoming.payments.map((payment) => [payment.gid, payment]))
  const conflicts: PaymentConflict[] = []

  for (const device of current.payments) {
    const file = fileByGid.get(device.gid)
    if (!file) continue
    const left = normalizePayment(device, deviceRefs)
    const right = normalizePayment(file, fileRefs)
    const changed = (Object.keys(left) as (keyof typeof left)[]).filter((key) => left[key] !== right[key])
    if (changed.length === 0) continue

    const deviceCustomer = device.customerId === null ? undefined : deviceRefs.customers.get(device.customerId)
    const fileCustomer = file.customerId === null ? undefined : fileRefs.customers.get(file.customerId)
    conflicts.push({
      gid: device.gid,
      fingerprint: canonical([left, right]),
      device,
      file,
      customerGid: deviceCustomer ?? fileCustomer ?? null,
      allocatedOrderCode:
        device.allocatedOrderId === 0 ? null : deviceRefs.orders.get(device.allocatedOrderId)?.code ?? null,
      changed,
    })
  }
  return conflicts.sort((a, b) => (a.gid < b.gid ? -1 : a.gid > b.gid ? 1 : 0))
}

const TABLES: readonly Table[] = [
  'settings',
  'itemGroups',
  'items',
  'customers',
  'customerPrices',
  'orders',
  'orderLines',
  'payments',
  'expenseCategories',
  'expenses',
]

const zeroCounts = () => Object.fromEntries(TABLES.map((table) => [table, 0])) as Record<Table, number>

const maxId = (rows: readonly { id: number }[]) => rows.reduce((max, row) => Math.max(max, row.id), 0)
const byId = <T extends { id: number }>(rows: readonly T[]) => [...rows].sort((a, b) => a.id - b.id)

type IdMap = Map<number, number>

/**
 * id trong file → id sau gộp. File đã qua `validateBackupIntegrity` nên khoá ngoại luôn có cha; nếu
 * không có (file hỏng), trả số âm thay vì giữ id file — id file có thể trùng một dòng **khác** trên máy và
 * trỏ nhầm tiền im lặng, còn số âm thì `validateBackupIntegrity(merged)` bắt được và chặn ghi.
 */
const mapId = (map: IdMap, id: number) => map.get(id) ?? -id
const mapNullable = (map: IdMap, id: number | null) => (id === null ? null : mapId(map, id))

type Counter = { summary: MergeSummary }

/**
 * Bảng có `updatedAt`: cùng gid ⇒ bản mới hơn thắng, giữ id máy; bằng hoặc cũ hơn ⇒ giữ máy. Chỉ có
 * trong file ⇒ thêm với id mới sau id lớn nhất trên máy.
 */
function mergeVersioned<T extends Table, R extends Row<T> & Versioned>(
  table: T,
  local: readonly R[],
  file: readonly R[],
  remap: (row: R) => R,
  { summary }: Counter,
) {
  const rows = [...local]
  const indexByGid = new Map(local.map((row, index) => [row.gid, index]))
  const idMap: IdMap = new Map()
  /** gid của dòng mang nội dung file (thêm mới hoặc thắng cập nhật) → id của nó trong file. */
  const fromFile = new Map<string, number>()
  let nextId = maxId(local) + 1

  for (const row of byId(file)) {
    const index = indexByGid.get(row.gid)
    const existing = index === undefined ? undefined : rows[index]
    if (index !== undefined && existing) {
      idMap.set(row.id, existing.id)
      if (row.updatedAt > existing.updatedAt) {
        rows[index] = { ...remap(row), id: existing.id }
        fromFile.set(row.gid, row.id)
        summary.updated[table] += 1
      } else {
        summary.keptLocal[table] += 1
      }
      continue
    }
    const id = nextId++
    idMap.set(row.id, id)
    rows.push({ ...remap(row), id })
    fromFile.set(row.gid, row.id)
    summary.added[table] += 1
  }
  return { rows, idMap, fromFile }
}

/** Dòng chỉ có trong file thì thêm; cùng gid thì giữ máy (bảng bất biến hoặc xử lý riêng). */
function appendMissing<T extends Table, R extends Row<T> & { id: number; gid: string }>(
  table: T,
  local: readonly R[],
  file: readonly R[],
  remap: (row: R) => R,
  { summary }: Counter,
): R[] {
  const known = new Set(local.map((row) => row.gid))
  const rows = [...local]
  let nextId = maxId(local) + 1
  for (const row of byId(file)) {
    if (known.has(row.gid)) {
      summary.keptLocal[table] += 1
      continue
    }
    rows.push({ ...remap(row), id: nextId++ })
    summary.added[table] += 1
  }
  return rows
}

function mergePrices(
  local: readonly Row<'customerPrices'>[],
  file: readonly Row<'customerPrices'>[],
  customers: IdMap,
  items: IdMap,
  { summary }: Counter,
): Row<'customerPrices'>[] {
  const rows = [...local]
  const pairKey = (row: { customerId: number; itemId: number }) => `${row.customerId}:${row.itemId}`
  const indexByGid = new Map(local.map((row, index) => [row.gid, index]))
  const indexByPair = new Map(local.map((row, index) => [pairKey(row), index]))
  let nextId = maxId(local) + 1

  for (const row of byId(file)) {
    const mapped = { ...row, customerId: mapId(customers, row.customerId), itemId: mapId(items, row.itemId) }
    const sameGid = indexByGid.get(row.gid)
    const samePair = indexByPair.get(pairKey(mapped))

    if (sameGid !== undefined) {
      const existing = rows[sameGid]!
      const pairTaken = samePair !== undefined && samePair !== sameGid
      if (row.updatedAt > existing.updatedAt && !pairTaken) {
        indexByPair.delete(pairKey(existing))
        rows[sameGid] = { ...mapped, id: existing.id }
        indexByPair.set(pairKey(mapped), sameGid)
        summary.updated.customerPrices += 1
      } else {
        if (pairTaken) summary.priceConflicts += 1
        summary.keptLocal.customerPrices += 1
      }
      continue
    }

    if (samePair !== undefined) {
      // Index unique `&[customerId+itemId]`: hai dòng cùng cặp là `ConstraintError` huỷ cả lượt ghi.
      const existing = rows[samePair]!
      summary.priceConflicts += 1
      if (mapped.updatedAt > existing.updatedAt) {
        rows[samePair] = { ...existing, unitPrice: mapped.unitPrice, updatedAt: mapped.updatedAt }
        summary.updated.customerPrices += 1
      } else {
        summary.keptLocal.customerPrices += 1
      }
      continue
    }

    indexByPair.set(pairKey(mapped), rows.length)
    rows.push({ ...mapped, id: nextId++ })
    summary.added.customerPrices += 1
  }
  return rows
}

/**
 * Đơn mang nội dung file mà `code` đã thuộc một đơn khác gid ⇒ cấp mã mới. Đơn giữ của máy luôn giữ mã.
 * Mã cũ không chữ máy (`PBH-YYMMDD-NNN`) dùng chữ dự phòng — `buildOrderCode` không nhận chữ rỗng.
 * Không đụng `updatedAt`: lần gộp sau cùng file thấy mốc bằng nhau ⇒ giữ máy ⇒ không đổi mã lần nữa.
 */
function recodeCollisions(
  orders: Row<'orders'>[],
  fromFile: ReadonlyMap<string, number>,
  fallbackLetter: string,
): { orders: Row<'orders'>[]; codeChanges: CodeChange[] } {
  const owners = new Map<string, string>()
  // Mọi mã đã có, chia theo ngày: `nextSeqOfDay` chỉ đọc mã cùng ngày, chia sẵn thì gộp file v1 vài nghìn
  // đơn (mọi đơn đều trùng mã) không thành vòng bình phương trên toàn bộ sổ.
  const usedByDay = new Map<string, string[]>()
  const usedOn = (day: string) => {
    const codes = usedByDay.get(day) ?? []
    usedByDay.set(day, codes)
    return codes
  }
  for (const order of orders) {
    if (!fromFile.has(order.gid)) owners.set(order.code, order.gid)
    const day = parseOrderCode(order.code)?.datePart
    if (day !== undefined) usedOn(day).push(order.code)
  }

  const result = [...orders]
  const codeChanges: CodeChange[] = []
  const sourced = result
    .map((order, index) => ({ order, index, fileId: fromFile.get(order.gid) }))
    .filter((entry): entry is { order: Row<'orders'>; index: number; fileId: number } => entry.fileId !== undefined)
    .sort((a, b) => a.fileId - b.fileId)

  for (const { order, index } of sourced) {
    const owner = owners.get(order.code)
    if (owner === undefined || owner === order.gid) {
      owners.set(order.code, order.gid)
      continue
    }
    const letter = parseOrderCode(order.code)?.letter ?? fallbackLetter
    const used = usedOn(orderCodeDatePart(order.soldAt))
    const code = buildOrderCode(order.soldAt, nextSeqOfDay(used, order.soldAt, letter), letter)
    used.push(code)
    owners.set(code, order.gid)
    result[index] = { ...order, code, originalCode: order.originalCode || order.code }
    codeChanges.push({ orderGid: order.gid, originalCode: order.code, code })
  }
  return { orders: result, codeChanges }
}

function mergeLedger(
  current: BackupData,
  incoming: BackupData,
  conflicts: readonly PaymentConflict[],
  choices: Readonly<Record<string, PaymentChoice>>,
  fallbackLetter: string,
): { merged: BackupData; summary: MergeSummary } {
  const { rows: cleanPrices, dropped } = cleanPriceRows(incoming)
  const summary: MergeSummary = {
    added: zeroCounts(),
    updated: zeroCounts(),
    keptLocal: zeroCounts(),
    codeChanges: [],
    priceConflicts: 0,
    paymentChoices: Object.fromEntries(conflicts.map((conflict) => [conflict.gid, choices[conflict.gid]!])),
    droppedPrices: dropped,
  }
  const counter = { summary }

  const localKeys = new Set(current.settings.map((row) => row.key))
  const addedSettings = incoming.settings.filter((row) => !localKeys.has(row.key))
  summary.added.settings = addedSettings.length
  summary.keptLocal.settings = incoming.settings.length - addedSettings.length
  const settings = [...current.settings, ...addedSettings]

  const groups = mergeVersioned('itemGroups', current.itemGroups, incoming.itemGroups, (row) => ({ ...row }), counter)
  const customers = mergeVersioned('customers', current.customers, incoming.customers, (row) => ({ ...row }), counter)
  const categories = mergeVersioned('expenseCategories', current.expenseCategories, incoming.expenseCategories, (row) => ({ ...row }), counter)
  const items = mergeVersioned(
    'items',
    current.items,
    incoming.items,
    (row) => ({ ...row, groupId: mapNullable(groups.idMap, row.groupId) }),
    counter,
  )
  const customerPrices = mergePrices(current.customerPrices, cleanPrices, customers.idMap, items.idMap, counter)
  const versionedOrders = mergeVersioned(
    'orders',
    current.orders,
    incoming.orders,
    (row) => ({ ...row, customerId: mapNullable(customers.idMap, row.customerId) }),
    counter,
  )
  const { orders, codeChanges } = recodeCollisions(versionedOrders.rows, versionedOrders.fromFile, fallbackLetter)
  summary.codeChanges = codeChanges
  const orderIds = versionedOrders.idMap

  const orderLines = appendMissing(
    'orderLines',
    current.orderLines,
    incoming.orderLines,
    (row) => ({ ...row, orderId: mapId(orderIds, row.orderId), itemId: mapNullable(items.idMap, row.itemId) }),
    counter,
  )

  const remapPayment = (row: BackupPayment): BackupPayment => ({
    ...row,
    orderId: mapId(orderIds, row.orderId),
    allocatedOrderId: row.allocatedOrderId === 0 ? 0 : mapId(orderIds, row.allocatedOrderId),
    customerId: mapNullable(customers.idMap, row.customerId),
  })
  const payments = [...current.payments]
  const paymentIndex = new Map(current.payments.map((row, index) => [row.gid, index]))
  const conflictGids = new Set(conflicts.map((conflict) => conflict.gid))
  let nextPaymentId = maxId(current.payments) + 1
  for (const row of byId(incoming.payments)) {
    const index = paymentIndex.get(row.gid)
    if (index === undefined) {
      payments.push({ ...remapPayment(row), id: nextPaymentId++ })
      summary.added.payments += 1
      continue
    }
    const choice = conflictGids.has(row.gid) ? choices[row.gid] : 'device'
    const local = payments[index]!
    if (choice === 'file') {
      payments[index] = { ...remapPayment(row), id: local.id, gid: local.gid }
      summary.updated.payments += 1
      continue
    }
    summary.keptLocal.payments += 1
    if (choice === 'append') {
      payments.push({ ...remapPayment(row), id: nextPaymentId++, gid: newGid() })
      summary.added.payments += 1
    }
  }

  const expenses = mergeVersioned(
    'expenses',
    current.expenses,
    incoming.expenses,
    (row) => ({ ...row, categoryId: mapNullable(categories.idMap, row.categoryId) }),
    counter,
  )

  return {
    merged: {
      settings,
      itemGroups: groups.rows,
      items: items.rows,
      customers: customers.rows,
      customerPrices,
      orders,
      orderLines,
      payments,
      expenseCategories: categories.rows,
      expenses: expenses.rows,
    },
    summary,
  }
}

/**
 * Gộp file vào sổ máy theo gid. Thiếu lựa chọn cho bất kỳ xung đột khoản thu nào ⇒ ném: hàm không bao giờ
 * tự chọn thay người bán. Sổ máy đã hỏng sẵn ⇒ `blocked` (dữ liệu của người bán, không phải lỗi mã). Sổ sau
 * gộp hỏng ⇒ ném `MergeReviewError` với câu cho người bán.
 */
export function mergeByGid(
  current: BackupData,
  incoming: BackupData,
  paymentChoices: Readonly<Record<string, PaymentChoice>>,
  fallbackLetter: string,
): MergeOutcome {
  const blocked = validateBackupIntegrity(current)
  if (blocked) return { blocked }

  const conflicts = findPaymentConflicts(current, incoming)
  const missing = conflicts.filter((conflict) => paymentChoices[conflict.gid] === undefined)
  if (missing.length > 0) {
    throw new Error(`Còn ${missing.length} khoản thu khác nhau giữa máy và file chưa chọn cách gộp.`)
  }

  const { merged, summary } = mergeLedger(current, incoming, conflicts, paymentChoices, fallbackLetter)
  const broken = validateBackupIntegrity(merged)
  if (broken) throw new MergeReviewError(`Lựa chọn này làm sổ hỏng: ${broken}. Chưa ghi gì — mở lại xem trước.`)
  return { blocked: null, merged, summary }
}

export type ChoiceEffect = {
  /** Nợ sau gộp của các khách mà xung đột này chạm tới (khách của dòng máy và của dòng file). */
  debtByCustomer: Record<string, number>
  collected: number
}

export type WillAdd = {
  itemGroups: string[]
  items: string[]
  customers: string[]
  expenseCategories: string[]
  orders: number
  payments: number
  expenses: number
}

export type MergePreview =
  | { blocked: string }
  | {
      blocked: null
      conflicts: PaymentConflict[]
      /** `false` ⇒ còn xung đột chưa chọn, các số dưới đây tạm tính xung đột đó là `device`. */
      complete: boolean
      debtByCustomer: Record<string, { now: number; after: number }>
      optionEffects: Record<string, Record<PaymentChoice, ChoiceEffect>>
      /** *Thêm riêng* một khoản đã trừ vào đơn: phần vượt số đơn còn nợ mất khỏi công nợ. */
      appendLosesExcess: Record<string, boolean>
      integrity: string | null
      willAdd: WillAdd
      totals: {
        collected: { now: number; after: number }
        debtTotal: { now: number; after: number }
        overpaidOrders: number
      }
      summary: MergeSummary
    }

const CHOICES: readonly PaymentChoice[] = ['device', 'file', 'append']

/**
 * Mọi số màn xem trước Gộp cần, tính cho **đúng bộ lựa chọn đang có** — không bao giờ giả định các xung đột
 * khác là `device` khi tính hiệu ứng của một xung đột.
 */
export function previewMerge(
  current: BackupData,
  incoming: BackupData,
  choices: Readonly<Partial<Record<string, PaymentChoice>>>,
  fallbackLetter: string,
): MergePreview {
  const blocked = validateBackupIntegrity(current)
  if (blocked) return { blocked }

  const conflicts = findPaymentConflicts(current, incoming)
  const effective: Record<string, PaymentChoice> = Object.fromEntries(
    conflicts.map((conflict) => [conflict.gid, choices[conflict.gid] ?? 'device']),
  )
  const run = (set: Readonly<Record<string, PaymentChoice>>) => {
    const { merged, summary } = mergeLedger(current, incoming, conflicts, set, fallbackLetter)
    const derived = withDerivedPaid(merged)
    return { merged, summary, derived, totals: ledgerTotals(derived.data) }
  }
  const main = run(effective)
  const now = ledgerTotals(current)

  const deviceCustomers = new Map(current.customers.map((row) => [row.id, row.gid]))
  const fileCustomers = new Map(incoming.customers.map((row) => [row.id, row.gid]))
  const touched = (conflict: PaymentConflict) => [
    ...new Set(
      [
        conflict.device.customerId === null ? undefined : deviceCustomers.get(conflict.device.customerId),
        conflict.file.customerId === null ? undefined : fileCustomers.get(conflict.file.customerId),
      ].filter((gid): gid is string => gid !== undefined),
    ),
  ]
  const debtFor = (totals: LedgerTotals, gids: readonly string[]) =>
    Object.fromEntries(gids.map((gid) => [gid, totals.debtByCustomerGid.get(gid) ?? 0]))

  const debtByCustomer: Record<string, { now: number; after: number }> = {}
  const optionEffects: Record<string, Record<PaymentChoice, ChoiceEffect>> = {}
  const appendLosesExcess: Record<string, boolean> = {}
  for (const conflict of conflicts) {
    const gids = touched(conflict)
    for (const gid of gids) {
      debtByCustomer[gid] = {
        now: now.debtByCustomerGid.get(gid) ?? 0,
        after: main.totals.debtByCustomerGid.get(gid) ?? 0,
      }
    }
    const effects = {} as Record<PaymentChoice, ChoiceEffect>
    for (const option of CHOICES) {
      const totals = option === effective[conflict.gid] ? main.totals : run({ ...effective, [conflict.gid]: option }).totals
      effects[option] = { debtByCustomer: debtFor(totals, gids), collected: totals.collected }
    }
    optionEffects[conflict.gid] = effects
    appendLosesExcess[conflict.gid] = conflict.file.allocatedOrderId !== 0
  }

  const namesOnlyInFile = <T extends { gid: string; name: string }>(local: readonly T[], file: readonly T[]) => {
    const known = new Set(local.map((row) => row.gid))
    return file.filter((row) => !known.has(row.gid)).map((row) => row.name)
  }

  return {
    blocked: null,
    conflicts,
    complete: conflicts.every((conflict) => choices[conflict.gid] !== undefined),
    debtByCustomer,
    optionEffects,
    appendLosesExcess,
    integrity: validateBackupIntegrity(main.merged),
    willAdd: {
      itemGroups: namesOnlyInFile(current.itemGroups, incoming.itemGroups),
      items: namesOnlyInFile(current.items, incoming.items),
      customers: namesOnlyInFile(current.customers, incoming.customers),
      expenseCategories: namesOnlyInFile(current.expenseCategories, incoming.expenseCategories),
      orders: main.summary.added.orders,
      payments: main.summary.added.payments,
      expenses: main.summary.added.expenses,
    },
    totals: {
      collected: { now: now.collected, after: main.totals.collected },
      debtTotal: { now: now.debtTotal, after: main.totals.debtTotal },
      overpaidOrders: main.derived.overpaidOrders,
    },
    summary: main.summary,
  }
}
