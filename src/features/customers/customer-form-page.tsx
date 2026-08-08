import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useCustomer, useCustomers } from './use-customers'
import { createCustomer, updateCustomer } from '@/db/repositories/customers'
import type { Customer } from '@/domain/schema'
import { Button } from '@/ui/button'
import { ListSkeleton } from '@/ui/empty-state'
import { FormScreen } from '@/ui/form-screen'
import { TextField } from '@/ui/text-field'
import { useSubmitOnce } from '@/ui/use-submit-once'

function CustomerForm({ customer }: { customer: Customer | null }) {
  const navigate = useNavigate()
  const others = (useCustomers() ?? []).filter((row) => row.id !== customer?.id)

  const [name, setName] = useState(customer?.name ?? '')
  const [phone, setPhone] = useState(customer?.phone ?? '')
  const [address, setAddress] = useState(customer?.address ?? '')
  const [note, setNote] = useState(customer?.note ?? '')

  const [nameError, setNameError] = useState<string | undefined>()
  const { submitting: saving, error: saveError, run } = useSubmitOnce('Không lưu được khách hàng. Thử lại.')

  const dirty =
    name !== (customer?.name ?? '') ||
    phone !== (customer?.phone ?? '') ||
    address !== (customer?.address ?? '') ||
    note !== (customer?.note ?? '')

  const trimmedPhone = phone.trim()
  const duplicate = trimmedPhone ? others.find((row) => row.phone.trim() === trimmedPhone) : undefined

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('Nhập tên khách hàng.')
      return
    }
    setNameError(undefined)

    void run(async () => {
      const payload = { name: trimmed, phone: trimmedPhone, address: address.trim(), note: note.trim() }
      const id = customer?.id
      if (id !== undefined) {
        await updateCustomer(id, payload)
        void navigate(`/them/khach-hang/${id}`, { replace: true })
      } else {
        await createCustomer(payload)
        void navigate('/them/khach-hang', { replace: true })
      }
    })
  }

  return (
    <FormScreen
      title={customer ? 'Sửa khách hàng' : 'Thêm khách hàng'}
      error={saveError}
      dirty={dirty && !saving}
      cta={
        <Button size="cta" disabled={saving} onClick={save}>
          {saving ? 'Đang lưu…' : 'LƯU KHÁCH HÀNG'}
        </Button>
      }
    >
      <TextField
        label="Tên khách hàng *"
        value={name}
        autoFocus={!customer}
        onChange={(event) => setName(event.target.value)}
        error={nameError}
        placeholder="Ví dụ: Chị Hoa"
      />

      <TextField
        label="Số điện thoại"
        value={phone}
        inputMode="tel"
        onChange={(event) => setPhone(event.target.value)}
        placeholder="Không bắt buộc"
      />
      {duplicate ? (
        <p className="-mt-3 text-[13px] font-semibold text-warn">
          Số này đang trùng với “{duplicate.name}”. Vẫn lưu được nếu đúng là hai người khác nhau.
        </p>
      ) : null}

      <TextField
        label="Địa chỉ"
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        placeholder="Không bắt buộc"
      />

      <TextField
        label="Ghi chú"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Ví dụ: khách quen, hay ghi sổ"
      />
    </FormScreen>
  )
}

export function CustomerFormPage() {
  const { id } = useParams()
  const customerId = id && id !== 'moi' ? Number(id) : null
  const customer = useCustomer(customerId)

  if (customerId !== null && customer === undefined) {
    return (
      <div className="p-4">
        <ListSkeleton rows={4} />
      </div>
    )
  }

  if (customerId !== null && customer === null) {
    return <p className="p-6 text-muted">Không tìm thấy khách hàng này.</p>
  }

  return <CustomerForm customer={customer ?? null} />
}
