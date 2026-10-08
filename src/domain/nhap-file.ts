import { itemNameKey } from '@shared/item-name'
import { digitsOf } from './customer-search'
import { CsvFileError, type CsvRecord } from './csv'
import { MAX_MONEY_INPUT, parseMoneyInput } from './money'
import type { Customer, Item, ItemGroup } from './schema'

export type ImportKind = 'mon' | 'khach'
export type DuplicatePolicy = 'skip' | 'update'
export type RowError = { line: number; message: string }

export type ItemRow = {
  line: number
  group: string
  name: string
  unit: string
  unitPrice: number
  costPrice: number | null
  note: string
}
export type CustomerRow = { line: number; name: string; phone: string; address: string; note: string }

export type ItemChanges = Partial<Pick<Item, 'unitPrice' | 'costPrice' | 'unit' | 'note'>>
export type CustomerChanges = Partial<Pick<Customer, 'name' | 'phone' | 'address' | 'note'>>

export type GroupTarget = { existingId: number } | { newName: string } | null

export type ItemPlan = {
  creates: { row: ItemRow; group: GroupTarget }[]
  duplicates: { row: ItemRow; existing: Item; changes: ItemChanges; group: GroupTarget }[]
  errors: RowError[]
}

export type ItemWrites = {
  groupsToCreate: string[]
  creates: ItemPlan['creates']
  updates: ItemPlan['duplicates']
  skipped: number
  unchanged: number
}

export type CustomerPlan = {
  creates: CustomerRow[]
  duplicates: { row: CustomerRow; existing: Customer; changes: CustomerChanges }[]
  errors: RowError[]
}

export type CustomerWrites = {
  creates: CustomerRow[]
  updates: CustomerPlan['duplicates']
  skipped: number
  unchanged: number
}

function normalizeHeader(cell: string): string {
  return cell.trim().toLocaleLowerCase('vi').normalize('NFC')
}

function headerIndex(records: CsvRecord[]): Map<string, number> {
  const header = records[0]?.cells ?? []
  const map = new Map<string, number>()
  header.forEach((cell, index) => map.set(normalizeHeader(cell), index))
  return map
}

function cellAt(row: CsvRecord, index: number | undefined): string {
  if (index === undefined) return ''
  return (row.cells[index] ?? '').trim().normalize('NFC')
}

function requireColumn(index: Map<string, number>, name: string, fileHint: string): number {
  const found = index.get(normalizeHeader(name))
  if (found === undefined) {
    throw new CsvFileError(`File không có cột "${name}". ${fileHint}`)
  }
  return found
}

function isBlankRow(row: CsvRecord): boolean {
  return row.cells.every((cell) => cell.trim() === '')
}

const CURRENCY_SUFFIX = /\s*(đ|₫|vnd)\s*$/i

/** Giá đọc được + lỗi (nếu có) cho một ô giá cụ thể, dùng chung cho giá bán và giá vốn. */
function readPriceCell(raw: string, line: number, label: string): { value: number | null; error?: RowError } {
  const trimmed = raw.trim()
  if (!trimmed) return { value: null }
  const withoutSuffix = trimmed.replace(CURRENCY_SUFFIX, '')
  const parsed = parseMoneyInput(withoutSuffix)
  if (parsed === null) {
    return { value: null, error: { line, message: `Dòng ${line}: ${label} "${raw.trim()}" không đọc được.` } }
  }
  if (parsed > MAX_MONEY_INPUT) {
    return { value: null, error: { line, message: `Dòng ${line}: ${label} vượt mức tối đa.` } }
  }
  return { value: parsed }
}

export function readItemRows(records: CsvRecord[]): { rows: ItemRow[]; errors: RowError[] } {
  const index = headerIndex(records)
  const nameCol = requireColumn(index, 'Tên món', 'Đây có phải file khách? Tải lại file mẫu món.')
  const priceCol = requireColumn(index, 'Giá bán', 'Tải lại file mẫu món.')
  const groupCol = index.get(normalizeHeader('Nhóm'))
  const unitCol = index.get(normalizeHeader('Đơn vị'))
  const costCol = index.get(normalizeHeader('Giá vốn'))
  const noteCol = index.get(normalizeHeader('Ghi chú'))

  const rows: ItemRow[] = []
  const errors: RowError[] = []

  for (const record of records.slice(1)) {
    if (isBlankRow(record)) continue
    const { line } = record
    const name = cellAt(record, nameCol)
    if (!name) {
      errors.push({ line, message: `Dòng ${line}: thiếu tên món.` })
      continue
    }
    const priceRaw = cellAt(record, priceCol)
    if (!priceRaw) {
      errors.push({ line, message: `Dòng ${line}: thiếu giá bán.` })
      continue
    }
    const price = readPriceCell(priceRaw, line, 'giá bán')
    if (price.error) {
      errors.push(price.error)
      continue
    }
    const costRaw = cellAt(record, costCol)
    const cost = readPriceCell(costRaw, line, 'giá vốn')
    if (cost.error) {
      errors.push(cost.error)
      continue
    }
    rows.push({
      line,
      group: cellAt(record, groupCol),
      name,
      unit: cellAt(record, unitCol),
      unitPrice: price.value!,
      costPrice: cost.value,
      note: cellAt(record, noteCol),
    })
  }

  return { rows, errors }
}

const INVALID_PHONE_CHARS = /[^0-9\s.\-+()]/
// SĐT Việt Nam sau 2014 luôn đủ 10 số và bắt đầu bằng 0. Excel ở cột General đổi "0912345678" thành
// số 912345678, mất chữ số 0 đầu mà không lộ ký tự lạ nào — INVALID_PHONE_CHARS không bắt được.
const LOOKS_LIKE_MISSING_LEADING_ZERO = /^[1-9][0-9]{8}$/

export function readCustomerRows(records: CsvRecord[]): { rows: CustomerRow[]; errors: RowError[] } {
  const index = headerIndex(records)
  const nameCol = requireColumn(index, 'Tên', 'Tải lại file mẫu khách.')
  const phoneCol = index.get(normalizeHeader('Số điện thoại'))
  const addressCol = index.get(normalizeHeader('Địa chỉ'))
  const noteCol = index.get(normalizeHeader('Ghi chú'))

  const rows: CustomerRow[] = []
  const errors: RowError[] = []

  for (const record of records.slice(1)) {
    if (isBlankRow(record)) continue
    const { line } = record
    const name = cellAt(record, nameCol)
    if (!name) {
      errors.push({ line, message: `Dòng ${line}: thiếu tên.` })
      continue
    }
    const phone = cellAt(record, phoneCol)
    if (phone && (INVALID_PHONE_CHARS.test(phone) || LOOKS_LIKE_MISSING_LEADING_ZERO.test(phone))) {
      errors.push({
        line,
        message: `Dòng ${line}: SĐT bị Excel đổi thành số, hãy định dạng cột là Văn bản.`,
      })
      continue
    }
    rows.push({ line, name, phone, address: cellAt(record, addressCol), note: cellAt(record, noteCol) })
  }

  return { rows, errors }
}

function resolveGroupTarget(groupCell: string, groups: ItemGroup[]): GroupTarget {
  const trimmed = groupCell.trim()
  if (!trimmed) return null
  const key = itemNameKey(trimmed)
  const existing = groups.find((g) => itemNameKey(g.name) === key)
  return existing ? { existingId: existing.id! } : { newName: trimmed }
}

function itemChangesOf(row: ItemRow, existing: Item): ItemChanges {
  const changes: ItemChanges = {}
  if (row.unitPrice !== existing.unitPrice) changes.unitPrice = row.unitPrice
  if (row.costPrice !== null && row.costPrice !== existing.costPrice) changes.costPrice = row.costPrice
  if (row.unit && row.unit !== existing.unit) changes.unit = row.unit
  if (row.note && row.note !== existing.note) changes.note = row.note
  return changes
}

export function planItemImport(rows: ItemRow[], items: Item[], groups: ItemGroup[]): ItemPlan {
  const creates: ItemPlan['creates'] = []
  const duplicates: ItemPlan['duplicates'] = []
  const errors: RowError[] = []
  const seenTargets = new Map<string, { line: number; label: string }>()

  for (const row of rows) {
    const key = itemNameKey(row.name)
    const matches = items.filter((existing) => itemNameKey(existing.name) === key)
    if (matches.length > 1) {
      errors.push({ line: row.line, message: `Dòng ${row.line}: Sổ đang có 2 món tên "${row.name}", sửa trong app trước.` })
      continue
    }

    const existing = matches[0]
    const targetKey = existing ? `existing:${existing.id}` : `new:${key}`
    const seen = seenTargets.get(targetKey)
    if (seen) {
      errors.push({ line: row.line, message: `Dòng ${row.line}: cùng một món với dòng ${seen.line} (${seen.label}).` })
      continue
    }
    seenTargets.set(targetKey, { line: row.line, label: existing ? existing.name : row.name.trim() })

    const group = resolveGroupTarget(row.group, groups)
    if (existing) {
      duplicates.push({ row, existing, changes: itemChangesOf(row, existing), group })
    } else {
      creates.push({ row, group })
    }
  }

  return { creates, duplicates, errors }
}

export function effectiveItemWrites(plan: ItemPlan, policy: DuplicatePolicy): ItemWrites {
  const updates =
    policy === 'update'
      ? plan.duplicates.filter((d) => Object.keys(d.changes).length > 0 || groupChanged(d.existing, d.group))
      : []
  const unchanged = policy === 'update' ? plan.duplicates.length - updates.length : 0
  const skipped = policy === 'skip' ? plan.duplicates.length : 0

  const groupsToCreate: string[] = []
  const seenGroupKeys = new Set<string>()
  for (const entry of [...plan.creates, ...updates]) {
    if (entry.group && 'newName' in entry.group) {
      const key = itemNameKey(entry.group.newName)
      if (!seenGroupKeys.has(key)) {
        seenGroupKeys.add(key)
        groupsToCreate.push(entry.group.newName)
      }
    }
  }

  return { groupsToCreate, creates: plan.creates, updates, skipped, unchanged }
}

function groupChanged(existing: Item, group: GroupTarget): boolean {
  if (group === null) return false
  if ('existingId' in group) return group.existingId !== existing.groupId
  return true
}

type NewCustomerTarget = { key: string; name: string; phoneDigits: string; line: number }

function customerChangesOf(row: CustomerRow, existing: Customer, matchedByPhone: boolean): CustomerChanges {
  const changes: CustomerChanges = {}
  if (matchedByPhone && row.name && row.name.trim() !== existing.name) changes.name = row.name.trim()
  if (row.phone && digitsOf(row.phone) !== digitsOf(existing.phone)) changes.phone = row.phone
  if (row.address && row.address !== existing.address) changes.address = row.address
  if (row.note && row.note !== existing.note) changes.note = row.note
  return changes
}

export function planCustomerImport(rows: CustomerRow[], customers: Customer[]): CustomerPlan {
  const creates: CustomerRow[] = []
  const duplicates: CustomerPlan['duplicates'] = []
  const errors: RowError[] = []
  const seenTargets = new Map<string, { line: number; label: string }>()
  const newTargets: NewCustomerTarget[] = []

  for (const row of rows) {
    const phoneDigits = digitsOf(row.phone)
    const hasPhone = phoneDigits !== ''

    if (hasPhone) {
      const dbMatches = customers.filter((c) => digitsOf(c.phone) === phoneDigits)
      if (dbMatches.length > 1) {
        errors.push({ line: row.line, message: `Dòng ${row.line}: Sổ đang có 2 khách số "${row.phone}", sửa trong app trước.` })
        continue
      }
      const existing = dbMatches[0]
      if (existing) {
        if (!registerTarget(seenTargets, `existing:${existing.id}`, row.line, existing.name, errors)) continue
        duplicates.push({ row, existing, changes: customerChangesOf(row, existing, true) })
        continue
      }
      const newMatch = newTargets.find((t) => t.phoneDigits === phoneDigits)
      if (newMatch) {
        errors.push({ line: row.line, message: `Dòng ${row.line}: cùng một khách với dòng ${newMatch.line} (${newMatch.name}).` })
        continue
      }
      const key = `new:phone:${phoneDigits}`
      seenTargets.set(key, { line: row.line, label: row.name.trim() })
      newTargets.push({ key, name: row.name.trim(), phoneDigits, line: row.line })
      creates.push(row)
      continue
    }

    const nameKey = itemNameKey(row.name)
    const dbMatches = customers.filter((c) => itemNameKey(c.name) === nameKey)
    if (dbMatches.length > 1) {
      errors.push({ line: row.line, message: `Dòng ${row.line}: Sổ đang có 2 khách tên "${row.name.trim()}", sửa trong app trước.` })
      continue
    }
    const existing = dbMatches[0]
    if (existing) {
      if (!registerTarget(seenTargets, `existing:${existing.id}`, row.line, existing.name, errors)) continue
      duplicates.push({ row, existing, changes: customerChangesOf(row, existing, false) })
      continue
    }
    const newMatch = newTargets.find((t) => itemNameKey(t.name) === nameKey)
    if (newMatch) {
      errors.push({ line: row.line, message: `Dòng ${row.line}: cùng một khách với dòng ${newMatch.line} (${newMatch.name}).` })
      continue
    }
    const key = `new:name:${nameKey}`
    seenTargets.set(key, { line: row.line, label: row.name.trim() })
    newTargets.push({ key, name: row.name.trim(), phoneDigits: '', line: row.line })
    creates.push(row)
  }

  return { creates, duplicates, errors }
}

/** Trả `false` và ghi lỗi nếu đích đã bị một dòng trước chiếm; trả `true` và ghi nhận đích nếu còn trống. */
function registerTarget(
  seen: Map<string, { line: number; label: string }>,
  key: string,
  line: number,
  label: string,
  errors: RowError[],
): boolean {
  const existing = seen.get(key)
  if (existing) {
    errors.push({ line, message: `Dòng ${line}: cùng một khách với dòng ${existing.line} (${existing.label}).` })
    return false
  }
  seen.set(key, { line, label })
  return true
}

export function effectiveCustomerWrites(plan: CustomerPlan, policy: DuplicatePolicy): CustomerWrites {
  const updates = policy === 'update' ? plan.duplicates.filter((d) => Object.keys(d.changes).length > 0) : []
  const unchanged = policy === 'update' ? plan.duplicates.length - updates.length : 0
  const skipped = policy === 'skip' ? plan.duplicates.length : 0
  return { creates: plan.creates, updates, skipped, unchanged }
}

const BOM = '﻿'

export const ITEM_TEMPLATE = {
  filename: 'mau-mon.csv',
  text:
    BOM +
    'Nhóm,Tên món,Đơn vị,Giá bán,Giá vốn,Ghi chú\r\n' +
    'Đồ uống,Trà đá,Ly,3000,500,\r\n' +
    'Đồ ăn,Phở bò,Tô,45000,25000,"Không hành, thêm chanh"',
}

export const CUSTOMER_TEMPLATE = {
  filename: 'mau-khach.csv',
  text: BOM + 'Tên,Số điện thoại,Địa chỉ,Ghi chú\r\n' + 'Chị Hoa,0912 345 678,12 Lê Lợi,Khách quen',
}
