// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ReceiptView } from '../receipt-view'
import { DEFAULT_SHOP, type Order, type OrderLine } from '@/domain/schema'
import { testGid } from '@/test-fixtures'

afterEach(cleanup)

const order = {
  id: 1,
  gid: testGid(1),
  code: 'PBH-260926-A001',
  customerName: 'Khách lẻ',
  soldAt: new Date(2026, 8, 26, 9, 5).getTime(),
  subtotal: 66_000,
  discount: 0,
  surcharge: 0,
  total: 66_000,
  paidAmount: 66_000,
  status: 'paid',
  note: '',
} as Order

const line = (over: Partial<OrderLine> = {}): OrderLine => ({
  id: 1,
  gid: testGid(2),
  orderId: 1,
  itemId: 1,
  name: 'Cà phê sữa',
  unit: 'ly',
  unitPrice: 20_000,
  costPrice: null,
  qty: 2,
  amount: 66_000,
  note: '',
  options: [],
  toppings: [],
  ...over,
})

const renderLines = (lines: OrderLine[]) =>
  render(<ReceiptView shop={DEFAULT_SHOP} order={order} lines={lines} payments={[]} priorDebt={0} totalDue={0} debtAsOf={null} />)

describe('ReceiptView với tuỳ chọn và topping', () => {
  it('liệt kê từng topping kèm giá một ly dưới tên món; Đ.GIÁ đã gồm topping nên SL × Đ.GIÁ = T.tiền', () => {
    const { container } = renderLines([
      line({
        options: ['Ít đường'],
        note: 'mang về',
        toppings: [
          { name: 'Trân châu', unitPrice: 5_000, qty: 2 },
          { name: 'Thạch', unitPrice: 3_000, qty: 1 },
        ],
      }),
    ])
    const row = container.querySelector('tbody tr') as HTMLElement
    const cells = [...row.querySelectorAll('td')].map((td) => td.textContent ?? '')

    expect(cells[0]).toContain('+ Trân châu x2')
    expect(cells[0]).toContain('10.000')
    expect(cells[0]).toContain('+ Thạch')
    expect(cells[0]).toContain('3.000')
    expect(cells[0]).toContain('Ít đường, mang về')
    expect(cells[1]).toBe('2')
    expect(cells[2]).toBe('33.000')
    expect(cells[3]).toBe('66.000')
  })

  it('dòng cũ không tuỳ chọn, không topping: giữ nguyên bố cục, đơn giá là giá ly', () => {
    const { container } = renderLines([line({ amount: 40_000, note: 'ít hành' })])
    const row = container.querySelector('tbody tr') as HTMLElement
    const cells = [...row.querySelectorAll('td')].map((td) => td.textContent ?? '')

    expect(cells[0]).toBe('Cà phê sữa (ly)ít hành')
    expect(cells[2]).toBe('20.000')
    expect(row.textContent).not.toContain('+ ')
  })
})
