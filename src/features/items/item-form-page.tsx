import { useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { useItem, useItemGroups, useItems, useOptionGroups } from './use-items'
import { createItem, deactivateItem, deleteItem, updateItem } from '@/db/repositories/items'
import { catalogClash } from '@/domain/option-group-rules'
import type { Item } from '@/domain/schema'
import { OptionGroupPicker } from '@/features/settings/option-group-picker'
import { itemNameKey } from '@shared/item-name'
import { Button } from '@/ui/button'
import { SelectChip } from '@/ui/chip'
import { ConfirmDialog } from '@/ui/confirm-dialog'
import { ListSkeleton } from '@/ui/empty-state'
import { FormScreen } from '@/ui/form-screen'
import { MoneyInput } from '@/ui/money-input'
import { Field, TextField } from '@/ui/text-field'
import { useSubmitOnce } from '@/ui/use-submit-once'

const COMMON_UNITS = ['Tô', 'Ly', 'Cái', 'Kg', 'Phần', 'Chai']

/**
 * Tên món người bán vừa gõ ở ô tìm màn Bán hàng rồi mới biết món chưa có — điền sẵn để khỏi gõ lại.
 * `history.state` do trình duyệt giữ và người dùng sửa được, nên soi kiểu chứ không tin sẵn.
 */
function suggestedName(state: unknown): string {
  return state !== null && typeof state === 'object' && 'itemName' in state && typeof state.itemName === 'string'
    ? state.itemName
    : ''
}

function ItemForm({ item }: { item: Item | null }) {
  const navigate = useNavigate()
  const { state } = useLocation()
  const groups = useItemGroups() ?? []
  const allItems = useItems() ?? []
  const loadedOptionGroups = useOptionGroups()
  const optionGroups = loadedOptionGroups ?? []

  // Tên điền sẵn là mốc so, không phải chữ "chưa lưu": người bán chưa gõ gì trên màn này, hỏi lại
  // lúc họ bấm ✕ là hỏi về chữ của chính app.
  const initialName = item?.name ?? suggestedName(state)
  const [name, setName] = useState(initialName)
  const [unitPrice, setUnitPrice] = useState<number | null>(item?.unitPrice ?? null)
  const [costPrice, setCostPrice] = useState<number | null>(item?.costPrice ?? null)
  const [unit, setUnit] = useState(item?.unit ?? '')
  const [groupId, setGroupId] = useState<number | null>(item?.groupId ?? null)
  const [note, setNote] = useState(item?.note ?? '')
  const [customUnit, setCustomUnit] = useState(() => Boolean(item?.unit && !COMMON_UNITS.includes(item.unit)))
  const initialKind = item?.kind ?? 'item'
  const [isTopping, setIsTopping] = useState(initialKind === 'topping')
  // "Bán riêng được" của món topping chính là `isActive`: tắt thì món chỉ bán kèm qua nhóm topping, khỏi lưới bán.
  const [sellAlone, setSellAlone] = useState(item ? item.isActive === 1 : false)
  const initialGids = item?.optionGroupGids ?? []
  const [optionGroupGids, setOptionGroupGids] = useState<string[]>(initialGids)
  // Mốc so chốt lúc mở form: `item` là live query, ghim do máy khác vừa đồng bộ tới không được bị lần lưu này đảo lại.
  const [initialPinned] = useState(() => item?.pinned === 1)
  const [pinned, setPinned] = useState(initialPinned)

  const [errors, setErrors] = useState<{ name?: string; unitPrice?: string }>({})
  const [confirming, setConfirming] = useState(false)
  const { submitting: saving, error: saveError, setError: setSaveError, run } = useSubmitOnce('Không lưu được mặt hàng. Thử lại.')

  // Chỉ xét khi tên đã đổi: món đã trùng tên từ trước khi có luật này vẫn phải sửa được giá.
  const comparableName = name.trim().toLocaleLowerCase('vi')
  const renamed = comparableName !== (item?.name ?? '').trim().toLocaleLowerCase('vi')
  const duplicate =
    comparableName && renamed
      ? allItems.find(
          (other) => other.id !== item?.id && other.name.trim().toLocaleLowerCase('vi') === comparableName,
        )
      : undefined
  const duplicateError = duplicate
    ? `Đã có món “${duplicate.name}”${duplicate.isActive === 1 ? '' : duplicate.kind === 'topping' ? ' (topping chỉ bán kèm)' : ' (đang ngừng bán)'}. Đặt tên khác để phiếu và báo cáo không lẫn hai món.`
    : undefined

  const losing = costPrice !== null && unitPrice !== null && costPrice >= unitPrice
  const dirty =
    name !== initialName ||
    unitPrice !== (item?.unitPrice ?? null) ||
    costPrice !== (item?.costPrice ?? null) ||
    unit !== (item?.unit ?? '') ||
    groupId !== (item?.groupId ?? null) ||
    note !== (item?.note ?? '') ||
    isTopping !== (initialKind === 'topping') ||
    (isTopping && sellAlone !== (item ? item.isActive === 1 : false)) ||
    JSON.stringify(optionGroupGids) !== JSON.stringify(initialGids) ||
    pinned !== initialPinned

  const save = () => {
    const trimmed = name.trim()
    const nextErrors = {
      ...(trimmed ? {} : { name: 'Nhập tên mặt hàng.' }),
      ...(unitPrice === null ? { unitPrice: 'Nhập giá bán.' } : {}),
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0 || unitPrice === null || duplicateError) return

    const problem = catalogProblem()
    if (problem) {
      setSaveError(problem)
      return
    }

    const kind = isTopping ? ('topping' as const) : ('item' as const)
    const isActive = isTopping && !sellAlone ? (0 as const) : (1 as const)
    void run(async () => {
      const payload = { name: trimmed, unitPrice, costPrice, unit: unit.trim(), groupId, note: note.trim() }
      if (item?.id) {
        // Chỉ gửi trường mới khi đang sửa nó: hàng cũ thiếu `kind`/`optionGroupGids` thì để Worker giữ bản đã lưu.
        await updateItem(item.id, {
          ...payload,
          ...(kind !== initialKind ? { kind } : {}),
          ...(isTopping || kind !== initialKind ? { isActive: isTopping ? isActive : item.isActive } : {}),
          ...(JSON.stringify(optionGroupGids) !== JSON.stringify(initialGids) ? { optionGroupGids } : {}),
          // Bỏ ghim ghi `0` tường minh: thiếu khoá là "không biết", Worker sẽ giữ lại ghim đã lưu.
          ...(pinned !== initialPinned ? { pinned: pinned ? (1 as const) : (0 as const) } : {}),
        })
      } else {
        await createItem({ ...payload, isActive, kind, optionGroupGids, pinned: pinned ? 1 : 0 })
      }
      void navigate('/them/mat-hang', { replace: true })
    })
  }

  /** Luật danh mục kiểm ở form, trước khi ghi: món đang nằm trong nhóm topping, nhãn trùng giữa các nhóm gắn cùng món. */
  const catalogProblem = (): string | null => {
    const gid = item?.gid
    if (!isTopping && initialKind === 'topping' && gid) {
      const using = optionGroups.filter(
        (group) => group.kind === 'topping' && group.toppings.some((topping) => topping.itemGid === gid),
      )
      if (using.length > 0) {
        return `Món đang là topping trong nhóm ${using.map((group) => `“${group.name}”`).join(', ')} — gỡ khỏi nhóm trước khi đổi thành món thường.`
      }
    }
    if (isTopping && sellAlone && item && item.isActive !== 1) {
      const key = itemNameKey(name)
      const clash = allItems.find((other) => other.id !== item.id && other.isActive === 1 && itemNameKey(other.name) === key)
      if (clash) return `Đã có món “${clash.name}” đang bán. Đổi tên trước khi cho bán riêng để phiếu và báo cáo không lẫn hai món.`
    }
    const self = { id: item?.id ?? -1, gid: gid ?? '', name: name.trim(), kind: isTopping ? ('topping' as const) : ('item' as const), groupId, optionGroupGids }
    return catalogClash(
      { optionGroups, items: allItems, itemGroups: groups },
      { optionGroups, items: [...allItems.filter((other) => other.id !== item?.id), self], itemGroups: groups },
    )
  }

  const removeItem = () => {
    setConfirming(false)
    void run(async () => {
      if (item?.id) await deleteItem(item.id)
      void navigate('/them/mat-hang', { replace: true })
    })
  }

  const toggleActive = () => {
    if (!item || item.id === undefined) return
    const id = item.id
    const selling = item.isActive === 1
    if (!selling) {
      // Worker (sổ chung) vẫn là chốt cuối khi máy chưa thấy món kia (vd đang mất mạng); chặn
      // sớm ở đây chỉ để không đợi một lượt đồng bộ cho trường hợp máy đã thấy đủ dữ liệu.
      const key = itemNameKey(item.name)
      const clash = allItems.find((other) => other.id !== id && other.isActive === 1 && itemNameKey(other.name) === key)
      if (clash) {
        setSaveError(
          `Đã có món “${clash.name}” đang bán. Đổi tên món này trước khi bán lại để phiếu và báo cáo không lẫn hai món.`,
        )
        return
      }
    }
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
        <Button size="cta" disabled={saving || loadedOptionGroups === undefined} onClick={save}>
          {saving ? 'Đang lưu…' : 'LƯU MẶT HÀNG'}
        </Button>
      }
    >
      <TextField
        label="Tên mặt hàng *"
        value={name}
        autoFocus={!item}
        onChange={(event) => setName(event.target.value)}
        error={errors.name ?? duplicateError}
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

      <Field label="Loại món" hint={isTopping ? 'Món topping bán kèm qua nhóm topping; bật “Bán riêng được” để hiện cả trên lưới bán.' : undefined}>
        <div role="group" aria-label="Loại món" className="flex flex-wrap gap-2">
          <SelectChip selected={isTopping} onClick={() => setIsTopping(!isTopping)}>
            Là topping
          </SelectChip>
          {isTopping ? (
            <SelectChip selected={sellAlone} onClick={() => setSellAlone(!sellAlone)}>
              Bán riêng được
            </SelectChip>
          ) : null}
        </div>
      </Field>

      {/* Topping chỉ bán kèm không lên lưới, ghim nó là bật một công tắc không làm gì. */}
      {isTopping && !sellAlone ? null : (
        <Field label="Màn bán" hint={pinned ? 'Món ghim đứng đầu lưới “Tất cả”, trước món bán chạy.' : undefined}>
          <div role="group" aria-label="Màn bán" className="flex flex-wrap gap-2">
            <SelectChip selected={pinned} onClick={() => setPinned(!pinned)}>
              Ghim lên đầu màn bán
            </SelectChip>
          </div>
        </Field>
      )}

      <OptionGroupPicker
        groups={optionGroups}
        value={optionGroupGids}
        onChange={setOptionGroupGids}
        hint="Gắn thẳng vào món này, cộng với nhóm lựa chọn của nhóm món."
      />

      <TextField
        label="Ghi chú"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Không bắt buộc"
      />

      {item?.id ? (
        <div className="flex flex-col gap-2 border-t border-line pt-5">
          {initialKind === 'topping' ? null : (
            <Button variant="secondary" disabled={saving} onClick={toggleActive}>
              {item.isActive === 1 ? 'Ngừng bán mặt hàng này' : 'Bán lại mặt hàng này'}
            </Button>
          )}
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
