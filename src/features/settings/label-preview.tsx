import { useEffect, useRef, useState } from 'react'
import { decodeLogo } from './shop-logo'
import { DEFAULT_LABEL_SIZE, readLabelPrinterConfig } from '../printer/label-config'
import { renderLabelPreview, type LabelWatermarkJob } from '../printer/label-job'
import { LabelView } from '../receipt/label-view'
import { bitmapToRgba } from '@/domain/watermark'
import { DEFAULT_SHOP, type LabelWatermark, type Order, type OrderLine } from '@/domain/schema'
import { labelDots } from '@/domain/tspl/encode'

const SAMPLE_ORDER = { code: 'PBH-260926-A001', soldAt: new Date(2026, 8, 26, 9, 5).getTime() } as Order
const SAMPLE_LINE = { name: 'Trà sữa trân châu' } as OrderLine
const SAMPLE_BLOCKS = [
  { kind: 'options', text: 'Ít đường, đá riêng' },
  { kind: 'note', text: 'Không trân châu' },
]
const SAMPLE_COUNT = 3
const FONT_WEIGHTS = [400, 600, 700]
const DEBOUNCE_MS = 200

/**
 * Tem mẫu dựng bằng chính đường in: chụp `LabelView`, ngưỡng một chấm, ghép lớp logo bằng `renderLabelPreview`.
 * Nhờ vậy giữa tem, bên phải, góc và từng mức đậm cho ảnh khác nhau đúng như trên giấy. Khổ lấy từ cấu hình máy in
 * tem của máy này, chưa cài thì dùng khổ mặc định.
 */
export function LabelPreview({ name, logo, watermark }: { name: string; logo: string | null; watermark: LabelWatermark }) {
  const size = readLabelPrinterConfig() ?? DEFAULT_LABEL_SIZE
  const dots = labelDots(size)
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [done, setDone] = useState<{ key: string; ok: boolean; logoBroken: boolean } | null>(null)
  const cornerLogo = Boolean(logo) && watermark.enabled && watermark.position === 'corner'
  const shop = { ...DEFAULT_SHOP, name, logo, labelWatermark: watermark }
  const { widthMm, heightMm, gapMm } = size
  const configKey = JSON.stringify([name, logo, watermark, widthMm, heightMm, gapMm])
  // Kết quả gắn với cấu hình đã dựng: đổi cấu hình là quay về "đang dựng" mà không cần setState đồng bộ trong effect.
  const state = done?.key !== configKey ? 'rendering' : done.ok ? 'ready' : 'failed'

  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const node = hostRef.current?.querySelector<HTMLElement>('[data-label]')
          const canvas = canvasRef.current
          const ctx = canvas?.getContext('2d')
          if (!node || !canvas || !ctx) throw new Error('Chưa dựng được tem mẫu.')
          // Chờ đúng các mặt chữ tem sẽ vẽ: đo bằng font thay thế thì chữ lệch so với tem thật.
          const sample = [name, SAMPLE_ORDER.code, SAMPLE_LINE.name, ...SAMPLE_BLOCKS.map((block) => block.text)].join(' ')
          await Promise.all(FONT_WEIGHTS.map((weight) => document.fonts.load(`${weight} 20px "Be Vietnam Pro"`, sample)))
          // Như khi in: logo hỏng thì vẫn dựng tem, chỉ bỏ logo, và nói rõ để người bán chọn lại ảnh.
          let job: LabelWatermarkJob | null = null
          let logoBroken = false
          if (logo && watermark.enabled) {
            try {
              job = { logo: await decodeLogo(logo), config: watermark }
            } catch {
              logoBroken = true
            }
          }
          const bitmap = await renderLabelPreview(node, { widthMm, heightMm, gapMm }, job)
          if (!live) return
          ctx.putImageData(new ImageData(bitmapToRgba(bitmap), bitmap.width, bitmap.height), 0, 0)
          setDone({ key: configKey, ok: true, logoBroken })
        } catch {
          if (!live) return
          // Xoá ảnh của cấu hình trước: để nguyên thì nó nằm ngay cạnh lời báo lỗi và dễ bị tưởng là kết quả đúng.
          const canvas = canvasRef.current
          const ctx = canvas?.getContext('2d')
          if (canvas && ctx) {
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, canvas.width, canvas.height)
          }
          setDone({ key: configKey, ok: false, logoBroken: false })
        }
      })()
    }, DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // `configKey` đã gom mọi thứ ảnh phụ thuộc; không đưa chuỗi logo dài vào mảng phụ thuộc rời.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey])

  return (
    <div className="flex flex-col gap-1.5">
      <p className="label-xs text-muted">TEM SẼ TRÔNG NHƯ THẾ NÀY</p>
      <canvas
        ref={canvasRef}
        data-label-preview
        data-ready={state === 'ready'}
        width={dots.width}
        height={dots.height}
        aria-label="Tem xem trước"
        className="w-full rounded-card border border-line bg-white"
        style={{ imageRendering: 'pixelated', aspectRatio: `${dots.width} / ${dots.height}` }}
      />
      {state === 'failed' ? <p role="alert" className="text-[12px] text-danger">Không dựng được ảnh xem trước.</p> : null}
      {state === 'ready' && done?.logoBroken ? (
        <p role="alert" className="text-[12px] text-danger">
          Logo không đọc được nên tem in không có logo — chọn lại ảnh logo.
        </p>
      ) : null}
      <p className="text-[12px] text-muted">
        Đúng mẫu chấm sẽ in. Số thứ tự 1/3 do máy in tự vẽ nên không có ở đây.
      </p>
      <div className="h-0 overflow-hidden" aria-hidden="true" ref={hostRef}>
        <LabelView
          shop={shop}
          order={SAMPLE_ORDER}
          line={SAMPLE_LINE}
          size={size}
          count={SAMPLE_COUNT}
          blocks={SAMPLE_BLOCKS}
          page={1}
          pageCount={1}
          cornerLogo={cornerLogo}
        />
      </div>
    </div>
  )
}
