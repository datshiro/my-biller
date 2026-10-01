import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getGroup, updateGroup } from '@/db/repositories/items'
import {
  buildMenu,
  toOptionDrafts,
  toToppingDrafts,
  type OptionGroupDraft,
  type ToppingDraft,
} from '@/domain/item-group-menu'
import { ICE_OPTION_GROUP } from '@/domain/line-extras'
import type { ItemGroup } from '@/domain/schema'
import { Button } from '@/ui/button'
import { MoneyInput } from '@/ui/money-input'
import { Sheet } from '@/ui/sheet'
import { TextField } from '@/ui/text-field'
import { useSubmitOnce } from '@/ui/use-submit-once'

function MenuForm({ group, onClose }: { group: ItemGroup; onClose: () => void }) {
  const [optionDrafts, setOptionDrafts] = useState<OptionGroupDraft[]>(() => toOptionDrafts(group.optionGroups))
  const [toppingDrafts, setToppingDrafts] = useState<ToppingDraft[]>(() => toToppingDrafts(group.toppingMenu))
  const [invalid, setInvalid] = useState<string | undefined>()
  const { submitting, error, run } = useSubmitOnce()

  const save = () => {
    const menu = buildMenu(optionDrafts, toppingDrafts)
    if (!menu.ok) {
      setInvalid(menu.error)
      return
    }
    setInvalid(undefined)
    void run(async () => {
      if (group.id === undefined) throw new Error('Nhóm chưa lưu.')
      await updateGroup(group.id, { optionGroups: menu.optionGroups, toppingMenu: menu.toppingMenu })
      onClose()
    })
  }

  const patchOption = (at: number, patch: Partial<OptionGroupDraft>) =>
    setOptionDrafts(optionDrafts.map((draft, i) => (i === at ? { ...draft, ...patch } : draft)))
  const patchTopping = (at: number, patch: Partial<ToppingDraft>) =>
    setToppingDrafts(toppingDrafts.map((draft, i) => (i === at ? { ...draft, ...patch } : draft)))

  return (
    <Sheet
      title={`Tuỳ chọn & topping — ${group.name}`}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {invalid ?? error ? (
            <p role="alert" className="text-[13px] font-semibold text-danger">
              {invalid ?? error}
            </p>
          ) : null}
          <Button size="cta" disabled={submitting} onClick={save}>
            {submitting ? 'Đang lưu…' : 'LƯU'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-3">
          <h3 className="label-xs text-muted">NHÓM TUỲ CHỌN</h3>
          <p className="text-[13px] text-muted">
            Trong mỗi nhóm chỉ chọn được một lựa chọn. Nhóm {ICE_OPTION_GROUP.name} (
            {ICE_OPTION_GROUP.choices.join(' / ')}) đã có sẵn cho mọi món.
          </p>
          {optionDrafts.map((draft, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-btn border border-line p-3">
              <TextField
                label={`Tên nhóm tuỳ chọn ${i + 1}`}
                value={draft.name}
                placeholder="Ví dụ: Đường"
                onChange={(event) => patchOption(i, { name: event.target.value })}
              />
              <TextField
                label={`Các lựa chọn của nhóm ${i + 1}`}
                value={draft.choicesText}
                hint="Cách nhau bằng dấu phẩy"
                placeholder="Ít đường, Không đường, Nhiều đường"
                onChange={(event) => patchOption(i, { choicesText: event.target.value })}
              />
              <Button variant="danger" onClick={() => setOptionDrafts(optionDrafts.filter((_, at) => at !== i))}>
                Xoá nhóm {i + 1}
              </Button>
            </div>
          ))}
          <Button variant="secondary" onClick={() => setOptionDrafts([...optionDrafts, { name: '', choicesText: '' }])}>
            ＋ Thêm nhóm tuỳ chọn
          </Button>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="label-xs text-muted">TOPPING</h3>
          <p className="text-[13px] text-muted">
            Giá cộng thêm cho mỗi phần topping. Đơn đã bán giữ giá lúc bán, đổi giá ở đây không đổi đơn cũ.
          </p>
          {toppingDrafts.map((draft, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-btn border border-line p-3">
              <TextField
                label={`Tên topping ${i + 1}`}
                value={draft.name}
                placeholder="Ví dụ: Trân châu"
                onChange={(event) => patchTopping(i, { name: event.target.value })}
              />
              <MoneyInput
                label={`Giá topping ${i + 1}`}
                value={draft.price}
                quickAdd
                onChange={(price) => patchTopping(i, { price })}
              />
              <Button variant="danger" onClick={() => setToppingDrafts(toppingDrafts.filter((_, at) => at !== i))}>
                Xoá topping {i + 1}
              </Button>
            </div>
          ))}
          <Button variant="secondary" onClick={() => setToppingDrafts([...toppingDrafts, { name: '', price: null }])}>
            ＋ Thêm topping
          </Button>
        </section>
      </div>
    </Sheet>
  )
}

/** Nạp nhóm rồi mới dựng form: form lấy giá trị đầu từ `useState`, nên không được dựng trước khi có dữ liệu. */
export function ItemGroupMenuSheet({ groupId, onClose }: { groupId: number; onClose: () => void }) {
  const group = useLiveQuery(() => getGroup(groupId), [groupId])
  if (!group) return null
  return <MenuForm group={group} onClose={onClose} />
}
