// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LabelSheet } from '../label-sheet'
import { DEFAULT_SHOP, type Order, type OrderLine } from '@/domain/schema'

const order = { code: 'PBH-260926-A001', soldAt: new Date(2026, 8, 26, 9, 5).getTime() } as Order
const size = { widthMm: 50, heightMm: 30, gapMm: 2 }
const line = (note: string, extras: Partial<OrderLine> = {}) =>
  ({ name: 'Trà sữa', note, options: [], toppings: [], ...extras }) as OrderLine
const LINE_CHARS = 10
const BODY_LINES = 3

// jsdom không có bố cục: giả một thân tem chứa 3 dòng × 10 ký tự và thước đo cao theo số dòng chữ.
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const height = this.hasAttribute('data-label-body')
      ? BODY_LINES * 10
      : [...this.querySelectorAll('p')].reduce((h, p) => h + Math.ceil((p.textContent ?? '').length / LINE_CHARS) * 10, 0)
    return { height, width: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const renderSheet = (note: string) => {
  const onNodes = vi.fn<(nodes: HTMLElement[]) => void>()
  const view = render(
    <LabelSheet shop={{ ...DEFAULT_SHOP, name: 'Quán Nhỏ' }} order={order} line={line(note)} size={size} count={3} onNodes={onNodes} />,
  )
  return { ...view, onNodes, last: () => onNodes.mock.calls.at(-1)?.[0] ?? [] }
}

describe('LabelSheet', () => {
  it('ghi chú ngắn: một tem, không có dấu phụ trang', () => {
    const { last } = renderSheet('ít đá')

    expect(last()).toHaveLength(1)
    expect(last()[0]?.textContent).toContain('ít đá')
    expect(last()[0]?.textContent).not.toMatch(/tr \d/)
  })

  it('ghi chú dài hơn thân tem: ra nhiều tem, mỗi tem lặp lại đầu tem và tên món, có "tr k/m", đủ chữ', () => {
    const note = 'không lấy ống hút để đá riêng ra túi nhé gói kỹ giúp em'
    const { last } = renderSheet(note)
    const nodes = last()

    expect(nodes.length).toBeGreaterThan(1)
    nodes.forEach((node, i) => {
      expect(node.textContent).toContain('Quán Nhỏ')
      expect(node.textContent).toContain('PBH-260926-A001')
      expect(node.textContent).toContain('Trà sữa')
      expect(node.textContent).toContain(`tr ${i + 1}/${nodes.length}`)
    })
    const body = nodes.map((n) => n.querySelector('[data-label-body]')?.textContent ?? '')
    expect(body.join(' ')).toBe(note)
  })

  it('ghi chú rỗng: đúng một tem, thân trống', () => {
    const { last } = renderSheet('')
    expect(last()).toHaveLength(1)
    expect(last()[0]?.querySelector('[data-label-body]')?.textContent).toBe('')
  })

  it('ba hạng mục đi theo thứ tự trên tem; hạng mục dài tràn sang tem sau giữ nguyên thứ tự đọc', () => {
    const onNodes = vi.fn<(nodes: HTMLElement[]) => void>()
    render(
      <LabelSheet
        shop={{ ...DEFAULT_SHOP, name: 'Quán Nhỏ' }}
        order={order}
        line={line('mang về gói kỹ giúp em nhé', {
          options: ['Ít đường', 'Đá riêng'],
          toppings: [{ name: 'Trân châu', unitPrice: 5_000, qty: 2 }],
        })}
        size={size}
        count={3}
        onNodes={onNodes}
      />,
    )
    const nodes = onNodes.mock.calls.at(-1)?.[0] ?? []
    const bodies = nodes.map((node) => [...node.querySelectorAll('[data-label-body] p')].map((p) => p.textContent))

    expect(nodes.length).toBeGreaterThan(1)
    expect(bodies.flat().join(' ')).toBe('Ít đường, Đá riêng + Trân châu x2 mang về gói kỹ giúp em nhé')
    expect(bodies[0]?.[0]).toBe('Ít đường, Đá riêng')
  })

  describe('font tem', () => {
    afterEach(() => {
      Reflect.deleteProperty(document, 'fonts')
    })

    it('chờ nạp đủ ba độ đậm cho đúng chữ trên tem rồi mới coi là sẵn sàng, xong thì đo lại', async () => {
      const loaded: string[] = []
      let release: () => void = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: {
          load: (spec: string, text: string) => {
            loaded.push(`${spec}|${text}`)
            return gate.then(() => [])
          },
        },
      })

      const { onNodes } = renderSheet('mang về gói kỹ')
      const before = onNodes.mock.calls.length
      expect(loaded.map((entry) => entry.split('|')[0])).toEqual([
        '400 20px "Be Vietnam Pro"',
        '600 20px "Be Vietnam Pro"',
        '700 20px "Be Vietnam Pro"',
      ])
      expect(loaded[0]).toContain('Trà sữa')
      expect(loaded[0]).toContain('mang về gói kỹ')

      release()
      await waitFor(() => expect(onNodes.mock.calls.length).toBeGreaterThan(before))
      expect(onNodes.mock.calls.at(-1)?.[0].length).toBe(1)
    })
  })

  it('đổi ghi chú thì chia lại trang', () => {
    const { last, rerender, onNodes } = renderSheet('ngắn')
    expect(last()).toHaveLength(1)

    rerender(
      <LabelSheet
        shop={{ ...DEFAULT_SHOP, name: 'Quán Nhỏ' }}
        order={order}
        line={line('một ghi chú rất dài cần nhiều hơn một tem mới chứa hết được')}
        size={size}
        count={3}
        onNodes={onNodes}
      />,
    )
    expect(last().length).toBeGreaterThan(1)
  })
})
