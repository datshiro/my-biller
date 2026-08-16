import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useDeviceConnection, useDeviceIdentity } from './use-settings'
import { saveDeviceIdentity } from '@/db/repositories/device-state'
import { Button } from '@/ui/button'
import { ListSkeleton } from '@/ui/empty-state'
import { FormScreen } from '@/ui/form-screen'
import { TextField } from '@/ui/text-field'

type ReturnState = { returnTo?: string }

function DeviceForm() {
  const navigate = useNavigate()
  const location = useLocation()
  const identity = useDeviceIdentity()
  const connection = useDeviceConnection()
  const [label, setLabel] = useState(identity?.label ?? '')
  const [letter, setLetter] = useState(identity?.letter ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (identity === undefined || connection === undefined) {
    return (
      <div className="p-4">
        <ListSkeleton rows={3} />
      </div>
    )
  }

  if (connection) {
    return (
      <FormScreen
        title="Tên máy bán hàng"
        cta={
          <Button size="cta" onClick={() => void navigate(-1)}>
            XONG
          </Button>
        }
      >
        <p className="text-[15px] font-semibold">
          {identity?.label} · chữ {identity?.letter}
        </p>
        <p className="mt-2 text-[13px] text-muted">
          Máy đã ghép phải giữ nguyên tên và chữ cái để mã phiếu và danh tính trên sổ chung không
          đổi. Muốn đổi, hãy thu hồi máy rồi ghép lại.
        </p>
      </FormScreen>
    )
  }

  const normalizedLetter = letter.trim().toUpperCase()
  const valid = label.trim().length > 0 && /^[A-Z]$/.test(normalizedLetter)
  const dirty = label !== (identity?.label ?? '') || normalizedLetter !== (identity?.letter ?? '')

  const save = async () => {
    if (!valid) return
    setSaving(true)
    setError(null)
    try {
      await saveDeviceIdentity({ label: label.trim(), letter: normalizedLetter })
      const returnTo = (location.state as ReturnState | null)?.returnTo
      if (returnTo) void navigate(returnTo, { replace: true })
      else void navigate(-1)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không lưu được. Thử lại.')
      setSaving(false)
    }
  }

  return (
    <FormScreen
      title="Tên máy bán hàng"
      error={error}
      dirty={dirty && !saving}
      cta={
        <Button size="cta" disabled={!valid || saving} onClick={() => void save()}>
          {saving ? 'Đang lưu…' : 'LƯU TÊN MÁY'}
        </Button>
      }
    >
      <p className="text-[13px] text-muted">
        Mỗi máy dùng một chữ cái khác nhau để mã phiếu không trùng. Ví dụ: quầy trước là A, quầy
        sau là B.
      </p>
      <TextField
        label="Tên dễ nhận ra"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        placeholder="Ví dụ: Quầy trước"
        autoFocus
      />
      <TextField
        label="Chữ cái của máy"
        value={letter}
        onChange={(event) => setLetter(event.target.value.slice(0, 1).toUpperCase())}
        placeholder="A"
        maxLength={1}
        autoCapitalize="characters"
        hint="Chọn A–Z và không dùng lại chữ cái của máy khác."
        error={letter.length > 0 && !/^[A-Z]$/i.test(letter) ? 'Chỉ nhập một chữ cái từ A đến Z.' : undefined}
      />
    </FormScreen>
  )
}

export function DeviceSetupPage() {
  return <DeviceForm />
}
