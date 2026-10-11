import { itemNameKey as storedNameKey } from './item-name'
import {
  OptionGroupPayloadSchema,
  type LegacyOptionGroupSchema,
  type ToppingMenuItemSchema,
} from './ledger-schemas'
import type { z } from 'zod'

type LegacyOptionGroup = z.infer<typeof LegacyOptionGroupSchema>
type ToppingMenuItem = z.infer<typeof ToppingMenuItemSchema>

/** Namespace hằng: gid sinh ra chỉ dựa trên gid thực thể nên giống nhau trên Worker và trên máy cục bộ. */
const FIXED_NS = '6f1d4c3a-8b2e-4f57-9a61-3c0e8d7b5a24'

const LABEL_MAX = 40
const GROUP_ITEMS_MAX = 30
const REFS_MAX = 20

function sha1(bytes: Uint8Array): Uint8Array {
  const length = bytes.length
  const padded = new Uint8Array((((length + 8) >> 6) + 1) * 64)
  padded.set(bytes)
  padded[length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 4, length * 8)
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000))

  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]
  const w = new Uint32Array(80)
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!
      w[i] = (x << 1) | (x >>> 31)
    }
    let [a, b, c, d, e] = h as [number, number, number, number, number]
    for (let i = 0; i < 80; i++) {
      const [f, k] =
        i < 20
          ? [(b & c) | (~b & d), 0x5a827999]
          : i < 40
            ? [b ^ c ^ d, 0x6ed9eba1]
            : i < 60
              ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
              : [b ^ c ^ d, 0xca62c1d6]
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]!) >>> 0
      e = d
      d = c
      c = (b << 30) | (b >>> 2)
      b = a
      a = temp
    }
    h[0] = (h[0]! + a) >>> 0
    h[1] = (h[1]! + b) >>> 0
    h[2] = (h[2]! + c) >>> 0
    h[3] = (h[3]! + d) >>> 0
    h[4] = (h[4]! + e) >>> 0
  }
  const out = new Uint8Array(20)
  const outView = new DataView(out.buffer)
  h.forEach((word, index) => outView.setUint32(index * 4, word))
  return out
}

/**
 * UUID v5 (RFC 4122). Đồng bộ, không qua `crypto.subtle`: di trú phải chạy trọn trong `transactionSync` của DO và
 * trong một transaction Dexie — chờ một promise ngoài Dexie là Dexie tự commit giữa chừng.
 */
export function uuidV5(name: string, namespace: string): string {
  const ns = namespace.replace(/-/g, '')
  const nsBytes = Uint8Array.from({ length: 16 }, (_, i) => parseInt(ns.slice(i * 2, i * 2 + 2), 16))
  const nameBytes = new TextEncoder().encode(name)
  const input = new Uint8Array(16 + nameBytes.length)
  input.set(nsBytes)
  input.set(nameBytes, 16)
  const hash = sha1(input).slice(0, 16)
  hash[6] = (hash[6]! & 0x0f) | 0x50
  hash[8] = (hash[8]! & 0x3f) | 0x80
  const hex = [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function deterministicGid(name: string): string {
  return uuidV5(name, FIXED_NS)
}

export type MigrationGroup = {
  gid: string
  name: string
  sortOrder: number
  optionGroups?: readonly LegacyOptionGroup[]
  toppingMenu?: readonly ToppingMenuItem[]
  optionGroupGids?: readonly string[]
}

export type MigrationItem = {
  gid: string
  name: string
  unitPrice: number
  isActive: number
  kind?: string
  createdAt?: number
}

export type MigrationOptionGroup = { gid: string; sortOrder: number }

export type NewToppingItem = {
  gid: string
  name: string
  unit: string
  unitPrice: number
  costPrice: null
  isActive: 0
  note: string
  kind: 'topping'
  createdAt: number
  updatedAt: number
}

export type NewOptionGroup = z.infer<typeof OptionGroupPayloadSchema>

export type CatalogMigrationPlan = {
  createItems: NewToppingItem[]
  /** Món sẵn có cùng tên với một topping: chỉ đặt `kind: 'topping'`, giữ nguyên `isActive` và giá. */
  markToppings: string[]
  createOptionGroups: NewOptionGroup[]
  attach: { groupGid: string; optionGroupGids: string[] }[]
}

/**
 * NFC chỉ trong di trú: cùng chữ "đá" gõ từ hai bàn phím có thể ra hai chuỗi mã khác nhau. Không đưa vào `itemNameKey`
 * dùng chung — đó là luật `item-name-taken` mà máy 2.19.0 cũng chịu, đổi nó là từ chối thêm event của máy cũ.
 */
const itemNameKey = (name: string) => storedNameKey(name.normalize('NFC'))

/** Cắt theo ký tự, không theo đơn vị UTF-16 (khỏi để nửa emoji), nhưng vẫn trong giới hạn `.length` của schema. */
function label(value: string): string {
  let out = ''
  for (const char of value.trim()) {
    if (out.length + char.length > LABEL_MAX) break
    out += char
  }
  return out.trim()
}

/** Nhóm Đá chung/Đá riêng là hằng có sẵn cho mọi món, không di trú; nhóm "Đá" chủ quán tự đặt thì vẫn di trú. */
const ICE_CHOICES = new Set(['Đá chung', 'Đá riêng'])
const isIceConstant = (group: LegacyOptionGroup) =>
  itemNameKey(group.name) === 'đá' && group.choices.every((choice) => ICE_CHOICES.has(choice.normalize('NFC').trim()))

/**
 * Nhóm đã có trường `optionGroupGids` (kể cả `[]`) là đã di trú hoặc chủ quán đã chọn gỡ hết — chỉ nhóm THIẾU hẳn
 * trường mới đủ điều kiện. Máy mới chỉ ghi trường này khi đang sửa nó; máy cũ đẩy thiếu thì Worker giữ bản đã lưu.
 */
export function needsCatalogMigration(group: MigrationGroup): boolean {
  return (
    group.optionGroupGids === undefined &&
    ((group.optionGroups?.length ?? 0) > 0 || (group.toppingMenu?.length ?? 0) > 0)
  )
}

/** Giá xuất hiện nhiều nhất; hoà thì lấy giá thấp nhất. */
function commonestPrice(prices: readonly number[]): number {
  const counts = new Map<number, number>()
  for (const price of prices) counts.set(price, (counts.get(price) ?? 0) + 1)
  let best = prices[0]!
  for (const [price, count] of counts) {
    const bestCount = counts.get(best)!
    if (count > bestCount || (count === bestCount && price < best)) best = price
  }
  return best
}

/**
 * Chuyển thực đơn tuỳ chọn/topping kiểu cũ của nhóm món sang nhóm lựa chọn dùng chung và món topping. Hàm thuần,
 * Worker và máy cục bộ cùng gọi; chạy lại trên kết quả của chính nó cho kế hoạch rỗng. Không bao giờ ghi đè dòng đích
 * đã có — chỉ tạo mới hoặc gắn gid. Dữ liệu cũ vượt giới hạn schema mới được cắt bớt, không làm hỏng lượt chạy.
 */
export function planCatalogMigration(input: {
  groups: readonly MigrationGroup[]
  items: readonly MigrationItem[]
  optionGroups: readonly MigrationOptionGroup[]
  now: number
}): CatalogMigrationPlan {
  const plan: CatalogMigrationPlan = { createItems: [], markToppings: [], createOptionGroups: [], attach: [] }
  const groups = input.groups
    .filter(needsCatalogMigration)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.gid.localeCompare(b.gid))
  if (groups.length === 0) return plan

  const itemsByGid = new Map(input.items.map((item) => [item.gid, item]))
  const itemsByKey = new Map<string, MigrationItem>()
  // Thứ tự chỉ dựa trên dữ liệu, không theo thứ tự đọc: Worker đọc theo seq, máy cục bộ theo id.
  const rank = (item: MigrationItem) => (item.kind === 'topping' ? 0 : item.isActive === 1 ? 1 : 2)
  const before = (a: MigrationItem, b: MigrationItem) =>
    rank(a) - rank(b) || (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.gid.localeCompare(b.gid)
  for (const item of input.items) {
    const key = itemNameKey(item.name)
    const current = itemsByKey.get(key)
    if (!current || before(item, current) < 0) itemsByKey.set(key, item)
  }

  const toppingNames = new Map<string, { name: string; prices: number[] }>()
  for (const group of groups) {
    for (const topping of group.toppingMenu ?? []) {
      const name = label(topping.name)
      if (!name) continue
      const key = itemNameKey(name)
      const entry = toppingNames.get(key) ?? { name, prices: [] }
      entry.prices.push(topping.price)
      toppingNames.set(key, entry)
    }
  }

  const toppingItem = new Map<string, MigrationItem>()
  const marked = new Set<string>()
  for (const [key, { name, prices }] of toppingNames) {
    const gid = deterministicGid(`topping:${key}`)
    const existing = itemsByKey.get(key) ?? itemsByGid.get(gid)
    if (existing) {
      if (existing.kind !== 'topping' && !marked.has(existing.gid)) {
        marked.add(existing.gid)
        plan.markToppings.push(existing.gid)
      }
      toppingItem.set(key, existing)
      continue
    }
    const created: NewToppingItem = {
      gid,
      name,
      unit: '',
      unitPrice: commonestPrice(prices),
      costPrice: null,
      isActive: 0,
      note: '',
      kind: 'topping',
      createdAt: input.now,
      updatedAt: input.now,
    }
    plan.createItems.push(created)
    toppingItem.set(key, created)
  }

  const existingGroups = new Set(input.optionGroups.map((group) => group.gid))
  const planned = new Set<string>()
  let sortOrder = Math.max(-1, ...input.optionGroups.map((group) => group.sortOrder)) + 1

  const addGroup = (payload: Record<string, unknown>): string | null => {
    const gid = String(payload.gid)
    if (existingGroups.has(gid) || planned.has(gid)) return gid
    const parsed = OptionGroupPayloadSchema.safeParse({
      required: 0,
      maxSelect: 1,
      defaultChoice: null,
      sortOrder: sortOrder,
      isActive: 1,
      createdAt: input.now,
      updatedAt: input.now,
      ...payload,
    })
    if (!parsed.success) return null
    sortOrder += 1
    planned.add(gid)
    plan.createOptionGroups.push(parsed.data)
    return gid
  }

  for (const group of groups) {
    const toppings: { itemGid: string; price: number | null }[] = []
    for (const topping of group.toppingMenu ?? []) {
      const item = toppingItem.get(itemNameKey(label(topping.name)))
      if (!item || toppings.some((entry) => entry.itemGid === item.gid)) continue
      toppings.push({ itemGid: item.gid, price: topping.price === item.unitPrice ? null : topping.price })
    }

    // Chừa một chỗ cho nhóm topping: nhóm vượt giới hạn gắn thì không tạo, khỏi để lại nhóm lựa chọn không ai dùng.
    const choiceSlots = REFS_MAX - (toppings.length > 0 ? 1 : 0)
    const gids: string[] = []
    for (const legacy of group.optionGroups ?? []) {
      if (gids.length >= choiceSlots) break
      if (isIceConstant(legacy)) continue
      const name = label(legacy.name)
      const choices = [...new Set(legacy.choices.map(label).filter(Boolean))].slice(0, GROUP_ITEMS_MAX)
      if (!name || choices.length === 0) continue
      const gid = addGroup({
        gid: deterministicGid(`choice:${group.gid}:${itemNameKey(name)}`),
        name,
        kind: 'choice',
        choices,
      })
      if (gid && !gids.includes(gid)) gids.push(gid)
    }

    if (toppings.length > 0) {
      const gid = addGroup({
        gid: deterministicGid(`toppings:${group.gid}`),
        name: label(`Topping ${group.name}`),
        kind: 'topping',
        toppings: toppings.slice(0, GROUP_ITEMS_MAX),
        maxSelect: null,
      })
      if (gid && !gids.includes(gid)) gids.push(gid)
    }

    // Không ghi `[]` làm dấu "đã xong": mảng rỗng là chủ quán chủ ý gỡ hết. Menu làm sạch xong không còn gì thì để
    // nhóm nguyên trạng — lần quét sau cũng ra kế hoạch rỗng.
    if (gids.length > 0) plan.attach.push({ groupGid: group.gid, optionGroupGids: gids })
  }
  return plan
}

export function isEmptyCatalogMigrationPlan(plan: CatalogMigrationPlan): boolean {
  return (
    plan.createItems.length === 0 &&
    plan.markToppings.length === 0 &&
    plan.createOptionGroups.length === 0 &&
    plan.attach.length === 0
  )
}
