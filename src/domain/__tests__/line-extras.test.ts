import { describe, expect, it } from 'vitest'
import {
  ICE_OPTION_GROUP,
  optionGroupsFor,
  orphanOptions,
  setToppingQty,
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
