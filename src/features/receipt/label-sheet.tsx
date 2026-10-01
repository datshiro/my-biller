import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { paginateBlocks, type LabelBlock } from '@/domain/label-pages'
import type { LabelSize } from '@/domain/tspl/encode'
import type { Order, OrderLine, ShopSettings } from '@/domain/schema'
import { labelBodyStyle, lineBlocks } from './label-layout'
import { LabelView } from './label-view'

/**
 * Đo trên chính thân tem đang dựng: chiều cao còn lại của thân là chiều cao thật sau khi tên món chiếm
 * một hay hai dòng. Thước đo nằm trong thân tem nên thừa hưởng đúng font và giãn dòng, và đặt tuyệt đối
 * nên không làm đổi chiều cao thân. jsdom không có bố cục (mọi chiều cao bằng 0) → luôn vừa, một trang.
 */
function paginateOnProbe(probe: HTMLElement, blocks: readonly LabelBlock[], size: LabelSize): LabelBlock[][] {
  const body = probe.querySelector<HTMLElement>('[data-label-body]')
  if (!body) return [blocks.slice()]
  const ruler = document.createElement('div')
  Object.assign(ruler.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '0', width: `${body.clientWidth}px` })
  body.appendChild(ruler)
  const room = body.getBoundingClientRect().height
  try {
    return paginateBlocks(blocks, (page) => {
      ruler.replaceChildren(
        ...page.map((block) => {
          const p = document.createElement('p')
          Object.assign(p.style, labelBodyStyle(size, block.kind))
          p.textContent = block.text
          return p
        }),
      )
      return ruler.getBoundingClientRect().height <= room
    })
  } finally {
    ruler.remove()
  }
}

const LABEL_FONT_WEIGHTS = [400, 600, 700]

/**
 * Chờ đúng các mặt chữ tem sẽ vẽ, không chỉ hỏi `document.fonts.status`: trạng thái đó đã là 'loaded' khi
 * không còn gì đang tải, trong khi subset tiếng Việt của một độ đậm chưa dùng (tên món và topping là 700)
 * chỉ bắt đầu nạp khi tem mồi vẽ ký tự đầu tiên. Đo trước lúc đó là đo bằng font thay thế, rồi ảnh chụp lại
 * dùng font thật và `overflow-hidden` cắt cuối ghi chú mà không báo gì. Trả về true khi mọi mặt chữ cho
 * ĐÚNG đoạn chữ này đã nạp; đổi chữ thì chờ lại.
 */
function useLabelFontsReady(sample: string): boolean {
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  useEffect(() => {
    if (!document.fonts) return
    let live = true
    void Promise.all(
      LABEL_FONT_WEIGHTS.map((weight) => document.fonts.load(`${weight} 20px "Be Vietnam Pro"`, sample)),
    ).then(() => {
      if (live) setLoadedFor(sample)
    })
    return () => {
      live = false
    }
  }, [sample])
  return !document.fonts || loadedFor === sample
}

/**
 * Các tem của MỘT dòng món, tức các trang của một ly. Dựng một tem mồi chứa cả ghi chú để đo, rồi thay
 * bằng các trang đã chia. `onNodes` báo các node trang (rỗng khi chưa chia xong) cho nơi chụp.
 */
export function LabelSheet({
  shop,
  order,
  line,
  size,
  count,
  onNodes,
}: {
  shop: ShopSettings
  order: Order
  line: OrderLine
  size: LabelSize
  count: number
  onNodes: (nodes: HTMLElement[]) => void
}) {
  const blocks = useMemo(() => lineBlocks(line), [line])
  const sample = [shop.name, order.code, line.name, ...blocks.map((block) => block.text), '0123456789/:· tr'].join(' ')
  const fontsReady = useLabelFontsReady(sample)
  // Mọi thứ làm đổi chỗ chữ trên tem đều nằm trong khoá: đổi thì chia lại từ đầu.
  const key = JSON.stringify([blocks, size, shop.name, order.code, line.name, count, fontsReady])
  const [measured, setMeasured] = useState<{ key: string; pages: LabelBlock[][] } | null>(null)
  const pages = measured?.key === key ? measured.pages : null
  const probeRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (pages || !probeRef.current) return
    setMeasured({ key, pages: paginateOnProbe(probeRef.current, blocks, size) })
  }, [pages, key, blocks, size])

  useEffect(() => {
    onNodes(pages && sheetRef.current ? Array.from(sheetRef.current.children, (node) => node as HTMLElement) : [])
  }, [pages, onNodes])

  const shared = { shop, order, line, size, count }
  return (
    <div ref={sheetRef}>
      {pages ? (
        pages.map((pageBlocks, i) => (
          <LabelView key={i} {...shared} blocks={pageBlocks} page={i + 1} pageCount={pages.length} />
        ))
      ) : (
        <LabelView {...shared} blocks={blocks} page={1} pageCount={1} innerRef={probeRef} />
      )}
    </div>
  )
}
