import { describe, expect, it } from 'vitest'
import {
  cartCount,
  cartReducer,
  cartTotals,
  emptyCart,
  hasNoteToken,
  toggleNoteToken,
  type Cart,
  type CartLine,
} from '../cart'
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

describe('bất biến qty > 0 trên MỌI đường chèn', () => {
  it('hoàn lại một dòng đã quay lại giỏ là không làm gì, không cộng dồn số lượng', () => {
    // Người bán bỏ 3 tô bằng cách gõ 0 (cố ý), chạm lại món 3 lần, rồi bấm "Hoàn lại" theo quán tính
    // vì đó từng là nút duy nhất trên banner. `upsert` cộng dồn qty ⇒ đơn ghi 6 tô, tiền gấp đôi.
    const có3 = run([{ type: 'addItem', item: item(), qty: 3, book: RONG }])
    const dòng = có3.lines[0]
    expect(dòng?.qty).toBe(3)

    const đãBỏ = run([{ type: 'setQty', key: dòng?.key ?? '', qty: 0 }], có3)
    const chạmLại = run([{ type: 'addItem', item: item(), qty: 3, book: RONG }], đãBỏ)
    expect(chạmLại.lines[0]?.qty).toBe(3)

    const sauHoànLại = run([{ type: 'restoreLine', line: dòng as CartLine }], chạmLại)
    expect(sauHoànLại.lines[0]?.qty).toBe(3)
    expect(sauHoànLại.lines).toHaveLength(1)
  })

  it('addItem qty <= 0 không chèn dòng nào', () => {
    // Bất biến phải toàn phần chứ không dựa vào call site sản xuất hôm nay tình cờ không truyền qty.
    expect(run([{ type: 'addItem', item: item(), qty: 0, book: RONG }]).lines).toEqual([])
    expect(run([{ type: 'addItem', item: item(), qty: -1, book: RONG }]).lines).toEqual([])
  })
})

/**
 * Cùng một món cùng một giá phải tách được thành nhiều dòng theo ghi chú: ca thật là 3 ly đá chung +
 * 2 ly đá riêng. Ghi chú vào khoá dòng nên mọi đường đổi ghi chú cũng là đường đổi khoá — và hai
 * dòng đụng khoá nhau thì phải gộp, không được để hai bản ghi mang chung một khoá.
 */
describe('ghi chú nằm trong khoá dòng giỏ', () => {
  const hàng = (note?: string, qty = 1) => ({
    itemId: 1,
    name: 'Phở bò',
    unit: 'tô',
    unitPrice: 55_000,
    costPrice: 30_000,
    qty,
    ...(note === undefined ? {} : { note }),
  })

  const khoá = (gio: Cart, index = 0) => gio.lines[index]?.key ?? ''

  it('B1 · chạm cùng món hai lần, cả hai không ghi chú → vẫn một dòng cộng dồn', () => {
    const gio = run([
      { type: 'addItem', item: item(), book: RONG },
      { type: 'addItem', item: item(), book: RONG },
    ])

    expect(gio.lines).toHaveLength(1)
    expect(gio.lines[0]?.qty).toBe(2)
  })

  it('B2 · hai dòng cùng món cùng giá khác ghi chú là hai dòng riêng', () => {
    const gio = run([
      { type: 'addLine', line: hàng('Đá chung', 3), book: RONG },
      { type: 'addLine', line: hàng('Đá riêng', 2), book: RONG },
    ])

    expect(gio.lines).toHaveLength(2)
    expect(gio.lines.map((line) => [line.note, line.qty])).toEqual([
      ['Đá chung', 3],
      ['Đá riêng', 2],
    ])
  })

  it('B3 · chạm lại món khi giỏ đã có dòng đánh dấu → đẻ dòng mới, không nhập vào dòng đã đánh dấu', () => {
    const gio = run([
      { type: 'addLine', line: hàng('Đá chung', 3), book: RONG },
      { type: 'addItem', item: item(), book: RONG },
    ])

    expect(gio.lines).toHaveLength(2)
    expect(gio.lines[1]).toMatchObject({ note: '', qty: 1 })
  })

  it('B4 · đổi ghi chú khi không dòng nào trùng khoá mới → giữ nguyên vị trí trong giỏ', () => {
    const gốc = run([
      { type: 'addItem', item: item(), book: RONG },
      { type: 'addItem', item: item({ id: 2, name: 'Trà đá', unitPrice: 3_000 }), book: RONG },
    ])
    const cũ = khoá(gốc)

    const gio = run([{ type: 'updateLine', key: cũ, qty: 1, unitPrice: 55_000, note: 'Đá chung' }], gốc)

    expect(gio.lines).toHaveLength(2)
    expect(gio.lines[0]).toMatchObject({ name: 'Phở bò', note: 'Đá chung' })
    expect(gio.lines[0]?.key).not.toBe(cũ)
  })

  it('B5 · đổi ghi chú làm đụng khoá dòng khác → gộp, qty là số vừa đặt cộng dòng bị đụng', () => {
    const gốc = run([
      { type: 'addLine', line: hàng(undefined, 2), book: RONG },
      { type: 'addLine', line: hàng('Đá chung', 3), book: RONG },
    ])

    const gio = run([{ type: 'updateLine', key: khoá(gốc), qty: 2, unitPrice: 55_000, note: 'Đá chung' }], gốc)

    expect(gio.lines).toHaveLength(1)
    expect(gio.lines[0]).toMatchObject({ note: 'Đá chung', qty: 5 })
  })

  it('B5b · dòng sống sót sau khi gộp giữ trường của dòng VỪA SỬA, không của dòng bị đụng', () => {
    // Hai lựa chọn đều bảo vệ được và chúng ngược nhau, nên phải khoá bằng test: đổi ý sau này sẽ
    // làm đỏ một ca có tên chứ không trôi im lặng. `unit`, `retailPrice`, `costPrice` không nằm
    // trong khoá nên chúng là chỗ duy nhất phân biệt được hai dòng đang đụng nhau.
    const dựng = run([
      { type: 'addLine', line: hàng(undefined, 2), book: RONG },
      { type: 'addLine', line: hàng('Đá chung', 3), book: RONG },
    ])
    const [vừaSửa, đích] = dựng.lines as [CartLine, CartLine]
    const gốc: Cart = {
      ...dựng,
      lines: [vừaSửa, { ...đích, unit: 'CHÉN', retailPrice: 99_000, costPrice: 1 }],
    }

    const gio = run([{ type: 'updateLine', key: vừaSửa.key, qty: 2, unitPrice: 55_000, note: 'Đá chung' }], gốc)

    expect(gio.lines).toHaveLength(1)
    expect(gio.lines[0]).toMatchObject({
      unit: 'tô',
      retailPrice: 55_000,
      costPrice: 30_000,
      itemId: 1,
      priceSource: 'catalog',
      qty: 5,
    })
  })

  it('B6 · XOÁ ghi chú cũng làm đụng khoá và cũng phải gộp', () => {
    const gốc = run([
      { type: 'addLine', line: hàng('Đá chung', 3), book: RONG },
      { type: 'addLine', line: hàng(undefined, 2), book: RONG },
    ])

    const gio = run([{ type: 'updateLine', key: khoá(gốc), qty: 3, unitPrice: 55_000, note: '' }], gốc)

    expect(gio.lines).toHaveLength(1)
    expect(gio.lines[0]).toMatchObject({ note: '', qty: 5 })
  })

  it('B7 · mở sheet rồi bấm XONG mà không đổi gì thì không tự cộng dồn với chính mình', () => {
    const gốc = run([{ type: 'addLine', line: hàng('Đá chung', 3), book: RONG }])

    const gio = run([{ type: 'updateLine', key: khoá(gốc), qty: 3, unitPrice: 55_000, note: 'Đá chung' }], gốc)

    expect(gio.lines).toHaveLength(1)
    expect(gio.lines[0]?.qty).toBe(3)
  })

  it('B8 · đổi cả giá lẫn ghi chú một lượt → khoá mang cả hai, dòng thành giá gõ tay', () => {
    const gốc = run([{ type: 'addLine', line: hàng(undefined, 1), book: RONG }])

    const gio = run([{ type: 'updateLine', key: khoá(gốc), qty: 1, unitPrice: 60_000, note: 'Đá riêng' }], gốc)

    expect(gio.lines[0]).toMatchObject({ unitPrice: 60_000, note: 'Đá riêng', priceSource: 'manual' })
    expect(gio.lines[0]?.key).toContain('Đá riêng')
    expect(gio.lines[0]?.key).toContain('60000')
  })

  it('B9 · setLineNote tính lại khoá theo đúng khuôn của withPrice', () => {
    const gốc = run([{ type: 'addItem', item: item(), book: RONG }])
    const cũ = khoá(gốc)

    const gio = run([{ type: 'setLineNote', key: cũ, note: 'Đá chung' }], gốc)

    expect(gio.lines).toHaveLength(1)
    expect(gio.lines[0]?.note).toBe('Đá chung')
    expect(gio.lines[0]?.key).not.toBe(cũ)
    expect(gio.lines[0]?.priceSource).toBe('catalog')
  })

  it('B10 · setLineNote làm đụng khoá cũng gộp, đi chung một helper với updateLine', () => {
    const gốc = run([
      { type: 'addLine', line: hàng(undefined, 2), book: RONG },
      { type: 'addLine', line: hàng('Đá chung', 3), book: RONG },
    ])

    const gio = run([{ type: 'setLineNote', key: khoá(gốc), note: 'Đá chung' }], gốc)

    expect(gio.lines).toHaveLength(1)
    expect(gio.lines[0]).toMatchObject({ note: 'Đá chung', qty: 5 })
  })

  it('B11 · đổi giá dòng đã đánh dấu thì khoá mới vẫn mang ghi chú, không rơi mất', () => {
    const gốc = run([{ type: 'addLine', line: hàng('Đá riêng', 2), book: RONG }])

    const gio = run([{ type: 'setUnitPrice', key: khoá(gốc), unitPrice: 60_000 }], gốc)

    expect(gio.lines[0]).toMatchObject({ note: 'Đá riêng', unitPrice: 60_000 })
    expect(gio.lines[0]?.key).toContain('Đá riêng')
  })

  it('B12 · sửa giá dòng này thành đúng giá dòng kia thì gộp, không để hai dòng chung một khoá', () => {
    // Lỗ có sẵn từ trước tính năng ghi chú: `mapLine` cũ để lọt hai dòng cùng khoá, từ đó `mapLine`
    // và `removeLine` tác động cả hai cùng lúc. Tính năng này biến "cùng món hai dòng" thành chuyện
    // thường ngày nên lỗ từ hiếm thành dễ gặp; cùng một helper vá luôn.
    const mộtTô = run([{ type: 'addItem', item: item(), book: RONG }])
    const gõTay = run([{ type: 'setUnitPrice', key: khoá(mộtTô), unitPrice: 60_000 }], mộtTô)
    const chạmLại = run([{ type: 'addItem', item: item(), book: RONG }], gõTay)
    expect(chạmLại.lines).toHaveLength(2)

    const gio = run([{ type: 'setUnitPrice', key: khoá(chạmLại, 1), unitPrice: 60_000 }], chạmLại)

    expect(gio.lines).toHaveLength(1)
    expect(gio.lines[0]).toMatchObject({ unitPrice: 60_000, qty: 2, priceSource: 'manual' })
  })

  it('B13 · bật SỈ cho hai dòng cùng món khác ghi chú → giá bằng nhau nhưng vẫn hai dòng', () => {
    const gốc = run([
      { type: 'addLine', line: hàng('Đá chung', 3), book: RONG },
      { type: 'addLine', line: hàng('Đá riêng', 2), book: RONG },
    ])

    const gio = run([{ type: 'applyPriceMode', mode: 'wholesale', book: new Map([[1, 45_000]]) }], gốc)

    expect(gio.lines).toHaveLength(2)
    expect(gio.lines.map((line) => [line.unitPrice, line.note, line.qty])).toEqual([
      [45_000, 'Đá chung', 3],
      [45_000, 'Đá riêng', 2],
    ])
  })

  it('B14 · bật rồi tắt SỈ trả đúng giá lẻ, vẫn hai dòng, ghi chú nguyên vẹn', () => {
    const gốc = run([
      { type: 'addLine', line: hàng('Đá chung', 3), book: RONG },
      { type: 'addLine', line: hàng('Đá riêng', 2), book: RONG },
    ])

    const vòng = run(
      [
        { type: 'applyPriceMode', mode: 'wholesale', book: new Map([[1, 45_000]]) },
        { type: 'applyPriceMode', mode: 'retail', book: new Map() },
      ],
      gốc,
    )

    expect(vòng).toEqual(gốc)
  })

  it('B15 · nháp cũ thiếu cả priceSource lẫn ghi chú trong khoá → tính lại đủ, chạm thêm vẫn cộng dồn', () => {
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

  it('B16 · addLine không truyền note → khoá dùng chuỗi rỗng, không phải chữ "undefined"', () => {
    const gio = run([{ type: 'addLine', line: hàng(undefined, 1), book: RONG }])

    expect(gio.lines[0]?.note).toBe('')
    expect(gio.lines[0]?.key).not.toContain('undefined')
  })

  it('B17 · ghi chú chứa # hay @ không đụng khoá của dòng khác', () => {
    const gio = run([
      { type: 'addLine', line: hàng('ly #2', 1), book: RONG },
      { type: 'addLine', line: hàng(undefined, 1), book: RONG },
      { type: 'addLine', line: hàng('x@1', 1), book: RONG },
    ])

    expect(gio.lines).toHaveLength(3)
    expect(new Set(gio.lines.map((line) => line.key)).size).toBe(3)
  })

  it('hoàn lại một dòng đã bị gộp mất là KHÔNG LÀM GÌ, không cộng dồn số lượng lần hai', () => {
    // Dòng sống sót sau khi gộp mang đúng khoá của dòng bị nuốt, nên chốt chặn có sẵn ở `restoreLine`
    // ("dòng đã quay lại giỏ rồi thì hoàn lại là không làm gì") tự bắt được ca này. Số lượng của nó
    // đã được cộng vào dòng gộp rồi; chèn lại nữa là ghi thừa 3 ly vào đơn.
    const gốc = run([
      { type: 'addLine', line: hàng(undefined, 2), book: RONG },
      { type: 'addLine', line: hàng('Đá chung', 3), book: RONG },
    ])
    const bịGộp = gốc.lines[1] as CartLine

    const đãGộp = run([{ type: 'updateLine', key: khoá(gốc), qty: 2, unitPrice: 55_000, note: 'Đá chung' }], gốc)
    expect(đãGộp.lines).toHaveLength(1)
    expect(đãGộp.lines[0]?.qty).toBe(5)

    const gio = run([{ type: 'restoreLine', line: bịGộp }], đãGộp)

    expect(gio.lines).toHaveLength(1)
    expect(gio.lines[0]?.qty).toBe(5)
  })
})

describe('bật/tắt một nhãn trong ghi chú dòng', () => {
  it('T1 · ghi chú rỗng thì nhãn thành cả nội dung', () => {
    expect(toggleNoteToken('', 'Đá chung')).toBe('Đá chung')
  })

  it('T2 · nối vào cuối, không đè chữ người bán tự gõ', () => {
    expect(toggleNoteToken('ít đường', 'Đá chung')).toBe('ít đường, Đá chung')
  })

  it('T3 · bấm lại thì gỡ đúng nhãn đó, phần còn lại nguyên vẹn', () => {
    expect(toggleNoteToken('ít đường, Đá chung', 'Đá chung')).toBe('ít đường')
  })

  it('T4 · gỡ nhãn duy nhất thì ghi chú về rỗng', () => {
    expect(toggleNoteToken('Đá chung', 'Đá chung')).toBe('')
  })

  it('T5 · gỡ được cả khi nhãn đứng đầu', () => {
    expect(toggleNoteToken('Đá chung, ít đường', 'Đá chung')).toBe('ít đường')
  })

  it('T6 · khớp NGUYÊN phần tử: "Đá chung nhiều" không phải là nhãn "Đá chung"', () => {
    expect(toggleNoteToken('Đá chung nhiều', 'Đá chung')).toBe('Đá chung nhiều, Đá chung')
  })

  it('T7 · là toggle THUẦN, không biết luật loại trừ của nghiệp vụ đá', () => {
    expect(toggleNoteToken('Đá chung, Đá riêng', 'Đá riêng')).toBe('Đá chung')
  })

  it('T8 · trim từng phần trước khi so, khoảng trắng thừa không làm hụt nhãn', () => {
    expect(toggleNoteToken('ít đường ,  Đá chung', 'Đá chung')).toBe('ít đường')
  })

  it('H1 · thấy nhãn đang bật', () => {
    expect(hasNoteToken('ít đường, Đá chung', 'Đá chung')).toBe(true)
  })

  it('H2 · không có nhãn thì false', () => {
    expect(hasNoteToken('ít đường', 'Đá chung')).toBe(false)
  })

  it('H3 · "Đá chung nhiều" KHÔNG tính là có nhãn "Đá chung" — `includes` sẽ sai ở đây', () => {
    expect(hasNoteToken('Đá chung nhiều', 'Đá chung')).toBe(false)
  })

  it('H4 · ghi chú rỗng thì false', () => {
    expect(hasNoteToken('', 'Đá chung')).toBe(false)
  })
})
