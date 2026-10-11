import type { OptionGroupRow } from '@/domain/schema'
import { SelectChip } from '@/ui/chip'
import { Field } from '@/ui/text-field'

/** Chọn nhóm lựa chọn gắn vào món hoặc nhóm món. Chỉ nhóm đang dùng; thứ tự gắn giữ theo lần chạm. */
export function OptionGroupPicker({
  groups,
  value,
  onChange,
  hint,
  error,
}: {
  groups: readonly OptionGroupRow[]
  value: readonly string[]
  onChange: (gids: string[]) => void
  hint?: string
  error?: string
}) {
  const active = groups.filter((group) => group.isActive === 1 || value.includes(group.gid))
  return (
    <Field label="Nhóm lựa chọn" hint={hint} error={error}>
      {active.length === 0 ? (
        <p className="text-[13px] text-muted">Chưa có nhóm lựa chọn nào. Tạo ở Thêm › Nhóm lựa chọn.</p>
      ) : (
        <div role="group" aria-label="Nhóm lựa chọn" className="flex flex-wrap gap-2">
          {active.map((group) => {
            const selected = value.includes(group.gid)
            return (
              <SelectChip
                key={group.gid}
                selected={selected}
                onClick={() => onChange(selected ? value.filter((gid) => gid !== group.gid) : [...value, group.gid])}
              >
                {group.name}
              </SelectChip>
            )
          })}
        </div>
      )}
    </Field>
  )
}
