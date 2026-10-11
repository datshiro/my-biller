import { useState } from 'react'
import { useItemGroups, useItems, useOptionGroups } from '@/features/items/use-items'
import { updateGroup } from '@/db/repositories/items'
import { catalogClash } from '@/domain/option-group-rules'
import type { Item, ItemGroup, OptionGroupRow } from '@/domain/schema'
import { Button } from '@/ui/button'
import { Sheet } from '@/ui/sheet'
import { useSubmitOnce } from '@/ui/use-submit-once'
import { OptionGroupPicker } from './option-group-picker'

function OptionForm({
  group,
  itemGroups,
  items,
  optionGroups,
  onClose,
}: {
  group: ItemGroup
  itemGroups: ItemGroup[]
  items: Item[]
  optionGroups: OptionGroupRow[]
  onClose: () => void
}) {
  const [gids, setGids] = useState<string[]>(group.optionGroupGids ?? [])
  const [invalid, setInvalid] = useState<string | undefined>()
  const { submitting, error, run } = useSubmitOnce()

  const save = () => {
    if (JSON.stringify(gids) === JSON.stringify(group.optionGroupGids ?? [])) {
      onClose()
      return
    }
    // Nhóm gắn vào nhóm món tới mọi món trong nhóm: kiểm nhãn trùng trên từng món, cộng với nhóm gắn thẳng vào món.
    const clash = catalogClash(
      { optionGroups, items, itemGroups },
      {
        optionGroups,
        items,
        itemGroups: itemGroups.map((row) => (row.id === group.id ? { ...row, optionGroupGids: gids } : row)),
      },
    )
    if (clash) {
      setInvalid(clash)
      return
    }
    setInvalid(undefined)
    void run(async () => {
      if (group.id === undefined) throw new Error('Nhóm chưa lưu.')
      await updateGroup(group.id, { optionGroupGids: gids })
      onClose()
    })
  }

  return (
    <Sheet
      title={`Nhóm lựa chọn — ${group.name}`}
      onClose={onClose}
      busy={submitting}
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
      <OptionGroupPicker
        groups={optionGroups}
        value={gids}
        onChange={setGids}
        hint="Mọi món trong nhóm này nhận các nhóm lựa chọn đã chọn. Đá chung / Đá riêng có sẵn cho mọi món."
      />
    </Sheet>
  )
}

/** Gắn nhóm lựa chọn dùng chung vào một nhóm món. Nhóm món giờ chỉ để chia tab và gắn nhóm, không giữ thực đơn riêng. */
export function ItemGroupOptionSheet({ groupId, onClose }: { groupId: number; onClose: () => void }) {
  const itemGroups = useItemGroups()
  const items = useItems()
  const optionGroups = useOptionGroups()
  const group = itemGroups?.find((row) => row.id === groupId)
  if (!itemGroups || !items || !optionGroups || !group) return null
  return <OptionForm group={group} itemGroups={itemGroups} items={items} optionGroups={optionGroups} onClose={onClose} />
}
