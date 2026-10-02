import { describe, expect, it } from 'vitest'
import {
  hasNotePhrase,
  hasOwnMenu,
  ICE_OPTION_GROUP,
  optionGroupsFor,
  orphanOptions,
  recentNotePhrases,
  setToppingQty,
  toggleNotePhrase,
  toggleOption,
  toppingAmount,
  toppingLabel,
} from '../line-extras'

const duong = { name: 'Đường', choices: ['Ít đường', 'Không đường', 'Nhiều đường'] }

describe('optionGroupsFor', () => {
  it('nhóm Đá luôn đứng đầu và có cho cả món chưa phân nhóm', () => {
    expect(optionGroupsFor(undefined)).toEqual([ICE_OPTION_GROUP])
    expect(optionGroupsFor({ optionGroups: [duong] })).toEqual([ICE_OPTION_GROUP, duong])
  })
})

describe('toggleOption', () => {
  it('chọn một lựa chọn rồi bấm lại thì gỡ', () => {
    expect(toggleOption([], duong, 'Ít đường')).toEqual(['Ít đường'])
    expect(toggleOption(['Ít đường'], duong, 'Ít đường')).toEqual([])
  })

  it('trong một nhóm chỉ có một lựa chọn: chọn cái khác thì THAY, nhãn của nhóm khác giữ nguyên', () => {
    expect(toggleOption(['Đá riêng', 'Ít đường'], duong, 'Không đường')).toEqual(['Đá riêng', 'Không đường'])
  })

  it('hai nhóm độc lập nhau', () => {
    const afterIce = toggleOption(['Ít đường'], ICE_OPTION_GROUP, 'Đá chung')
    expect(afterIce).toEqual(['Ít đường', 'Đá chung'])
    expect(toggleOption(afterIce, ICE_OPTION_GROUP, 'Đá riêng')).toEqual(['Ít đường', 'Đá riêng'])
  })
})

describe('orphanOptions', () => {
  it('nhãn không thuộc nhóm nào (nhóm đã bị xoá, đơn cũ) vẫn lộ ra để gỡ được', () => {
    expect(orphanOptions(['Ít đường', 'Giảm trà'], [duong])).toEqual(['Giảm trà'])
    expect(orphanOptions([], [duong])).toEqual([])
  })
})

describe('setToppingQty', () => {
  const tranChau = { name: 'Trân châu', price: 5_000 }

  it('thêm lần đầu lấy giá thực đơn, tăng số phần giữ NGUYÊN giá lúc chọn dù thực đơn đã đổi giá', () => {
    const one = setToppingQty([], tranChau, 1)
    expect(one).toEqual([{ name: 'Trân châu', unitPrice: 5_000, qty: 1 }])

    const repriced = { name: 'Trân châu', price: 9_000 }
    expect(setToppingQty(one, repriced, 2)).toEqual([{ name: 'Trân châu', unitPrice: 5_000, qty: 2 }])
  })

  it('số phần 0 hoặc âm thì gỡ topping, topping khác nguyên vẹn', () => {
    const both = [
      { name: 'Trân châu', unitPrice: 5_000, qty: 2 },
      { name: 'Thạch', unitPrice: 3_000, qty: 1 },
    ]
    expect(setToppingQty(both, tranChau, 0)).toEqual([{ name: 'Thạch', unitPrice: 3_000, qty: 1 }])
    expect(setToppingQty(both, tranChau, -1)).toHaveLength(1)
  })
})

describe('nhãn topping', () => {
  it('một phần thì chỉ tên, từ hai phần có "x2"; tiền = giá × số phần', () => {
    expect(toppingLabel({ name: 'Thạch', qty: 1 })).toBe('Thạch')
    expect(toppingLabel({ name: 'Trân châu', qty: 2 })).toBe('Trân châu x2')
    expect(toppingAmount({ unitPrice: 5_000, qty: 2 })).toBe(10_000)
  })
})

describe('hasOwnMenu', () => {
  it('chỉ nhóm món có tuỳ chọn hay topping riêng mới tính; nhóm Đá có sẵn không tính', () => {
    expect(hasOwnMenu(undefined)).toBe(false)
    expect(hasOwnMenu({ optionGroups: [], toppingMenu: [] })).toBe(false)
    expect(hasOwnMenu({ optionGroups: [duong], toppingMenu: [] })).toBe(true)
    expect(hasOwnMenu({ optionGroups: [], toppingMenu: [{ name: 'Thạch', price: 3_000 }] })).toBe(true)
  })
})

describe('toggleNotePhrase', () => {
  it('thêm cụm vào cuối, ngăn bằng dấu phẩy', () => {
    expect(toggleNotePhrase('', 'mang về')).toBe('mang về')
    expect(toggleNotePhrase('không hành', 'mang về')).toBe('không hành, mang về')
  })

  it('bấm lại thì gỡ đúng cụm đó, không phân biệt hoa thường, chữ tự gõ còn nguyên', () => {
    expect(toggleNotePhrase('không hành, Mang về, gói kỹ nhé', 'mang về')).toBe('không hành, gói kỹ nhé')
    expect(hasNotePhrase('không hành, Mang về', 'mang về')).toBe(true)
    expect(hasNotePhrase('mang về sau', 'mang về')).toBe(false)
  })

  it('dấu phẩy thập phân không phải chỗ ngăn cụm', () => {
    expect(toggleNotePhrase('thêm 1,5 lạng', 'mang về')).toBe('thêm 1,5 lạng, mang về')
    expect(toggleNotePhrase('thêm 1,5 lạng, mang về', 'mang về')).toBe('thêm 1,5 lạng')
    expect(recentNotePhrases(['thêm 1,5 lạng'], 6)).toEqual(['thêm 1,5 lạng'])
  })
})

describe('recentNotePhrases', () => {
  it('xếp theo số lần dùng, hoà thì cụm gần hơn đứng trước, giữ cách viết của lần gần nhất', () => {
    const notes = ['Mang về', 'ít đá', 'không hành, mang về', '', 'ít đá, cay']
    expect(recentNotePhrases(notes, 6)).toEqual(['Mang về', 'ít đá', 'không hành', 'cay'])
    expect(recentNotePhrases(notes, 2)).toEqual(['Mang về', 'ít đá'])
    expect(recentNotePhrases([], 6)).toEqual([])
  })

  it('bỏ cụm trùng một lựa chọn đã có chip riêng (ghi chú đá của bản cũ) trước khi cắt giới hạn', () => {
    const notes = ['Đá riêng', 'đá riêng, mang về', 'Đá chung', 'ít hành']
    expect(recentNotePhrases(notes, 2, ['Đá chung', 'Đá riêng'])).toEqual(['mang về', 'ít hành'])
  })

  it('bỏ cụm dài hơn giới hạn chip trước khi cắt số lượng', () => {
    const notes = ['không lấy ống hút để đá riêng ra túi nylon gói kỹ giúp em', 'cay', 'mang về']
    expect(recentNotePhrases(notes, 2, [], 24)).toEqual(['cay', 'mang về'])
  })
})
