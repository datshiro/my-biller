import { catalogNameKey } from '@shared/catalog-migration'
import type { Item, ItemGroup, LineTopping, LegacyOptionGroup, OptionGroupRow, ToppingMenuItem } from './schema'

/**
 * Nhóm tuỳ chọn có sẵn cho MỌI món, không phải một hàng thực đơn phải seed và đồng bộ cho từng nhóm món.
 * Hai nhãn đá loại trừ nhau: một ly không thể vừa đá chung vừa đá riêng, muốn cả hai kiểu thì đó là hai dòng.
 */
export const ICE_OPTION_GROUP: LegacyOptionGroup = {
  name: 'Đá',
  choices: ['Đá chung', 'Đá riêng'],
}

/**
 * Một nhóm lựa chọn như màn bán thấy: đã bỏ phần trỏ vào chỗ trống, topping đã mang tên và giá bán kèm.
 * `maxSelect` `null` là không giới hạn — chỉ nhóm topping có; nhóm tuỳ chọn thiếu số là chọn-một.
 */
export type SaleOptionGroup = {
  gid: string
  name: string
  required: boolean
  maxSelect: number | null
} & (
  { kind: 'choice'; choices: string[]; defaultChoice: string | null } | { kind: 'topping'; toppings: ToppingMenuItem[] }
)

export type SaleChoiceGroup = Extract<SaleOptionGroup, { kind: 'choice' }>
export type SaleToppingGroup = Extract<SaleOptionGroup, { kind: 'topping' }>

const ICE_SALE_GROUP: SaleChoiceGroup = {
  gid: 'ice',
  name: ICE_OPTION_GROUP.name,
  kind: 'choice',
  choices: ICE_OPTION_GROUP.choices,
  required: false,
  maxSelect: 1,
  defaultChoice: null,
}

type Catalog = {
  optionGroups: readonly OptionGroupRow[]
  /** Mọi món, kể cả món topping chỉ bán kèm (`isActive: 0`) — giá và tên topping lấy từ đây. */
  items: readonly Pick<Item, 'gid' | 'name' | 'unitPrice' | 'kind'>[]
}

/** Nhóm đang bật trong `gids`, xếp theo `sortOrder` chủ quán đặt; hoà thì theo thứ tự gắn. */
function activeRows(gids: readonly string[], byGid: ReadonlyMap<string, OptionGroupRow>): OptionGroupRow[] {
  return gids
    .map((gid, index) => ({ row: byGid.get(gid), index }))
    .filter((entry): entry is { row: OptionGroupRow; index: number } => entry.row?.isActive === 1)
    .sort((a, b) => a.row.sortOrder - b.row.sortOrder || a.index - b.index)
    .map((entry) => entry.row)
}

/**
 * Nhóm lựa chọn chủ quán gắn cho món, không gồm hằng Đá: nhóm gắn thẳng vào món trước, rồi nhóm gắn vào nhóm món
 * (bỏ gid đã có), mỗi khối theo `sortOrder`. Nhóm tắt hay đã mất bị bỏ; topping trỏ món đã xoá hay không còn là món
 * topping cũng bị bỏ. Hai topping trùng tên thì cái đứng trước giữ chỗ: dòng đơn khoá topping theo tên, và khối nhóm
 * món theo đúng luật phép chiếu cho máy cũ (`projectLegacyMenu`) nên máy cũ và máy mới bán một topping cùng một giá.
 */
export function attachedOptionGroups(
  item: Pick<Item, 'optionGroupGids'> | undefined,
  group: Pick<ItemGroup, 'optionGroupGids'> | undefined,
  catalog: Catalog,
): SaleOptionGroup[] {
  return optionGroupLookup(catalog)(item, group)
}

/** `attachedOptionGroups` với bảng tra dựng một lần cho cả danh mục — màn bán tra cho từng món trên lưới. */
export function optionGroupLookup(
  catalog: Catalog,
): (
  item: Pick<Item, 'optionGroupGids'> | undefined,
  group: Pick<ItemGroup, 'optionGroupGids'> | undefined,
) => SaleOptionGroup[] {
  const byGid = new Map(catalog.optionGroups.map((row) => [row.gid, row]))
  const itemByGid = new Map(catalog.items.map((row) => [row.gid, row]))
  return (item, group) => {
    const own = item?.optionGroupGids ?? []
    const rows = [
      ...activeRows(own, byGid),
      ...activeRows((group?.optionGroupGids ?? []).filter((gid) => !own.includes(gid)), byGid),
    ]

    const seenToppings = new Set<string>()
    return rows.flatMap((row): SaleOptionGroup[] => {
      const base = { gid: row.gid, name: row.name, required: row.required === 1 }
      if (row.kind === 'choice') {
        return [
          { ...base, kind: 'choice', choices: row.choices, maxSelect: row.maxSelect ?? 1, defaultChoice: row.defaultChoice },
        ]
      }
      const toppings = row.toppings.flatMap((entry): ToppingMenuItem[] => {
        const topping = itemByGid.get(entry.itemGid)
        const name = topping?.name.trim()
        if (!topping || topping.kind !== 'topping' || !name || seenToppings.has(catalogNameKey(name))) return []
        seenToppings.add(catalogNameKey(name))
        return [{ name, price: entry.price ?? topping.unitPrice }]
      })
      return toppings.length > 0 ? [{ ...base, kind: 'topping', toppings, maxSelect: row.maxSelect }] : []
    })
  }
}

/** Mọi nhóm của sheet: hằng Đá luôn đứng đầu, kể cả món chưa phân nhóm hay nhóm món không gắn gì. */
export const optionGroupsFor = (...args: Parameters<typeof attachedOptionGroups>): SaleOptionGroup[] =>
  withIce(attachedOptionGroups(...args))

export const withIce = (attached: readonly SaleOptionGroup[]): SaleOptionGroup[] => [ICE_SALE_GROUP, ...attached]

/**
 * Món có nhóm lựa chọn riêng thì chạm vào là mở sheet hỏi. Hằng Đá không tính: tính nó thì món nào chạm vào cũng
 * bật sheet, và Trà đá mất đường một chạm là vào đơn.
 */
export const hasOptions = (groups: readonly SaleOptionGroup[]): boolean =>
  groups.some((group) => group !== ICE_SALE_GROUP)

/** Lựa chọn mặc định của các nhóm, điền sẵn khi mở sheet THÊM. */
export const defaultOptions = (groups: readonly SaleOptionGroup[]): string[] =>
  groups.flatMap((group) => (group.kind === 'choice' && group.defaultChoice !== null ? [group.defaultChoice] : []))

/** Nhóm bắt buộc mà dòng chưa chọn gì trong đó. */
export function isGroupMissing(
  group: SaleOptionGroup,
  options: readonly string[],
  toppings: readonly LineTopping[],
): boolean {
  if (!group.required) return false
  return group.kind === 'choice'
    ? !group.choices.some((choice) => options.includes(choice))
    : !group.toppings.some((item) => toppings.some((topping) => topping.name === item.name))
}

/** Số mục đang chọn trong nhóm: nhãn với nhóm tuỳ chọn, số loại topping (không phải số phần) với nhóm topping. */
export const selectedCount = (
  group: SaleOptionGroup,
  options: readonly string[],
  toppings: readonly LineTopping[],
): number =>
  group.kind === 'choice'
    ? group.choices.filter((choice) => options.includes(choice)).length
    : group.toppings.filter((item) => toppings.some((topping) => topping.name === item.name)).length

/**
 * Bật/tắt một lựa chọn. Nhóm chọn-một: bấm lựa chọn khác thì THAY, bấm lại lựa chọn đang chọn thì gỡ. Nhóm chọn-nhiều
 * (ghi chú nhanh): bấm là thêm hay gỡ đúng mục đó; đủ `maxSelect` rồi thì bấm mục mới không làm gì. Nhãn của nhóm
 * khác giữ nguyên thứ tự.
 */
export function toggleOption(
  options: readonly string[],
  group: Pick<SaleChoiceGroup, 'choices'> & { maxSelect?: number | null },
  choice: string,
): string[] {
  if (options.includes(choice)) return options.filter((option) => option !== choice)
  const max = group.maxSelect ?? 1
  if (max <= 1) return [...options.filter((option) => !group.choices.includes(option)), choice]
  const chosen = group.choices.filter((option) => options.includes(option)).length
  return chosen >= max ? [...options] : [...options, choice]
}

/** Nhãn đã chọn mà thực đơn không còn nhóm nào chứa (nhóm bị xoá, hoặc đơn cũ). Vẫn phải gỡ được. */
export const orphanOptions = (options: readonly string[], groups: readonly SaleOptionGroup[]): string[] =>
  options.filter((option) => !groups.some((group) => group.kind === 'choice' && group.choices.includes(option)))

/**
 * Đặt số phần của một topping trên dòng; 0 là gỡ. Topping đã có trên dòng giữ NGUYÊN giá lúc chọn: sửa giá
 * thực đơn giữa chừng không được làm giá của ly đang lên đơn nhảy theo.
 */
export function setToppingQty(
  toppings: readonly LineTopping[],
  item: ToppingMenuItem,
  qty: number,
): LineTopping[] {
  const existing = toppings.find((topping) => topping.name === item.name)
  const rest = toppings.filter((topping) => topping.name !== item.name)
  if (qty <= 0) return rest
  return [...rest, { name: item.name, unitPrice: existing?.unitPrice ?? item.price, qty }]
}

export const toppingLabel = (topping: Pick<LineTopping, 'name' | 'qty'>): string =>
  topping.qty > 1 ? `${topping.name} x${topping.qty}` : topping.name

/** Tiền của một topping cho MỘT ly (giá lúc bán × số phần) — con số hiện cạnh tên topping trên phiếu. */
export const toppingAmount = (topping: Pick<LineTopping, 'unitPrice' | 'qty'>): number => topping.unitPrice * topping.qty

/**
 * Cụm ghi chú ngăn bằng "dấu phẩy + khoảng trắng", không phải dấu phẩy trần: dấu phẩy trần là dấu thập phân
 * ("thêm 1,5 lạng"), tách ở đó là chẻ đôi chữ người bán tự gõ — chữ in lên tem và phiếu.
 */
const NOTE_SEPARATOR = ','
const phrasesOf = (note: string): string[] =>
  note
    .split(/,\s+/)
    .map((phrase) => phrase.trim())
    .filter(Boolean)
const sameKey = (phrase: string) => phrase.toLocaleLowerCase('vi')

export const hasNotePhrase = (note: string, phrase: string): boolean =>
  phrasesOf(note).some((part) => sameKey(part) === sameKey(phrase))

/**
 * Chip ghi chú chỉ thêm hay gỡ ĐÚNG cụm của nó trong ô ghi chú, chữ người bán tự gõ ở các cụm khác giữ
 * nguyên. Ghi chú vẫn là một chuỗi trên dòng, không có trường thứ hai để tem và phiếu phải đọc thêm.
 */
export function toggleNotePhrase(note: string, phrase: string): string {
  const parts = phrasesOf(note)
  const kept = parts.filter((part) => sameKey(part) !== sameKey(phrase))
  return (kept.length === parts.length ? [...parts, phrase.trim()] : kept).join(`${NOTE_SEPARATOR} `)
}

/**
 * Các cụm ghi chú hay dùng nhất trong những ghi chú cho trước (mới nhất trước). Nhiều lần hơn thì đứng
 * trước, hoà thì cụm dùng gần hơn đứng trước; hiện theo cách viết của lần dùng gần nhất.
 *
 * `exclude` là các lựa chọn đã có chip tuỳ chọn riêng. Bản trước 2.8.0 ghi "Đá riêng" / "Đá chung" thẳng vào
 * ghi chú và không được di trú, nên không lọc thì chip ghi chú "Đá riêng" nằm ngay dưới chip tuỳ chọn cùng
 * chữ — chạm nhầm là lách luật loại trừ của nhóm Đá và dòng không gộp với dòng đá riêng thật.
 *
 * `maxLength` bỏ cụm quá dài: chip không xuống dòng, một lời dặn cả câu thành chip rộng hơn màn 320px và đẩy
 * sheet tràn ngang — mà lời dặn dài như vậy cũng không phải thứ chạm lại nhanh.
 */
export function recentNotePhrases(
  notesNewestFirst: readonly string[],
  limit: number,
  exclude: readonly string[] = [],
  maxLength = Number.POSITIVE_INFINITY,
): string[] {
  const excluded = new Set(exclude.map(sameKey))
  const seen = new Map<string, { label: string; count: number; firstAt: number }>()
  notesNewestFirst.forEach((note, index) => {
    for (const phrase of phrasesOf(note)) {
      if (excluded.has(sameKey(phrase)) || phrase.length > maxLength) continue
      const entry = seen.get(sameKey(phrase))
      if (entry) entry.count += 1
      else seen.set(sameKey(phrase), { label: phrase, count: 1, firstAt: index })
    }
  })
  return [...seen.values()]
    .sort((a, b) => b.count - a.count || a.firstAt - b.firstAt)
    .slice(0, limit)
    .map((entry) => entry.label)
}
