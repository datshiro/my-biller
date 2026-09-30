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
  const bodyStyle = labelBodyStyle(size)
  try {
    return paginateBlocks(blocks, (page) => {
      ruler.replaceChildren(
        ...page.map((block) => {
          const p = document.createElement('p')
          Object.assign(p.style, bodyStyle)
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

function useFontsReady(): boolean {
  const [ready, setReady] = useState(() => !document.fonts || document.fonts.status === 'loaded')
  useEffect(() => {
    if (ready) return
    let live = true
    void document.fonts.ready.then(() => {
      if (live) setReady(true)
    })
    return () => {
      live = false
    }
  }, [ready])
  return ready
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
  const fontsReady = useFontsReady()
  const blocks = useMemo(() => lineBlocks(line), [line])
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
