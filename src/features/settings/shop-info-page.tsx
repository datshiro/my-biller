import { useState } from 'react'
import { useNavigate } from 'react-router'
import { logoDataUrlFromFile } from './shop-logo'
import { useShop } from './use-settings'
import { saveShop } from '@/db/repositories/settings'
import type { LabelWatermark, ShopSettings } from '@/domain/schema'
import { Button } from '@/ui/button'
import { SelectChip } from '@/ui/chip'
import { logoPlacement, type LogoPlacement } from '@/features/receipt/label-layout'
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

const PLACEMENTS: { value: LogoPlacement; label: string; patch: Partial<LabelWatermark> }[] = [
  { value: 'center', label: 'Giữa tem', patch: { position: 'center', align: 'center' } },
  { value: 'right', label: 'Bên phải', patch: { position: 'center', align: 'right' } },
  { value: 'corner', label: 'Góc trên phải', patch: { position: 'corner' } },
]

const STRENGTHS: { value: LabelWatermark['strength']; label: string }[] = [
  { value: 'light', label: 'Nhạt' },
  { value: 'medium', label: 'Vừa' },
  { value: 'dark', label: 'Đậm' },
]

function LogoSection({
  logo,
  watermark,
  onLogo,
  onWatermark,
  onError,
}: {
  logo: string | null
  watermark: LabelWatermark
  onLogo: (logo: string | null) => void
  onWatermark: (patch: Partial<LabelWatermark>) => void
  onError: (message: string | null) => void
}) {
  const [busy, setBusy] = useState(false)

  const pick = async (file: File) => {
    setBusy(true)
    onError(null)
    try {
      onLogo(await logoDataUrlFromFile(file))
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Không đọc được ảnh này.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="label-xs text-muted">LOGO CỬA HÀNG</p>
      {logo ? (
        <div className="flex items-center gap-3 rounded-card border border-line bg-white p-3">
          <img
            data-shop-logo-preview
            src={logo}
            alt="Logo sẽ in (đen trắng)"
            className="max-h-24 max-w-[60%] object-contain"
            style={{ imageRendering: 'pixelated' }}
          />
          <p className="text-[12px] text-muted">Bản đen trắng, đúng như khi in.</p>
        </div>
      ) : null}
      <div className="flex gap-2">
        <label className="inline-flex h-12 cursor-pointer items-center justify-center rounded-btn border border-line bg-surface px-4 font-semibold text-ink active:bg-line">
          {busy ? 'Đang xử lý ảnh…' : logo ? 'Chọn ảnh khác' : 'Chọn ảnh logo'}
          <input
            data-shop-logo-input
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0]
              // Xoá giá trị để chọn lại đúng ảnh vừa chọn vẫn kích hoạt onChange.
              event.target.value = ''
              if (file) void pick(file)
            }}
          />
        </label>
        {logo ? (
          <Button variant="danger" onClick={() => onLogo(null)}>
            Gỡ logo
          </Button>
        ) : null}
      </div>

      {logo ? (
        <div data-label-watermark className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3">
          <label className="flex items-center gap-3 font-semibold">
            <input
              type="checkbox"
              className="h-5 w-5 accent-brand"
              checked={watermark.enabled}
              onChange={(event) => onWatermark({ enabled: event.target.checked })}
            />
            In logo chìm trên tem
          </label>
          {watermark.enabled ? (
            <>
              <div className="flex gap-2 overflow-x-auto">
                {PLACEMENTS.map((option) => (
                  <SelectChip
                    key={option.value}
                    selected={logoPlacement(watermark) === option.value}
                    onClick={() => onWatermark(option.patch)}
                  >
                    {option.label}
                  </SelectChip>
                ))}
              </div>
              {logoPlacement(watermark) !== 'corner' ? (
                <div className="flex gap-2 overflow-x-auto">
                  {STRENGTHS.map((option) => (
                    <SelectChip
                      key={option.value}
                      selected={watermark.strength === option.value}
                      onClick={() => onWatermark({ strength: option.value })}
                    >
                      {option.label}
                    </SelectChip>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-muted">Logo nhỏ ở góc in đậm, không làm mờ.</p>
              )}
            </>
          ) : null}
          <p className="text-[12px] text-muted">Cài chung cho mọi máy đã ghép.</p>
        </div>
      ) : null}
    </div>
  )
}

function ShopForm({ shop }: { shop: ShopSettings }) {
  const navigate = useNavigate()
  const [draft, setDraft] = useState(shop)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (patch: Partial<ShopSettings>) => setDraft((current) => ({ ...current, ...patch }))

  const dirty =
    (Object.keys(shop) as (keyof ShopSettings)[]).some((key) => key !== 'labelWatermark' && draft[key] !== shop[key]) ||
    JSON.stringify(draft.labelWatermark) !== JSON.stringify(shop.labelWatermark)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await saveShop({
        name: draft.name.trim(),
        phone: draft.phone.trim(),
        address: draft.address.trim(),
        footerNote: draft.footerNote.trim(),
        // Luôn ghi đủ hai khoá: Worker coi bản ghi thiếu khoá là của máy bản cũ và giữ logo đang lưu.
        logo: draft.logo,
        labelWatermark: draft.labelWatermark,
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

      <LogoSection
        logo={draft.logo}
        watermark={draft.labelWatermark}
        onLogo={(logo) =>
          set(logo ? { logo } : { logo: null, labelWatermark: { ...draft.labelWatermark, enabled: false } })
        }
        onWatermark={(patch) => set({ labelWatermark: { ...draft.labelWatermark, ...patch } })}
        onError={setError}
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
