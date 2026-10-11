import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useItemGroups, useItems, useOptionGroups } from '@/features/items/use-items'
import { createOptionGroup, updateOptionGroup, type OptionGroupInput } from '@/db/repositories/option-groups'
import { formatAmount } from '@/domain/money'
import { catalogClash, labelClash, OPTION_GROUP_TEMPLATES, parseChoices, placesUsing } from '@/domain/option-group-rules'
import { OptionGroupRowSchema, type Item, type ItemGroup, type OptionGroupRow } from '@/domain/schema'
import { Button } from '@/ui/button'
import { SelectChip } from '@/ui/chip'
import { ListSkeleton } from '@/ui/empty-state'
import { FormScreen } from '@/ui/form-screen'
import { MoneyInput } from '@/ui/money-input'
import { Field, TextField } from '@/ui/text-field'
import { useSubmitOnce } from '@/ui/use-submit-once'

type Topping = { itemGid: string; price: number | null }

const LIST_PATH = '/them/nhom-lua-chon'
const selectClass =
  'h-12 w-full rounded-btn border border-line bg-surface px-3 text-[17px] outline-none focus:border-brand'

/** Ô số để trống là `null`; gõ chữ hay số âm thì giữ nguyên chuỗi để báo lỗi, không tự sửa. */
function parseLimit(text: string): number | null | 'invalid' {
  if (!text.trim()) return null
  const value = Number(text)
  return Number.isInteger(value) && value >= 1 ? value : 'invalid'
}

function OptionGroupForm({
  group,
  groups,
  items,
  itemGroups,
}: {
  group: OptionGroupRow | null
  groups: OptionGroupRow[]
  items: Item[]
  itemGroups: ItemGroup[]
}) {
  const navigate = useNavigate()
  const [name, setName] = useState(group?.name ?? '')
  const [kind, setKind] = useState<OptionGroupRow['kind']>(group?.kind ?? 'choice')
  const [choicesText, setChoicesText] = useState(group?.kind === 'choice' ? group.choices.join(', ') : '')
  const [defaultChoice, setDefaultChoice] = useState<string | null>(group?.defaultChoice ?? null)
  const [toppings, setToppings] = useState<Topping[]>(group?.kind === 'topping' ? group.toppings : [])
  const [required, setRequired] = useState(group?.required === 1)
  const [limitText, setLimitText] = useState(group?.maxSelect ? String(group.maxSelect) : group ? '' : '1')
  const [sortText, setSortText] = useState(
    String(group?.sortOrder ?? Math.max(0, ...groups.map((row) => row.sortOrder + 1))),
  )
  const [invalid, setInvalid] = useState<string | undefined>()
  const snapshot = JSON.stringify([name, kind, choicesText, defaultChoice, toppings, required, limitText, sortText])
  const [initial] = useState(snapshot)
  const { submitting, error, setError, run } = useSubmitOnce('Không lưu được nhóm lựa chọn. Thử lại.')

  const choices = parseChoices(choicesText)
  const toppingItems = items.filter((item) => item.kind === 'topping').sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
  const places = group ? placesUsing(group.gid, { items, itemGroups }) : []

  const applyTemplate = (index: number) => {
    const template = OPTION_GROUP_TEMPLATES[index]!
    setKind('choice')
    setName(template.name)
    setChoicesText(template.choices.join(', '))
    setLimitText(String(template.maxSelect ?? ''))
    setDefaultChoice(template.defaultChoice)
  }

  const toggleTopping = (itemGid: string) =>
    setToppings(
      toppings.some((topping) => topping.itemGid === itemGid)
        ? toppings.filter((topping) => topping.itemGid !== itemGid)
        : [...toppings, { itemGid, price: null }],
    )

  const buildRow = (isActive: 0 | 1): OptionGroupRow | string => {
    const limit = parseLimit(limitText)
    const sortOrder = Number(sortText)
    if (!name.trim()) return 'Nhập tên nhóm.'
    if (limit === 'invalid') return 'Số chọn tối đa phải là số nguyên từ 1 trở lên.'
    if (!Number.isInteger(sortOrder)) return 'Thứ tự hiển thị phải là số nguyên.'
    if (kind === 'choice' && choices.length === 0) return 'Nhập ít nhất một lựa chọn.'
    if (kind === 'topping' && toppings.length === 0) return 'Chọn ít nhất một món topping.'
    const count = kind === 'choice' ? choices.length : toppings.length
    if (limit !== null && limit > count) return `Chọn tối đa ${limit} mà nhóm chỉ có ${count} mục.`
    const base = {
      ...(group?.id !== undefined ? { id: group.id } : {}),
      gid: group?.gid ?? '00000000-0000-4000-8000-000000000000',
      name: name.trim(),
      required: required ? 1 : 0,
      maxSelect: kind === 'choice' ? (limit ?? 1) : limit,
      defaultChoice: kind === 'choice' && defaultChoice && choices.includes(defaultChoice) ? defaultChoice : null,
      sortOrder,
      isActive,
      createdAt: group?.createdAt ?? 0,
      updatedAt: group?.updatedAt ?? 0,
    }
    const parsed = OptionGroupRowSchema.safeParse(
      kind === 'choice' ? { ...base, kind, choices } : { ...base, kind, toppings },
    )
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = String(issue?.path[0] ?? '')
      if (field === 'name') return 'Tên nhóm dài quá 40 ký tự.'
      if (field === 'choices') return 'Mỗi lựa chọn tối đa 40 ký tự, tối đa 30 lựa chọn.'
      if (field === 'toppings') return 'Nhóm topping tối đa 30 món.'
      return issue?.message ?? 'Nhóm lựa chọn chưa hợp lệ.'
    }
    return parsed.data
  }

  /**
   * Nhãn trùng hằng Đá thì chặn ngay cả khi nhóm chưa gắn đâu (gắn vào món nào cũng trùng); trùng với nhóm khác thì
   * kiểm trên danh mục sau khi áp nhóm này, vì chỉ trùng khi hai nhóm cùng gắn một món.
   */
  const clashAfter = (row: OptionGroupRow) =>
    // Kiểm như thể đang dùng: nhóm lưu trữ sửa xong bị trùng hằng Đá thì "Dùng lại" là một nhóm không gắn được đâu.
    labelClash([{ ...row, isActive: 1 }], items) ??
    (group
      ? catalogClash(
          { optionGroups: groups, items, itemGroups },
          { optionGroups: groups.map((other) => (other.gid === row.gid ? row : other)), items, itemGroups },
        )
      : null)

  const save = () => {
    const row = buildRow(group?.isActive ?? 1)
    if (typeof row === 'string') {
      setInvalid(row)
      return
    }
    const clash = clashAfter(row)
    if (clash) {
      setInvalid(clash)
      return
    }
    setInvalid(undefined)
    void run(async () => {
      const input: Partial<OptionGroupRow> = { ...row }
      for (const key of ['id', 'gid', 'createdAt', 'updatedAt'] as const) delete input[key]
      if (group?.id !== undefined) await updateOptionGroup(group.id, input as OptionGroupInput)
      else await createOptionGroup(input as OptionGroupInput)
      void navigate(LIST_PATH, { replace: true })
    })
  }

  const setArchived = (archived: boolean) => {
    if (!group?.id) return
    setInvalid(undefined)
    const clash = archived ? null : labelClash([{ ...group, isActive: 1 }], items)
    if (clash) {
      setInvalid(clash)
      return
    }
    if (archived && places.length > 0) {
      setError(`Nhóm đang gắn vào ${places.join(', ')}. Gỡ khỏi các chỗ đó trước khi lưu trữ.`)
      return
    }
    void run(async () => {
      await updateOptionGroup(group.id!, { isActive: archived ? 0 : 1 })
      void navigate(LIST_PATH, { replace: true })
    })
  }

  return (
    <FormScreen
      title={group ? 'Sửa nhóm lựa chọn' : 'Thêm nhóm lựa chọn'}
      error={invalid ?? error}
      dirty={snapshot !== initial && !submitting}
      cta={
        <Button size="cta" disabled={submitting} onClick={save}>
          {submitting ? 'Đang lưu…' : 'LƯU NHÓM'}
        </Button>
      }
    >
      {group ? null : (
        <Field label="Bắt đầu từ mẫu">
          <div role="group" aria-label="Mẫu" className="flex flex-wrap gap-2">
            {OPTION_GROUP_TEMPLATES.map((template, index) => (
              <Button key={template.name} variant="secondary" onClick={() => applyTemplate(index)}>
                Mẫu {template.name}
              </Button>
            ))}
          </div>
        </Field>
      )}

      <TextField
        label="Tên nhóm *"
        value={name}
        autoFocus={!group}
        onChange={(event) => setName(event.target.value)}
        placeholder="Ví dụ: Đường, Size, Topping trà sữa"
      />

      {group ? (
        <p className="text-[15px]">Loại: {kind === 'choice' ? 'Tuỳ chọn' : 'Topping'}</p>
      ) : (
        <Field label="Loại">
          <div role="group" aria-label="Loại nhóm" className="flex gap-2">
            <SelectChip selected={kind === 'choice'} onClick={() => setKind('choice')}>
              Tuỳ chọn
            </SelectChip>
            <SelectChip
              selected={kind === 'topping'}
              onClick={() => {
                setKind('topping')
                setLimitText('')
              }}
            >
              Topping
            </SelectChip>
          </div>
        </Field>
      )}

      {kind === 'choice' ? (
        <>
          <TextField
            label="Các lựa chọn *"
            value={choicesText}
            hint="Cách nhau bằng dấu phẩy"
            placeholder="Ít đường, Không đường"
            onChange={(event) => setChoicesText(event.target.value)}
          />
          <TextField
            label="Chọn tối đa"
            value={limitText}
            inputMode="numeric"
            hint="1 là chọn một. Lớn hơn 1 là ghi chú nhanh, chọn được nhiều mục."
            onChange={(event) => setLimitText(event.target.value)}
          />
          <Field label="Lựa chọn mặc định">
            <select
              aria-label="Lựa chọn mặc định"
              value={defaultChoice ?? ''}
              onChange={(event) => setDefaultChoice(event.target.value || null)}
              className={selectClass}
            >
              <option value="">Không chọn sẵn</option>
              {choices.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : (
        <>
          <Field label="Món topping *" hint="Món topping khai ở Mặt hàng: bật “Là topping”.">
            {toppingItems.length === 0 && toppings.length === 0 ? (
              <p className="text-[13px] text-muted">Chưa có món topping nào.</p>
            ) : (
              <div role="group" aria-label="Món topping" className="flex flex-wrap gap-2">
                {toppings
                  .filter((topping) => !toppingItems.some((item) => item.gid === topping.itemGid))
                  .map((topping) => (
                    // Món đã xoá hay không còn là topping (máy khác sửa): vẫn hiện để bỏ được, không thì nhóm không lưu nổi.
                    <SelectChip key={topping.itemGid} selected onClick={() => toggleTopping(topping.itemGid)}>
                      {items.find((item) => item.gid === topping.itemGid)?.name ?? 'Món đã xoá'} · không còn là topping
                    </SelectChip>
                  ))}
                {toppingItems.map((item) => (
                  <SelectChip
                    key={item.gid}
                    selected={toppings.some((topping) => topping.itemGid === item.gid)}
                    onClick={() => toggleTopping(item.gid)}
                  >
                    {item.name} · {formatAmount(item.unitPrice)}
                  </SelectChip>
                ))}
              </div>
            )}
            <div className="mt-2">
              <Button variant="secondary" onClick={() => void navigate('/them/mat-hang/moi')}>
                ＋ Tạo món topping
              </Button>
            </div>
          </Field>
          {toppings.map((topping) => {
            const item = items.find((row) => row.gid === topping.itemGid)
            const label = item?.name ?? 'Món đã xoá'
            return (
              <MoneyInput
                key={topping.itemGid}
                label={`Giá riêng · ${label}`}
                value={topping.price}
                hint="Để trống là lấy giá bán của món."
                onChange={(price) =>
                  setToppings(toppings.map((row) => (row.itemGid === topping.itemGid ? { ...row, price } : row)))
                }
              />
            )
          })}
          <TextField
            label="Tối đa số loại topping"
            value={limitText}
            inputMode="numeric"
            hint="Để trống là không giới hạn. Số phần mỗi loại không giới hạn."
            onChange={(event) => setLimitText(event.target.value)}
          />
        </>
      )}

      <Field label="Bắt buộc">
        <div className="flex">
          <SelectChip selected={required} onClick={() => setRequired(!required)}>
            Bắt buộc chọn
          </SelectChip>
        </div>
      </Field>

      <TextField
        label="Thứ tự hiển thị"
        value={sortText}
        inputMode="numeric"
        hint="Số nhỏ đứng trước trên sheet chọn món."
        onChange={(event) => setSortText(event.target.value)}
      />

      {group ? (
        <div className="flex flex-col gap-2 border-t border-line pt-5">
          <p className="text-[13px] text-muted">
            {places.length > 0 ? `Đang gắn vào ${places.join(', ')}.` : 'Chưa gắn vào món hay nhóm món nào.'}
          </p>
          <Button variant="secondary" disabled={submitting} onClick={() => setArchived(group.isActive === 1)}>
            {group.isActive === 1 ? 'Lưu trữ nhóm này' : 'Dùng lại nhóm này'}
          </Button>
        </div>
      ) : null}
    </FormScreen>
  )
}

export function OptionGroupFormPage() {
  const { id } = useParams()
  const groups = useOptionGroups()
  const items = useItems()
  const itemGroups = useItemGroups()
  if (groups === undefined || items === undefined || itemGroups === undefined) {
    return (
      <div className="p-4">
        <ListSkeleton rows={4} />
      </div>
    )
  }
  const group = id && id !== 'moi' ? (groups.find((row) => row.id === Number(id)) ?? null) : null
  if (id && id !== 'moi' && !group) return <p className="p-6 text-muted">Không tìm thấy nhóm lựa chọn này.</p>
  return <OptionGroupForm key={group?.id ?? 'new'} group={group} groups={groups} items={items} itemGroups={itemGroups} />
}
