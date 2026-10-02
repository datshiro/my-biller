import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useDeviceConnection, useDeviceIdentity } from './use-settings'
import { saveDeviceIdentity } from '@/db/repositories/device-state'
import type { DeviceIdentity } from '@/domain/schema'
import { Button } from '@/ui/button'
import { ListSkeleton } from '@/ui/empty-state'
import { FormScreen } from '@/ui/form-screen'
import { TextField } from '@/ui/text-field'

type ReturnState = { returnTo?: string }

// `useState` chỉ lấy giá trị đầu ở lần render đầu, nên form chỉ được dựng khi `identity` đã đọc
// xong — dựng lúc `useLiveQuery` còn `undefined` là máy đã có tên vẫn mở ra hai ô trống.
function DeviceForm({ identity }: { identity: DeviceIdentity | null }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [label, setLabel] = useState(identity?.label ?? '')
  const [letter, setLetter] = useState(identity?.letter ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

function PairedIdentity({ identity }: { identity: DeviceIdentity | null }) {
  const navigate = useNavigate()
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

export function DeviceSetupPage() {
  const identity = useDeviceIdentity()
  const connection = useDeviceConnection()

  if (identity === undefined || connection === undefined) {
    return (
      <div className="p-4">
        <ListSkeleton rows={3} />
      </div>
    )
  }

  if (connection) return <PairedIdentity identity={identity} />

  return <DeviceForm identity={identity} />
}
