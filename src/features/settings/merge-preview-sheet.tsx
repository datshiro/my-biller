import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { previewMerge, type PaymentChoice, type PaymentConflict } from '@/domain/backup-merge'
import { formatVnd } from '@/domain/money'
import type { BackupData, Payment } from '@/domain/schema'
import { Button } from '@/ui/button'
import { Sheet } from '@/ui/sheet'

const OPTIONS: { value: PaymentChoice; label: string }[] = [
  { value: 'device', label: 'Giữ bản trên máy' },
  { value: 'file', label: 'Lấy bản trong file' },
  { value: 'append', label: 'Thêm riêng' },
]

const FIELD_LABEL: Partial<Record<keyof Payment, string>> = {
  amount: 'Số tiền',
  method: 'Hình thức',
  paidAt: 'Ngày thu',
  note: 'Ghi chú',
  unallocatedStatus: 'Trạng thái',
  resolutionNote: 'Ghi chú xử lý',
  allocatedOrderId: 'Trừ vào đơn',
  customerId: 'Khách',
  orderId: 'Thu tại đơn',
}

const STATUS_LABEL = { pending: 'Chưa xử lý', refunded: 'Đã trả lại khách', discarded: 'Đã bỏ (có ghi vết)' }

const NAME_LIMIT = 10

type Side = { orders: Map<number, string>; customers: Map<number, string> }

const sideOf = (data: BackupData): Side => ({
  orders: new Map(data.orders.map((order) => [order.id, order.code])),
  customers: new Map(data.customers.map((customer) => [customer.id, customer.name])),
})

function describeField(field: keyof Payment, payment: Payment, side: Side): string {
  switch (field) {
    case 'amount':
      return formatVnd(payment.amount)
    case 'method':
      return payment.method === 'cash' ? 'Tiền mặt' : 'Chuyển khoản'
    case 'paidAt':
      return format(payment.paidAt, 'dd/MM/yyyy HH:mm')
    case 'unallocatedStatus':
      return STATUS_LABEL[payment.unallocatedStatus ?? 'pending']
    case 'resolutionNote':
      return payment.resolutionNote || '(trống)'
    case 'note':
      return payment.note || '(trống)'
    case 'allocatedOrderId':
      return payment.allocatedOrderId === 0 ? 'chưa trừ đơn nào' : side.orders.get(payment.allocatedOrderId) ?? 'đơn không rõ'
    case 'orderId':
      return side.orders.get(payment.orderId) ?? 'đơn không rõ'
    case 'customerId':
      return payment.customerId === null ? 'không gắn khách' : side.customers.get(payment.customerId) ?? 'khách không rõ'
    default:
      return String(payment[field])
  }
}

/**
 * Xem trước Gộp. Mọi con số tính lại từ `previewMerge` cho **đúng bộ lựa chọn đang có** mỗi lần người bán đổi
 * một lựa chọn — không bao giờ giả định các xung đột khác là "Giữ bản trên máy". Không chọn sẵn gì: GỘP khoá
 * tới khi mọi xung đột có câu trả lời và sổ sau gộp lành.
 */
export function MergePreviewSheet({
  current,
  incoming,
  choices,
  fallbackLetter,
  notice,
  busy,
  onChoose,
  onMerge,
  onClose,
}: {
  current: BackupData
  incoming: BackupData
  choices: Readonly<Partial<Record<string, PaymentChoice>>>
  fallbackLetter: string
  notice: string | null
  busy: boolean
  onChoose: (gid: string, choice: PaymentChoice) => void
  onMerge: (fingerprints: string[]) => void
  onClose: () => void
}) {
  const [showAllNames, setShowAllNames] = useState(false)
  const preview = useMemo(
    () => previewMerge(current, incoming, choices, fallbackLetter),
    [current, incoming, choices, fallbackLetter],
  )
  const deviceSide = useMemo(() => sideOf(current), [current])
  const fileSide = useMemo(() => sideOf(incoming), [incoming])
  const nameByGid = useMemo(
    () => new Map([...incoming.customers, ...current.customers].map((customer) => [customer.gid, customer.name])),
    [current, incoming],
  )
  const customerName = (gid: string) => nameByGid.get(gid) ?? 'khách không rõ'

  const canMerge =
    preview.blocked === null && preview.complete && preview.integrity === null && !busy

  return (
    <Sheet
      title="Gộp file vào sổ trên máy"
      onClose={onClose}
      footer={
        <Button
          size="cta"
          disabled={!canMerge}
          onClick={() => {
            if (preview.blocked === null && canMerge) onMerge(preview.conflicts.map((conflict) => conflict.fingerprint))
          }}
        >
          {busy ? 'Đang xử lý…' : 'GỘP'}
        </Button>
      }
    >
      {notice ? (
        <p role="alert" className="mb-3 rounded-btn bg-danger-tint px-3 py-2 text-[13px] font-semibold text-danger">
          {notice}
        </p>
      ) : null}

      {preview.blocked !== null ? (
        <p role="alert" className="rounded-btn bg-danger-tint px-3 py-2 text-[13px] font-semibold text-danger">
          Sổ trên máy đang có chỗ hỏng: {preview.blocked} — lần này chỉ Ghi đè được.
        </p>
      ) : (
        <MergeBody
          preview={preview}
          choices={choices}
          deviceSide={deviceSide}
          fileSide={fileSide}
          customerName={customerName}
          showAllNames={showAllNames}
          onShowAllNames={() => setShowAllNames(true)}
          onChoose={onChoose}
        />
      )}
    </Sheet>
  )
}

type Preview = Exclude<ReturnType<typeof previewMerge>, { blocked: string }>

function MergeBody({
  preview,
  choices,
  deviceSide,
  fileSide,
  customerName,
  showAllNames,
  onShowAllNames,
  onChoose,
}: {
  preview: Preview
  choices: Readonly<Partial<Record<string, PaymentChoice>>>
  deviceSide: Side
  fileSide: Side
  customerName: (gid: string) => string
  showAllNames: boolean
  onShowAllNames: () => void
  onChoose: (gid: string, choice: PaymentChoice) => void
}) {
  const { summary, totals, willAdd } = preview
  const unanswered = preview.conflicts.filter((conflict) => choices[conflict.gid] === undefined).length
  const updated = Object.values(summary.updated).reduce((sum, count) => sum + count, 0)
  const nameGroups = (
    [
      ['Mặt hàng', willAdd.items],
      ['Khách', willAdd.customers],
      ['Nhóm mặt hàng', willAdd.itemGroups],
      ['Loại chi phí', willAdd.expenseCategories],
    ] as const
  ).filter(([, names]) => names.length > 0)
  const nameCount = nameGroups.reduce((sum, [, names]) => sum + names.length, 0)
  let budget = showAllNames ? Number.POSITIVE_INFINITY : NAME_LIMIT

  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <section>
        <p>
          Đã thu: hiện {formatVnd(totals.collected.now)} → sau gộp {formatVnd(totals.collected.after)}
        </p>
        <p>
          Tổng nợ: hiện {formatVnd(totals.debtTotal.now)} → sau gộp {formatVnd(totals.debtTotal.after)}
        </p>
        {totals.overpaidOrders > 0 ? (
          <p className="mt-2 rounded-btn bg-warn-tint px-3 py-2 font-semibold text-warn">
            {totals.overpaidOrders} đơn sẽ có tiền thu vượt tổng đơn — có thể cùng một lần trả đã được ghi ở cả
            máy lẫn file dưới hai mã khác nhau. Xem lại trước khi gộp.
          </p>
        ) : null}
        <p className="mt-2 text-muted">
          Thêm {summary.added.orders} đơn, {summary.added.customers} khách, {summary.added.items} mặt hàng,{' '}
          {summary.added.payments} khoản thu, {summary.added.expenses} khoản chi; cập nhật {updated} dòng vì bản
          trong file mới hơn; không xoá gì.
          {summary.codeChanges.length > 0
            ? ` ${summary.codeChanges.length} đơn trong file sẽ được cấp mã mới vì trùng mã trên máy.`
            : ''}
        </p>
      </section>

      {Object.keys(preview.debtByCustomer).length > 0 ? (
        <section>
          <h3 className="label-xs text-muted">NỢ SAU GỘP</h3>
          {Object.entries(preview.debtByCustomer).map(([gid, debt]) => (
            <p key={gid} className="mt-1 font-semibold">
              {customerName(gid)}: hiện {formatVnd(debt.now)} → sau gộp {formatVnd(debt.after)}
            </p>
          ))}
          {unanswered > 0 ? (
            <p className="mt-1 text-muted">
              (tạm tính — còn {unanswered} xung đột chưa chọn, đang tính như Giữ bản trên máy)
            </p>
          ) : null}
        </section>
      ) : null}

      {preview.conflicts.map((conflict) => (
        <ConflictCard
          key={conflict.gid}
          conflict={conflict}
          choice={choices[conflict.gid]}
          effects={preview.optionEffects[conflict.gid]!}
          losesExcess={preview.appendLosesExcess[conflict.gid] === true}
          deviceSide={deviceSide}
          fileSide={fileSide}
          customerName={customerName}
          onChoose={onChoose}
        />
      ))}

      {preview.integrity !== null ? (
        <p role="alert" className="rounded-btn bg-danger-tint px-3 py-2 font-semibold text-danger">
          Lựa chọn hiện tại làm sổ hỏng: {preview.integrity}. Đổi lựa chọn khác.
        </p>
      ) : null}

      {nameCount > 0 || willAdd.orders + willAdd.payments + willAdd.expenses > 0 ? (
        <section>
          <h3 className="label-xs text-muted">Sẽ thêm vào máy — có thể gồm thứ bạn đã xoá sau lần sao lưu này</h3>
          {nameGroups.map(([label, names]) => {
            const shown = names.slice(0, Math.max(0, budget))
            budget -= shown.length
            return shown.length > 0 ? (
              <p key={label} className="mt-1">
                {label}: {shown.join(', ')}
              </p>
            ) : null
          })}
          {!showAllNames && nameCount > NAME_LIMIT ? (
            <Button variant="secondary" className="mt-2" onClick={onShowAllNames}>
              Xem hết {nameCount} tên
            </Button>
          ) : null}
          <p className="mt-1 text-muted">
            {willAdd.orders} đơn · {willAdd.payments} khoản thu · {willAdd.expenses} khoản chi
          </p>
        </section>
      ) : null}
    </div>
  )
}

function ConflictCard({
  conflict,
  choice,
  effects,
  losesExcess,
  deviceSide,
  fileSide,
  customerName,
  onChoose,
}: {
  conflict: PaymentConflict
  choice: PaymentChoice | undefined
  effects: Preview['optionEffects'][string]
  losesExcess: boolean
  deviceSide: Side
  fileSide: Side
  customerName: (gid: string) => string
  onChoose: (gid: string, choice: PaymentChoice) => void
}) {
  const { device, file } = conflict
  const appendGain = effects.append.collected - effects.device.collected

  return (
    <fieldset data-conflict-gid={conflict.gid} className="rounded-card border border-line p-3">
      <legend className="px-1 font-semibold">
        Khoản thu {formatVnd(device.amount)} · {format(device.paidAt, 'dd/MM/yyyy')} ·{' '}
        {conflict.customerGid === null ? 'không gắn khách' : customerName(conflict.customerGid)}
      </legend>
      <ul className="text-muted">
        {conflict.changed.map((field) => (
          <li key={field}>
            {FIELD_LABEL[field] ?? field} — Trên máy: {describeField(field, device, deviceSide)} · Trong file:{' '}
            {describeField(field, file, fileSide)}
          </li>
        ))}
      </ul>
      {OPTIONS.map((option) => {
        const effect = effects[option.value]
        const debts = Object.entries(effect.debtByCustomer)
        return (
          <div key={option.value} className="mt-2">
            <label className="flex items-center gap-2 font-semibold">
              <input
                type="radio"
                name={`xung-dot-${conflict.gid}`}
                checked={choice === option.value}
                onChange={() => onChoose(conflict.gid, option.value)}
              />
              {option.label}
            </label>
            <div className="ml-6 text-muted">
              {debts.length > 0
                ? debts.map(([gid, debt]) => (
                    <p key={gid}>
                      Chọn cái này thì nợ {customerName(gid)} sau gộp: {formatVnd(debt)}
                    </p>
                  ))
                : <p>Chọn cái này thì Đã thu sau gộp: {formatVnd(effect.collected)}</p>}
              {option.value === 'append' ? (
                <>
                  <p>
                    Thêm khoản thu trong file thành một khoản mới. Có thể tính tiền hai lần.
                    {appendGain > 0 ? ` Đã thu tăng thêm ${formatVnd(appendGain)}.` : ''}
                  </p>
                  {losesExcess ? (
                    <p>
                      Khoản này đã trừ vào đơn {conflict.fileAllocatedOrderCode ?? 'trong file'}. Thêm riêng làm đơn thu
                      dư; phần dư không thành tiền dư của khách mà mất khỏi công nợ.
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        )
      })}
    </fieldset>
  )
}
