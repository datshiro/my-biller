import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useShop } from './use-settings'
import { saveShop } from '@/db/repositories/settings'
import type { ShopSettings } from '@/domain/schema'
import { Button } from '@/ui/button'
import { ListSkeleton } from '@/ui/empty-state'
import { FormScreen } from '@/ui/form-screen'
import { TextField } from '@/ui/text-field'

/** Đúng phần đầu và chân của phiếu thật, thu nhỏ — người bán thấy ngay chỗ mình vừa gõ hiện ở đâu. */
function ReceiptPreview({ shop }: { shop: ShopSettings }) {
  return (
    <div className="rounded-card border border-line bg-surface p-3 text-center">
      <p className="text-[15px] font-bold">{shop.name.trim() || 'TÊN CỬA HÀNG'}</p>
      {shop.address.trim() ? <p className="text-[12px] text-muted">{shop.address}</p> : null}
      {shop.phone.trim() ? <p className="text-[12px] text-muted">ĐT: {shop.phone}</p> : null}
      <p className="my-2 border-t border-dashed border-line" />
      <p className="text-[12px] text-muted">PHIẾU BÁN HÀNG · … · …</p>
      <p className="my-2 border-t border-dashed border-line" />
      <p className="text-[12px] text-muted">{shop.footerNote.trim() || '(không có lời cuối phiếu)'}</p>
    </div>
  )
}

function ShopForm({ shop }: { shop: ShopSettings }) {
  const navigate = useNavigate()
  const [draft, setDraft] = useState(shop)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (patch: Partial<ShopSettings>) => setDraft((current) => ({ ...current, ...patch }))

  const dirty = (Object.keys(shop) as (keyof ShopSettings)[]).some((key) => draft[key] !== shop[key])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await saveShop({
        name: draft.name.trim(),
        phone: draft.phone.trim(),
        address: draft.address.trim(),
        footerNote: draft.footerNote.trim(),
      })
      void navigate(-1)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không lưu được. Thử lại.')
      setSaving(false)
    }
  }

  return (
    <FormScreen
      title="Thông tin cửa hàng"
      error={error}
      dirty={dirty && !saving}
      cta={
        <Button size="cta" disabled={saving} onClick={() => void save()}>
          {saving ? 'Đang lưu…' : 'LƯU THÔNG TIN'}
        </Button>
      }
    >
      <p className="text-[13px] text-muted">Những dòng này in trên mọi phiếu bán hàng gửi khách.</p>

      <TextField
        label="Tên cửa hàng"
        value={draft.name}
        onChange={(event) => set({ name: event.target.value })}
        placeholder="Ví dụ: Tạp hoá Cô Ba"
      />
      <TextField
        label="Số điện thoại"
        value={draft.phone}
        inputMode="tel"
        onChange={(event) => set({ phone: event.target.value })}
        placeholder="Không bắt buộc"
      />
      <TextField
        label="Địa chỉ"
        value={draft.address}
        onChange={(event) => set({ address: event.target.value })}
        placeholder="Không bắt buộc"
      />
      <TextField
        label="Lời cuối phiếu"
        value={draft.footerNote}
        onChange={(event) => set({ footerNote: event.target.value })}
        placeholder="Ví dụ: Cảm ơn quý khách!"
      />

      <div>
        <p className="label-xs mb-1.5 text-muted">PHIẾU SẼ TRÔNG NHƯ THẾ NÀY</p>
        <ReceiptPreview shop={draft} />
      </div>
    </FormScreen>
  )
}

export function ShopInfoPage() {
  const shop = useShop()

  if (!shop) {
    return (
      <div className="p-4">
        <ListSkeleton rows={4} />
      </div>
    )
  }

  return <ShopForm shop={shop} />
}
