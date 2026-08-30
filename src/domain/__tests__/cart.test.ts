import { describe, expect, it } from 'vitest'
import { cartCount, cartReducer, cartTotals, emptyCart, type Cart } from '../cart'
import type { PriceBook } from '../wholesale-price'
import { calcChange, suggestCashAmounts } from '../cash-suggestion'
import type { Item } from '../schema'
import { testGid } from '@/test-fixtures'

const item = (over: Partial<Item> = {}): Item => ({
  id: 1,
  gid: testGid(1),
  name: 'Phở bò',
  groupId: null,
  unit: 'tô',
  unitPrice: 55_000,
  costPrice: 30_000,
  isActive: 1,
  note: '',
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

/** Khách chưa có bảng giá riêng: mọi thứ chạy bằng giá lẻ, đúng như trước khi có Phase 2. */
const RONG: PriceBook = new Map()

const run = (actions: Parameters<typeof cartReducer>[1][], from: Cart = emptyCart()) =>
  actions.reduce(cartReducer, from)

describe('giỏ hàng', () => {
  it('chạm cùng một mặt hàng nhiều lần thì cộng dồn số lượng, không đẻ dòng mới', () => {
    const cart = run([
      { type: 'addItem', item: item(), book: RONG },
      { type: 'addItem', item: item(), book: RONG },
      { type: 'addItem', item: item(), qty: 3, book: RONG },
    ])

    expect(cart.lines).toHaveLength(1)
    expect(cart.lines[0]?.qty).toBe(5)
    expect(cartCount(cart)).toBe(5)
  })

  it('sửa giá một dòng rồi chạm lại mặt hàng đó → ra dòng mới, không đè giá đã sửa', () => {
    const added = run([{ type: 'addItem', item: item(), book: RONG }])
    const key = added.lines[0]?.key ?? ''

    const cart = run(
      [
        { type: 'setUnitPrice', key, unitPrice: 40_000 },
        { type: 'addItem', item: item(), book: RONG },
      ],
      added,
    )

    expect(cart.lines).toHaveLength(2)
    expect(cart.lines.map((line) => line.unitPrice)).toEqual([40_000, 55_000])
  })

  it('giảm số lượng về 0 là xoá dòng', () => {
    const added = run([{ type: 'addItem', item: item(), book: RONG }])
    const key = added.lines[0]?.key ?? ''

    expect(run([{ type: 'bumpQty', key, delta: -1 }], added).lines).toEqual([])
  })

  it('tính tổng qua domain: làm tròn từng dòng rồi mới trừ giảm giá', () => {
    const cart = run([
      { type: 'addItem', item: item({ id: 1, unitPrice: 12_501 }), qty: 0.5, book: RONG },
      { type: 'addItem', item: item({ id: 2, name: 'Trà đá', unitPrice: 3_000 }), qty: 2, book: RONG },
      { type: 'setDiscount', discount: 251 },
      { type: 'setSurcharge', surcharge: 5_000 },
    ])

    // 12.501 × 0,5 = 6.250,5 → 6.251 (làm tròn tại dòng)
    expect(cartTotals(cart)).toEqual({ subtotal: 12_251, discount: 251, surcharge: 5_000, total: 17_000 })
  })

  it('giảm giá lớn hơn tiền hàng bị kẹp lại, tổng không âm', () => {
    const cart = run([
      { type: 'addItem', item: item({ unitPrice: 10_000 }), book: RONG },
      { type: 'setDiscount', discount: 99_000 },
    ])

    expect(cartTotals(cart)).toMatchObject({ discount: 10_000, total: 0 })
  })

  it('xoá giỏ trả về giỏ rỗng, không giữ lại khách đã chọn', () => {
    const cart = run([
      { type: 'setCustomer', customerId: 7, customerName: 'Anh Hùng' },
      { type: 'addItem', item: item(), book: RONG },
      { type: 'clear' },
    ])

    expect(cart).toEqual(emptyCart())
  })
})

describe('gợi ý tiền khách đưa', () => {
  it('gợi ý theo mệnh giá, luôn lớn hơn tổng', () => {
    expect(suggestCashAmounts(73_000)).toEqual([80_000, 100_000, 200_000])
    expect(suggestCashAmounts(145_000)).toEqual([150_000, 200_000, 500_000])
    expect(suggestCashAmounts(5_000)).toEqual([10_000, 50_000, 100_000])
  })

  it('tổng đã chẵn mệnh giá thì không gợi ý lại chính nó', () => {
    expect(suggestCashAmounts(100_000)).toEqual([200_000, 500_000])
  })

  it('giỏ rỗng thì không gợi ý gì', () => {
    expect(suggestCashAmounts(0)).toEqual([])
  })

  it('khách đưa thiếu thì tiền thối bằng 0, không ra số âm', () => {
    expect(calcChange(73_000, 100_000)).toBe(27_000)
    expect(calcChange(73_000, 50_000)).toBe(0)
  })
})

/**
 * Công tắc Lẻ/SỈ đổi giá **cả giỏ** một lượt. Hai bất biến phải giữ bằng mọi giá: dòng người bán tự gõ
 * giá thì không ai được đụng vào, và bật rồi tắt phải trả giỏ về đúng chỗ cũ.
 */
describe('đổi giá cả giỏ theo chế độ Lẻ/SỈ', () => {
  const SI = (giá: number): PriceBook => new Map([[1, giá]])

  it('bật SỈ thì dòng giá lẻ đổi theo bảng giá, dòng món khác không có giá riêng thì giữ nguyên', () => {
    const gio = run([
      { type: 'addItem', item: item(), book: RONG },
      { type: 'addItem', item: item({ id: 2, name: 'Trà đá', unitPrice: 3_000 }), qty: 2, book: RONG },
      { type: 'applyPriceMode', mode: 'wholesale', book: SI(45_000) },
    ])

    expect(gio.priceMode).toBe('wholesale')
    expect(gio.lines.map((line) => line.unitPrice)).toEqual([45_000, 3_000])
  })

  /**
   * Ca mất tiền. Không có `priceSource` trong khoá dòng thì hai dòng này trùng khoá sau khi đổi giá,
   * `upsert` gộp thành 1 dòng `manual` qty 4, và tắt SỈ không cứu lại được vì dòng `manual` bất khả xâm
   * phạm: 4 tô bán 38.000 thay vì 1×38.000 + 3×55.000.
   */
  it('dòng gõ tay không bị dòng giá lẻ nuốt, kể cả khi giá sỉ trùng đúng giá đã gõ', () => {
    const mộtTô = run([{ type: 'addItem', item: item(), book: RONG }])
    const gõTay = run([{ type: 'setUnitPrice', key: mộtTô.lines[0]?.key ?? '', unitPrice: 38_000 }], mộtTô)
    const gio = run([{ type: 'addItem', item: item(), qty: 3, book: RONG }], gõTay)

    expect(gio.lines).toHaveLength(2)

    const bậtSỈ = run([{ type: 'applyPriceMode', mode: 'wholesale', book: SI(38_000) }], gio)

    expect(bậtSỈ.lines).toHaveLength(2)
    expect(bậtSỈ.lines.map((line) => [line.priceSource, line.unitPrice, line.qty])).toEqual([
      ['manual', 38_000, 1],
      ['catalog', 38_000, 3],
    ])

    const tắtSỈ = run([{ type: 'applyPriceMode', mode: 'retail', book: new Map() }], bậtSỈ)

    expect(tắtSỈ.lines.map((line) => [line.unitPrice, line.qty])).toEqual([
      [38_000, 1],
      [55_000, 3],
    ])
    expect(cartTotals(tắtSỈ).total).toBe(38_000 + 3 * 55_000)
  })

  it('dòng gõ tay giữ nguyên cả giá lẫn số lượng khi bật SỈ', () => {
    const mộtTô = run([{ type: 'addItem', item: item(), qty: 5, book: RONG }])
    const gõTay = run([{ type: 'setUnitPrice', key: mộtTô.lines[0]?.key ?? '', unitPrice: 38_000 }], mộtTô)

    const bậtSỈ = run([{ type: 'applyPriceMode', mode: 'wholesale', book: SI(45_000) }], gõTay)

    expect(bậtSỈ.lines[0]).toMatchObject({ unitPrice: 38_000, qty: 5, priceSource: 'manual' })
  })

  it('hai dòng giá lẻ cùng món bằng nhau sau khi đổi giá thì gộp làm một, cộng dồn số lượng', () => {
    const line = (unitPrice: number, qty: number) => ({
      itemId: 1,
      name: 'Phở bò',
      unit: 'tô',
      unitPrice,
      costPrice: 30_000,
      qty,
    })
    const gio = run([
      { type: 'addLine', line: line(55_000, 1), book: RONG },
      { type: 'addLine', line: line(50_000, 2), book: RONG },
    ])

    expect(gio.lines).toHaveLength(2)

    const bậtSỈ = run([{ type: 'applyPriceMode', mode: 'wholesale', book: SI(45_000) }], gio)

    expect(bậtSỈ.lines).toHaveLength(1)
    expect(bậtSỈ.lines[0]).toMatchObject({ unitPrice: 45_000, qty: 3 })
  })

  it('đổi khách khi đang SỈ thì dòng giá lẻ nhận giá của khách mới', () => {
    const gio = run([
      { type: 'addItem', item: item(), book: RONG },
      { type: 'applyPriceMode', mode: 'wholesale', book: SI(45_000) },
      { type: 'applyPriceMode', mode: 'wholesale', book: SI(40_000) },
    ])

    expect(gio.lines[0]?.unitPrice).toBe(40_000)
  })

  /**
   * Giá lẻ để quay về nằm **trên dòng** (`retailPrice`), không đọc lại từ danh mục. Nên người bán sửa giá
   * lẻ ở màn Mặt hàng giữa chừng cũng không kéo giá trong giỏ đi theo — `applyPriceMode` không hề có
   * danh mục trong payload để mà đọc. Tắt SỈ ở đây còn dùng bảng giá **rỗng** để chứng minh đường về
   * không phụ thuộc bảng giá của ai cả.
   */
  it('bật rồi tắt SỈ trả giỏ về đúng như cũ', () => {
    const gốc = run([
      { type: 'addItem', item: item(), book: RONG },
      { type: 'addItem', item: item({ id: 2, name: 'Trà đá', unitPrice: 3_000 }), qty: 2, book: RONG },
    ])

    const vòng = run(
      [
        { type: 'applyPriceMode', mode: 'wholesale', book: SI(45_000) },
        { type: 'applyPriceMode', mode: 'retail', book: new Map() },
      ],
      gốc,
    )

    expect(vòng).toEqual(gốc)
  })

  it('gõ “2 pho” khi đang SỈ thì vào giỏ luôn bằng giá riêng', () => {
    const đangSỈ = run([{ type: 'applyPriceMode', mode: 'wholesale', book: SI(45_000) }])

    const gio = run(
      [
        {
          type: 'addLine',
          line: { itemId: 1, name: 'Phở bò', unit: 'tô', unitPrice: 55_000, costPrice: 30_000, qty: 2 },
          book: SI(45_000),
        },
      ],
      đangSỈ,
    )

    expect(gio.lines[0]).toMatchObject({
      unitPrice: 45_000,
      retailPrice: 55_000,
      priceSource: 'catalog',
      qty: 2,
    })
  })

  it('món ngoài danh mục luôn là giá gõ tay, bật SỈ không đụng tới', () => {
    const gio = run([
      {
        type: 'addLine',
        line: { itemId: null, name: 'Ship', unit: 'lần', unitPrice: 15_000, costPrice: null, qty: 1 },
        book: RONG,
      },
      { type: 'applyPriceMode', mode: 'wholesale', book: SI(45_000) },
    ])

    expect(gio.lines[0]).toMatchObject({ unitPrice: 15_000, priceSource: 'manual' })
  })

  it('sửa giá đúng bằng giá đang có thì dòng vẫn là giá danh mục, tắt SỈ vẫn hoàn nguyên', () => {
    const mộtTô = run([{ type: 'addItem', item: item(), book: RONG }])
    const key = mộtTô.lines[0]?.key ?? ''

    const gio = run([{ type: 'setUnitPrice', key, unitPrice: 55_000 }], mộtTô)

    expect(gio.lines[0]?.priceSource).toBe('catalog')
  })
})

describe('khôi phục nháp', () => {
  it('tính lại khoá dòng, để nháp của bản cũ không đẻ dòng trùng khi chạm thêm', () => {
    const nháp: Cart = {
      ...emptyCart(),
      lines: [
        {
          key: '1@55000',
          itemId: 1,
          name: 'Phở bò',
          unit: 'tô',
          unitPrice: 55_000,
          retailPrice: 55_000,
          priceSource: 'catalog',
          costPrice: 30_000,
          qty: 1,
          note: '',
        },
      ],
    }

    const gio = run([{ type: 'restore', cart: nháp }, { type: 'addItem', item: item(), book: RONG }])

    expect(gio.lines).toHaveLength(1)
    expect(gio.lines[0]?.qty).toBe(2)
  })

  it('addLine từ chối qty <= 0 ngay ở reducer, không chờ call site nhớ chặn', () => {
    // `setQty` (:179) và `updateLine` (:197) đã có guard này; `addLine` thì không, nó đi thẳng vào
    // `upsert`. Một dòng qty 0 lọt vào giỏ làm `calcLineAmount` ném, mà nó chạy trong thân render
    // của SalesPage ⇒ ErrorBoundary nuốt cả màn. Đặt bất biến ở reducer để nó toàn phần.
    const gio = run([
      {
        type: 'addLine',
        line: { itemId: 1, name: 'Phở bò', unit: 'tô', unitPrice: 55_000, costPrice: 30_000, qty: 0 },
        book: RONG,
      },
    ])

    expect(gio.lines).toEqual([])
  })
})

describe('hoàn lại dòng vừa gỡ', () => {
  const SI = (giá: number): PriceBook => new Map([[1, giá]])

  it('restoreLine trả dòng về NGUYÊN TRẠNG, không tính lại giá', () => {
    // Đường Hoàn lại của banner "gõ 0 lỡ tay". Không dùng `addLine` được: nó tính lại `unitPrice`
    // qua `resolveUnitPrice` và ép `priceSource: 'catalog'`, nên dòng giá-gõ-tay đang bật SỈ sẽ bị
    // giá trong bảng đè mất giá riêng. Hoàn lại mà đổi tiền thì không phải hoàn lại.
    const đangSỈ = run([
      { type: 'addItem', item: item(), book: SI(45_000) },
      { type: 'applyPriceMode', mode: 'wholesale', book: SI(45_000) },
    ])
    const gõTay = run(
      [{ type: 'setUnitPrice', key: đangSỈ.lines[0]?.key ?? '', unitPrice: 30_000 }],
      đangSỈ,
    )
    const dòng = gõTay.lines[0]
    expect(dòng?.priceSource).toBe('manual')

    const đãBỏ = run([{ type: 'setQty', key: dòng?.key ?? '', qty: 0 }], gõTay)
    expect(đãBỏ.lines).toEqual([])

    const hoànLại = run([{ type: 'restoreLine', line: dòng! }], đãBỏ)
    expect(hoànLại.lines).toEqual([dòng])
  })

  it('restoreLine cũng gác qty <= 0, không mở lại lỗ vừa bịt ở addLine', () => {
    const gio = run([
      {
        type: 'restoreLine',
        line: {
          key: 'x',
          itemId: 1,
          name: 'Phở bò',
          unit: 'tô',
          unitPrice: 55_000,
          retailPrice: 55_000,
          costPrice: 30_000,
          priceSource: 'catalog',
          qty: 0,
          note: '',
        },
      },
    ])

    expect(gio.lines).toEqual([])
  })
})

