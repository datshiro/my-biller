import type { z } from 'zod'
import { catalogLabel, catalogNameKey, deterministicGid, type NewOptionGroup, type NewToppingItem } from './catalog-migration'
import { OptionGroupPayloadSchema, type LegacyOptionGroupSchema, type ToppingMenuItemSchema } from './ledger-schemas'

type LegacyOptionGroup = z.infer<typeof LegacyOptionGroupSchema>
type ToppingMenuItem = z.infer<typeof ToppingMenuItemSchema>

export type LegacyMenu = { optionGroups: LegacyOptionGroup[]; toppingMenu: ToppingMenuItem[] }

export type LegacyMenuItem = { gid: string; name: string; unitPrice: number; isActive: number; kind?: string; createdAt?: number }

const LABEL_MAX = 40
const GROUP_ITEMS_MAX = 30
const REFS_MAX = 20

/**
 * Thực đơn kiểu cũ của một nhóm món, dựng từ các nhóm lựa chọn đang gắn vào nó — thứ máy 2.19.0 đọc được. Nhóm tắt
 * hoặc đã mất và topping trỏ món không còn (hay không còn là món topping) bị bỏ, cùng luật với màn bán bản mới. Trùng
 * tên thì nhóm có `sortOrder` nhỏ hơn thắng: máy cũ chỉ phân biệt topping và nhóm tuỳ chọn theo tên.
 */
export function projectLegacyMenu(
  optionGroupGids: readonly string[],
  optionGroups: readonly NewOptionGroup[],
  items: readonly LegacyMenuItem[],
): LegacyMenu {
  const groupByGid = new Map(optionGroups.map((group) => [group.gid, group]))
  const itemByGid = new Map(items.map((item) => [item.gid, item]))
  const attached = optionGroupGids
    .map((gid, index) => ({ group: groupByGid.get(gid), index }))
    .filter((entry): entry is { group: NewOptionGroup; index: number } => entry.group?.isActive === 1)
    .sort((a, b) => a.group.sortOrder - b.group.sortOrder || a.index - b.index)
    .map((entry) => entry.group)

  const menu: LegacyMenu = { optionGroups: [], toppingMenu: [] }
  const choiceNames = new Set<string>()
  const toppingNames = new Set<string>()
  for (const group of attached) {
    if (group.kind === 'choice') {
      const key = catalogNameKey(group.name)
      if (choiceNames.has(key)) continue
      choiceNames.add(key)
      menu.optionGroups.push({ name: group.name, choices: [...group.choices] })
      continue
    }
    for (const topping of group.toppings) {
      const item = itemByGid.get(topping.itemGid)
      if (!item || item.kind !== 'topping' || !item.name.trim()) continue
      const key = catalogNameKey(item.name)
      if (toppingNames.has(key)) continue
      toppingNames.add(key)
      // Trim như `ToppingMenuItemSchema`: tên dư khoảng trắng thì bản lưu khác phép chiếu mãi, mỗi lần chiếu lại sinh event.
      menu.toppingMenu.push({ name: item.name.trim(), price: topping.price ?? item.unitPrice })
    }
  }
  return menu
}

export function sameLegacyMenu(a: Partial<LegacyMenu>, b: Partial<LegacyMenu>): boolean {
  return (
    JSON.stringify(a.optionGroups ?? []) === JSON.stringify(b.optionGroups ?? []) &&
    JSON.stringify(a.toppingMenu ?? []) === JSON.stringify(b.toppingMenu ?? [])
  )
}

type ToppingEntry = { name: string; price: number }
type ChoiceEntry = { name: string; choices: string[] }

function toppingsByKey(menu: LegacyMenu): Map<string, ToppingEntry> {
  const out = new Map<string, ToppingEntry>()
  for (const topping of menu.toppingMenu) {
    const key = catalogNameKey(topping.name)
    if (key && !out.has(key)) out.set(key, { name: topping.name.trim(), price: topping.price })
  }
  return out
}

function choicesByKey(menu: LegacyMenu): Map<string, ChoiceEntry> {
  const out = new Map<string, ChoiceEntry>()
  for (const group of menu.optionGroups) {
    const key = catalogNameKey(group.name)
    if (!key || out.has(key)) continue
    out.set(key, { name: group.name.trim(), choices: [...new Set(group.choices.map((choice) => choice.normalize('NFC').trim()))] })
  }
  return out
}

const sameTopping = (a: ToppingEntry | undefined, b: ToppingEntry | undefined) =>
  a === undefined || b === undefined ? a === b : a.price === b.price
const sameChoices = (a: ChoiceEntry | undefined, b: ChoiceEntry | undefined) =>
  a === undefined || b === undefined ? a === b : JSON.stringify(a.choices) === JSON.stringify(b.choices)

/**
 * Diff ba chiều theo từng phần tử: chỉ phần tử máy cũ thực sự sửa (`before` khác `after`) mới được dịch, và chỉ khi
 * `before` còn khớp sổ — máy khác vừa sửa phần tử đó thì ưu tiên sổ, bản sửa của sheet mở lâu bị bỏ.
 */
function changedKeys<T>(
  before: Map<string, T>,
  after: Map<string, T>,
  ledger: Map<string, T>,
  same: (a: T | undefined, b: T | undefined) => boolean,
): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].filter(
    (key) => !same(before.get(key), after.get(key)) && same(before.get(key), ledger.get(key)),
  )
}

export type LegacyMenuEditInput = {
  group: { gid: string; name: string; optionGroupGids: readonly string[] }
  before: LegacyMenu
  after: LegacyMenu
  optionGroups: readonly NewOptionGroup[]
  items: readonly LegacyMenuItem[]
  /** `optionGroupGids` của mọi món và nhóm món KHÁC nhóm đang sửa — để biết nhóm lựa chọn nào đang dùng chung. */
  otherAttachments: readonly (readonly string[])[]
  now: number
  newGid: () => string
}

export type LegacyMenuEdit =
  | { status: 'unchanged' }
  | { status: 'skipped'; reason: string }
  | {
      status: 'translated'
      createItems: NewToppingItem[]
      markToppings: string[]
      optionGroups: { before: NewOptionGroup | null; after: NewOptionGroup }[]
      optionGroupGids: string[]
    }

const tooLong = (value: string) => value.trim().length > LABEL_MAX

/**
 * Dịch sửa đổi thực đơn kiểu cũ (sheet của máy 2.19.0) sang nhóm lựa chọn và món topping. Hàm thuần, không ném lỗi:
 * mọi thứ nó trả ra đều qua schema mới; phần không dịch được (vượt giới hạn) thì trả `skipped` để Worker nhận event
 * nguyên trạng và ghi cảnh báo — từ chối event của máy cũ là cuộn mất mọi đơn nó làm sau đó.
 */
export function planLegacyMenuEdit(input: LegacyMenuEditInput): LegacyMenuEdit {
  const ledger = projectLegacyMenu(input.group.optionGroupGids, input.optionGroups, input.items)
  const [beforeToppings, afterToppings, ledgerToppings] = [input.before, input.after, ledger].map(toppingsByKey) as [
    Map<string, ToppingEntry>,
    Map<string, ToppingEntry>,
    Map<string, ToppingEntry>,
  ]
  const [beforeChoices, afterChoices, ledgerChoices] = [input.before, input.after, ledger].map(choicesByKey) as [
    Map<string, ChoiceEntry>,
    Map<string, ChoiceEntry>,
    Map<string, ChoiceEntry>,
  ]
  const toppingKeys = changedKeys(beforeToppings, afterToppings, ledgerToppings, sameTopping)
  const choiceKeys = changedKeys(beforeChoices, afterChoices, ledgerChoices, sameChoices)
  if (toppingKeys.length === 0 && choiceKeys.length === 0) return { status: 'unchanged' }

  for (const key of toppingKeys) {
    const topping = afterToppings.get(key)
    if (topping && tooLong(topping.name)) return { status: 'skipped', reason: `Tên topping “${topping.name}” dài quá ${LABEL_MAX} ký tự.` }
  }
  for (const key of choiceKeys) {
    const group = afterChoices.get(key)
    if (!group) continue
    if (tooLong(group.name)) return { status: 'skipped', reason: `Tên nhóm tuỳ chọn “${group.name}” dài quá ${LABEL_MAX} ký tự.` }
    if (group.choices.length > GROUP_ITEMS_MAX) {
      return { status: 'skipped', reason: `Nhóm tuỳ chọn “${group.name}” có quá ${GROUP_ITEMS_MAX} lựa chọn.` }
    }
    const long = group.choices.find(tooLong)
    if (long) return { status: 'skipped', reason: `Lựa chọn “${long}” dài quá ${LABEL_MAX} ký tự.` }
  }

  const catalog = new Map(input.optionGroups.map((group) => [group.gid, group]))
  const items = new Map(input.items.map((item) => [item.gid, item]))
  const shared = new Set(input.otherAttachments.flat())
  const gids = [...input.group.optionGroupGids]
  const touched = new Map<string, { before: NewOptionGroup | null; after: NewOptionGroup }>()
  const createItems: NewToppingItem[] = []
  const markToppings: string[] = []
  let sortOrder = Math.max(-1, ...input.optionGroups.map((group) => group.sortOrder)) + 1

  const copies = new Map<string, string>()
  const current = (gid: string): NewOptionGroup | undefined => {
    const own = copies.get(gid) ?? gid
    return touched.get(own)?.after ?? catalog.get(own)
  }
  const active = (kind: NewOptionGroup['kind']) =>
    gids.map(current).filter((group): group is NewOptionGroup => group?.kind === kind && group.isActive === 1)

  /** Nhóm dùng chung với món khác thì sao-khi-ghi: G nhận bản sao đã sửa, món khác giữ nguyên bản cũ. */
  const writable = (group: NewOptionGroup): NewOptionGroup => {
    const edited = touched.get(group.gid)
    if (edited) return edited.after
    if (!shared.has(group.gid)) {
      const after = { ...structuredClone(group), updatedAt: input.now }
      touched.set(group.gid, { before: group, after })
      return after
    }
    const copy: NewOptionGroup = {
      ...structuredClone(group),
      gid: input.newGid(),
      name: catalogLabel(`${group.name} (${input.group.name})`),
      createdAt: input.now,
      updatedAt: input.now,
    }
    touched.set(copy.gid, { before: null, after: copy })
    copies.set(group.gid, copy.gid)
    const index = gids.indexOf(group.gid)
    if (index >= 0) gids[index] = copy.gid
    else gids.push(copy.gid)
    return copy
  }

  /** Nhóm hết phần tử thì gỡ khỏi G và bỏ luôn bản sửa (schema đòi ít nhất một phần tử); bản trong sổ giữ nguyên. */
  const detach = (gid: string) => {
    const index = gids.indexOf(gid)
    if (index >= 0) gids.splice(index, 1)
    touched.delete(gid)
  }

  const itemForKey = (key: string): LegacyMenuItem | undefined => {
    const rank = (item: LegacyMenuItem) => (item.kind === 'topping' ? 0 : item.isActive === 1 ? 1 : 2)
    return [...items.values()]
      .filter((item) => catalogNameKey(item.name) === key)
      .sort((a, b) => rank(a) - rank(b) || (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.gid.localeCompare(b.gid))[0]
  }
  const toppingKeyOf = (itemGid: string) => {
    const item = items.get(itemGid)
    return item ? catalogNameKey(item.name) : null
  }
  const ownPrice = (item: LegacyMenuItem, price: number) => (price === item.unitPrice ? null : price)

  for (const key of toppingKeys) {
    const after = afterToppings.get(key)
    if (!after) {
      for (const group of active('topping')) {
        if (group.kind !== 'topping' || !group.toppings.some((entry) => toppingKeyOf(entry.itemGid) === key)) continue
        const edited = writable(group)
        if (edited.kind !== 'topping') continue
        edited.toppings = edited.toppings.filter((entry) => toppingKeyOf(entry.itemGid) !== key)
        if (edited.toppings.length === 0) detach(edited.gid)
      }
      continue
    }
    if (beforeToppings.has(key)) {
      for (const group of active('topping')) {
        if (group.kind !== 'topping') continue
        const entry = group.toppings.find((topping) => toppingKeyOf(topping.itemGid) === key)
        const item = entry && items.get(entry.itemGid)
        if (!entry || !item || entry.price === ownPrice(item, after.price)) continue
        const edited = writable(group)
        if (edited.kind !== 'topping') continue
        edited.toppings = edited.toppings.map((topping) =>
          topping.itemGid === item.gid ? { ...topping, price: ownPrice(item, after.price) } : topping,
        )
      }
      continue
    }

    let item = itemForKey(key)
    if (item && item.kind !== 'topping') {
      markToppings.push(item.gid)
      item = { ...item, kind: 'topping' }
      items.set(item.gid, item)
    }
    if (!item) {
      const fixed = deterministicGid(`topping:${key}`)
      const created: NewToppingItem = {
        gid: items.has(fixed) ? input.newGid() : fixed,
        name: after.name,
        unit: '',
        unitPrice: after.price,
        costPrice: null,
        isActive: 0,
        note: '',
        kind: 'topping',
        createdAt: input.now,
        updatedAt: input.now,
      }
      createItems.push(created)
      item = created
      items.set(created.gid, created)
    }
    const entry = { itemGid: item.gid, price: ownPrice(item, after.price) }
    const ownGid = deterministicGid(`toppings:${input.group.gid}`)
    const existingOwn = current(ownGid)
    // Nhóm riêng mà máy mới đã tắt hay gỡ khỏi G là quyết định của chủ quán: không hồi sinh nó (kéo theo cả topping cũ
    // trong đó), mà tạo một nhóm mới chỉ chứa topping máy cũ vừa thêm.
    const own = existingOwn?.isActive === 1 && gids.includes(existingOwn.gid) ? existingOwn : undefined
    if (!own) {
      const created: NewOptionGroup = {
        gid: existingOwn ? input.newGid() : ownGid,
        name: catalogLabel(`Topping ${input.group.name}`),
        kind: 'topping',
        toppings: [entry],
        required: 0,
        maxSelect: null,
        defaultChoice: null,
        sortOrder: sortOrder++,
        isActive: 1,
        createdAt: input.now,
        updatedAt: input.now,
      }
      touched.set(created.gid, { before: null, after: created })
      gids.push(created.gid)
      continue
    }
    const edited = writable(own)
    if (edited.kind !== 'topping') continue
    edited.toppings = edited.toppings.some((topping) => topping.itemGid === item.gid)
      ? edited.toppings.map((topping) => (topping.itemGid === item.gid ? entry : topping))
      : [...edited.toppings, entry]
  }

  for (const key of choiceKeys) {
    const after = afterChoices.get(key)
    const existing = active('choice').filter((group) => catalogNameKey(group.name) === key)
    if (!after) {
      for (const group of existing) detach(group.gid)
      continue
    }
    if (existing[0]) {
      const edited = writable(existing[0])
      if (edited.kind === 'choice') edited.choices = after.choices
      continue
    }
    const created: NewOptionGroup = {
      gid: input.newGid(),
      name: after.name,
      kind: 'choice',
      choices: after.choices,
      required: 0,
      maxSelect: 1,
      defaultChoice: null,
      sortOrder: sortOrder++,
      isActive: 1,
      createdAt: input.now,
      updatedAt: input.now,
    }
    touched.set(created.gid, { before: null, after: created })
    gids.push(created.gid)
  }

  if (gids.length > REFS_MAX) return { status: 'skipped', reason: `Nhóm món “${input.group.name}” gắn quá ${REFS_MAX} nhóm lựa chọn.` }
  const optionGroups: { before: NewOptionGroup | null; after: NewOptionGroup }[] = []
  for (const { before, after } of touched.values()) {
    const parsed = OptionGroupPayloadSchema.safeParse(sanitize(after))
    if (!parsed.success) return { status: 'skipped', reason: `Nhóm lựa chọn “${after.name}” vượt giới hạn của bản mới.` }
    optionGroups.push({ before, after: parsed.data })
  }
  return { status: 'translated', createItems, markToppings, optionGroups, optionGroupGids: gids }
}

/** Máy cũ không biết bắt buộc/mặc định/chọn-nhiều: sửa danh sách xong thì kéo ba trường đó về chỗ hợp lệ. */
function sanitize(group: NewOptionGroup): NewOptionGroup {
  const count = group.kind === 'choice' ? group.choices.length : group.toppings.length
  return {
    ...group,
    maxSelect: group.maxSelect === null ? null : Math.min(group.maxSelect, count),
    defaultChoice: group.kind === 'choice' && group.defaultChoice !== null && group.choices.includes(group.defaultChoice) ? group.defaultChoice : null,
  }
}
