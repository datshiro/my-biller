import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useItem, useItemGroups } from './use-items'
import { createItem, deactivateItem, deleteItem, updateItem } from '@/db/repositories/items'
import type { Item } from '@/domain/schema'
import { Button } from '@/ui/button'
import { SelectChip } from '@/ui/chip'
import { ConfirmDialog } from '@/ui/confirm-dialog'
import { ListSkeleton } from '@/ui/empty-state'
import { FormScreen } from '@/ui/form-screen'
import { MoneyInput } from '@/ui/money-input'
import { Field, TextField } from '@/ui/text-field'
import { useSubmitOnce } from '@/ui/use-submit-once'

const COMMON_UNITS = ['Tô', 'Ly', 'Cái', 'Kg', 'Phần', 'Chai']

function ItemForm({ item }: { item: Item | null }) {
  const navigate = useNavigate()
  const groups = useItemGroups() ?? []

  const [name, setName] = useState(item?.name ?? '')
  const [unitPrice, setUnitPrice] = useState<number | null>(item?.unitPrice ?? null)
  const [costPrice, setCostPrice] = useState<number | null>(item?.costPrice ?? null)
  const [unit, setUnit] = useState(item?.unit ?? '')
  const [groupId, setGroupId] = useState<number | null>(item?.groupId ?? null)
  const [note, setNote] = useState(item?.note ?? '')
  const [customUnit, setCustomUnit] = useState(() => Boolean(item?.unit && !COMMON_UNITS.includes(item.unit)))

  const [errors, setErrors] = useState<{ name?: string; unitPrice?: string }>({})
  const [confirming, setConfirming] = useState(false)
  const { submitting: saving, error: saveError, run } = useSubmitOnce('Không lưu được mặt hàng. Thử lại.')

  const losing = costPrice !== null && unitPrice !== null && costPrice >= unitPrice
  const dirty =
    name !== (item?.name ?? '') ||
    unitPrice !== (item?.unitPrice ?? null) ||
    costPrice !== (item?.costPrice ?? null) ||
    unit !== (item?.unit ?? '') ||
    groupId !== (item?.groupId ?? null) ||
    note !== (item?.note ?? '')

  const save = () => {
    const trimmed = name.trim()
    const nextErrors = {
      ...(trimmed ? {} : { name: 'Nhập tên mặt hàng.' }),
      ...(unitPrice === null ? { unitPrice: 'Nhập giá bán.' } : {}),
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0 || unitPrice === null) return

    void run(async () => {
      const payload = { name: trimmed, unitPrice, costPrice, unit: unit.trim(), groupId, note: note.trim() }
      if (item?.id) {
        await updateItem(item.id, payload)
      } else {
        await createItem({ ...payload, isActive: 1 })
      }
      void navigate('/them/mat-hang', { replace: true })
    })
  }

  const removeItem = () => {
    setConfirming(false)
    void run(async () => {
      if (item?.id) await deleteItem(item.id)
      void navigate('/them/mat-hang', { replace: true })
    })
  }

  const toggleActive = () => {
    const id = item?.id
    if (id === undefined) return
    const selling = item?.isActive === 1
    void run(async () => {
      await (selling ? deactivateItem(id) : updateItem(id, { isActive: 1 }))
      void navigate('/them/mat-hang', { replace: true })
    })
  }

  return (
    <FormScreen
      title={item ? 'Sửa mặt hàng' : 'Thêm mặt hàng'}
      error={saveError}
      dirty={dirty && !saving}
      cta={
        <Button size="cta" disabled={saving} onClick={save}>
          {saving ? 'Đang lưu…' : 'LƯU MẶT HÀNG'}
        </Button>
      }
    >
      <TextField
        label="Tên mặt hàng *"
        value={name}
        autoFocus={!item}
        onChange={(event) => setName(event.target.value)}
        error={errors.name}
        placeholder="Ví dụ: Phở bò đặc biệt"
      />

      <MoneyInput
        label="Giá bán *"
        value={unitPrice}
        onChange={setUnitPrice}
        error={errors.unitPrice}
        large
        quickAdd
      />

      <MoneyInput
        label="Giá nhập (tuỳ chọn)"
        value={costPrice}
        onChange={setCostPrice}
        hint="Để trống nếu không theo dõi lãi. Báo cáo sẽ chỉ ra doanh thu."
        warning={losing ? 'Giá nhập đang cao hơn hoặc bằng giá bán — bán món này đang lỗ.' : undefined}
      />

      <Field label="Đơn vị">
        <div role="group" aria-label="Đơn vị" className="flex flex-wrap gap-2">
          {COMMON_UNITS.map((option) => (
            <SelectChip
              key={option}
              selected={!customUnit && unit === option}
              onClick={() => {
                setCustomUnit(false)
                setUnit(unit === option ? '' : option)
              }}
            >
              {option}
            </SelectChip>
          ))}
          <SelectChip selected={customUnit} onClick={() => setCustomUnit(!customUnit)}>
            Khác…
          </SelectChip>
        </div>
        {customUnit ? (
          <input
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            placeholder="Đơn vị tự đặt, ví dụ: Bó"
            aria-label="Đơn vị tự đặt"
            className="mt-2 h-12 w-full rounded-btn border border-line bg-surface px-3 text-[17px] outline-none focus:border-brand"
          />
        ) : null}
      </Field>

      {groups.length > 0 ? (
        <Field label="Nhóm">
          <select
            aria-label="Nhóm"
            value={groupId ?? ''}
            onChange={(event) => setGroupId(event.target.value ? Number(event.target.value) : null)}
            className="h-12 w-full rounded-btn border border-line bg-surface px-3 text-[17px] outline-none focus:border-brand"
          >
            <option value="">Không nhóm</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <TextField
        label="Ghi chú"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Không bắt buộc"
      />

      {item?.id ? (
        <div className="flex flex-col gap-2 border-t border-line pt-5">
          <Button variant="secondary" disabled={saving} onClick={toggleActive}>
            {item.isActive === 1 ? 'Ngừng bán mặt hàng này' : 'Bán lại mặt hàng này'}
          </Button>
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Xoá hẳn
          </Button>
          <p className="text-[13px] text-muted">
            Mặt hàng đã từng bán thì không xoá được — phiếu cũ vẫn cần tên và giá lúc bán. Hãy dùng “Ngừng bán”.
          </p>
        </div>
      ) : null}

      {confirming ? (
        <ConfirmDialog
          title="Xoá mặt hàng?"
          message={`“${item?.name}” sẽ bị xoá khỏi danh mục. Không hoàn tác được.`}
          confirmLabel="Xoá"
          onConfirm={removeItem}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </FormScreen>
  )
}

export function ItemFormPage() {
  const { id } = useParams()
  const itemId = id && id !== 'moi' ? Number(id) : null
  const item = useItem(itemId)

  // Form khởi tạo state từ props nên chỉ được dựng khi dữ liệu đã về, tránh phải đồng bộ lại bằng effect.
  if (itemId !== null && item === undefined) {
    return (
      <div className="p-4">
        <ListSkeleton rows={4} />
      </div>
    )
  }

  if (itemId !== null && item === null) {
    return <p className="p-6 text-muted">Không tìm thấy mặt hàng này.</p>
  }

  return <ItemForm item={item ?? null} />
}
