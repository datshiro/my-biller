import { useMemo, useState } from 'react'
import { useCustomers } from '@/features/customers/use-customers'
import { createCustomer } from '@/db/repositories/customers'
import { matchesCustomer } from '@/domain/customer-search'
import { KHACH_LE } from '@/domain/cart'
import { Button } from '@/ui/button'
import { ListRow } from '@/ui/list-row'
import { Sheet } from '@/ui/sheet'
import { SearchInput } from '@/ui/search-input'
import { TextField } from '@/ui/text-field'
import { useSubmitOnce } from '@/ui/use-submit-once'

type Picked = { customerId: number | null; customerName: string }

export function CustomerPickerSheet({
  onPick,
  onClose,
  /** Vì sao đang phải chọn khách — hiện khi mở từ chỗ bán nợ. */
  reason,
}: {
  onPick: (picked: Picked) => void
  onClose: () => void
  reason?: string
}) {
  const customers = useCustomers()
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const { submitting: saving, error, setError, run } = useSubmitOnce('Không lưu được khách.')

  const filtered = useMemo(
    () => (customers ?? []).filter((customer) => matchesCustomer(customer, query)),
    [customers, query],
  )

  const addAndPick = () => {
    const name = newName.trim()
    if (!name) {
      setError('Nhập tên khách.')
      return
    }
    void run(async () => {
      const id = await createCustomer({ name, phone: newPhone.trim(), address: '', note: '' })
      onPick({ customerId: id, customerName: name })
    })
  }

  if (adding) {
    return (
      <Sheet
        title="Thêm khách nhanh"
        onClose={() => setAdding(false)}
        footer={
          <Button size="cta" disabled={saving} onClick={addAndPick}>
            {saving ? 'Đang lưu…' : 'LƯU VÀ CHỌN'}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <TextField
            label="Tên khách *"
            value={newName}
            autoFocus
            onChange={(event) => setNewName(event.target.value)}
            error={error ?? undefined}
          />
          <TextField
            label="Số điện thoại"
            value={newPhone}
            inputMode="tel"
            onChange={(event) => setNewPhone(event.target.value)}
            placeholder="Không bắt buộc"
          />
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet
      title="Chọn khách"
      onClose={onClose}
      footer={
        <Button variant="secondary" size="cta" onClick={() => setAdding(true)}>
          ＋ Thêm khách mới
        </Button>
      }
    >
      {reason ? <p className="mb-3 text-[15px] font-semibold text-warn">{reason}</p> : null}

      <SearchInput value={query} onChange={setQuery} placeholder="Tìm tên hoặc số điện thoại…" />

      <ul className="border-t border-line">
        <li>
          <ListRow title={KHACH_LE} subtitle="Không lưu tên, không ghi nợ được" onClick={() => onPick({ customerId: null, customerName: '' })} />
        </li>
        {filtered.map((customer) => (
          <li key={customer.id}>
            <ListRow
              title={customer.name}
              subtitle={customer.phone.trim() || 'Chưa có SĐT'}
              onClick={() => onPick({ customerId: customer.id ?? null, customerName: customer.name })}
            />
          </li>
        ))}
      </ul>

      {customers && customers.length > 0 && filtered.length === 0 ? (
        <p className="px-4 py-6 text-center text-muted">Không có khách nào khớp “{query.trim()}”.</p>
      ) : null}
    </Sheet>
  )
}
