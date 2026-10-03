import { describe, expect, it } from 'vitest'
import {
  buildRestoreReport,
  expectedAfterReplace,
  toReportActual,
  withDerivedPaid,
  type RestoreActual,
} from '../backup-report'
import { ledgerTotals } from '../doi-soat'
import { emptyLedger, ledgerK, mk } from './backup-merge-fixtures'

function actualOf(data: ReturnType<typeof ledgerK>): RestoreActual {
  const { data: derived } = withDerivedPaid(data)
  return {
    counts: {
      itemGroups: data.itemGroups.length,
      items: data.items.length,
      customers: data.customers.length,
      customerPrices: data.customerPrices.length,
      orders: data.orders.length,
      orderLines: data.orderLines.length,
      payments: data.payments.length,
      expenseCategories: data.expenseCategories.length,
      expenses: data.expenses.length,
    },
    debtTotal: ledgerTotals(derived).debtTotal,
  }
}

describe('withDerivedPaid', () => {
  it('đơn huỷ về paidAmount 0, khoản thu trỏ đơn huỷ thôi trừ vào đơn, trạng thái theo deriveStatus', () => {
    const data = {
      ...emptyLedger(),
      customers: [mk.customer(1, 1)],
      orders: [
        mk.order(1, 10, 100_000, { status: 'void', paidAmount: 40_000 }),
        mk.order(2, 11, 100_000, { status: 'unpaid' }),
        mk.order(3, 12, 50_000, { status: 'unpaid' }),
        mk.order(4, 13, 80_000, { status: 'paid', paidAmount: 80_000 }),
      ],
      payments: [
        mk.payment(1, 20, 1, 40_000),
        mk.payment(2, 21, 2, 30_000),
        mk.payment(3, 22, 3, 50_000),
      ],
    }

    const { data: derived, overpaidOrders } = withDerivedPaid(data)

    expect(derived.orders.map(({ paidAmount, status }) => ({ paidAmount, status }))).toEqual([
      { paidAmount: 0, status: 'void' },
      { paidAmount: 30_000, status: 'partial' },
      { paidAmount: 50_000, status: 'paid' },
      { paidAmount: 0, status: 'unpaid' },
    ])
    expect(derived.payments.map((row) => row.allocatedOrderId)).toEqual([0, 2, 3])
    expect(overpaidOrders).toBe(0)
  })

  it('không đóng dấu updatedAt và không sửa đầu vào', () => {
    const data = { ...emptyLedger(), orders: [mk.order(1, 10, 100_000, { paidAmount: 5, updatedAt: 7 })], customers: [mk.customer(1, 1)] }
    const frozen = structuredClone(data)

    const { data: derived } = withDerivedPaid(data)

    expect(derived.orders[0]).toMatchObject({ paidAmount: 0, status: 'unpaid', updatedAt: 7 })
    expect(data).toEqual(frozen)
  })

  /**
   * Cùng một lần trả tiền thật ghi ở hai máy chưa ghép ⇒ hai gid khác nhau, gộp theo gid không thấy
   * trùng. Dấu vết duy nhất còn lại là đơn thu vượt tổng — `recalcAll` không kẹp, nên ở đây cũng không.
   */
  it('đếm đơn có tiền thu vượt tổng, giữ nguyên số vượt như recalcAll', () => {
    const data = {
      ...emptyLedger(),
      customers: [mk.customer(1, 1)],
      orders: [mk.order(1, 10, 100_000), mk.order(2, 11, 50_000, { status: 'void' })],
      payments: [
        mk.payment(1, 20, 1, 100_000),
        mk.payment(2, 21, 1, 100_000),
        mk.payment(3, 22, 2, 90_000),
      ],
    }

    const { data: derived, overpaidOrders } = withDerivedPaid(data)

    expect(derived.orders[0]).toMatchObject({ paidAmount: 200_000, status: 'paid' })
    expect(overpaidOrders).toBe(1)
  })

  it('khoản thu đã trả lại / bỏ mà vẫn trừ vào đơn vẫn cộng vào paidAmount — đúng như recalcAll', () => {
    const data = {
      ...emptyLedger(),
      customers: [mk.customer(1, 1)],
      orders: [mk.order(1, 10, 100_000)],
      payments: [mk.payment(1, 20, 1, 40_000, { unallocatedStatus: 'refunded' })],
    }

    expect(withDerivedPaid(data).data.orders[0]?.paidAmount).toBe(40_000)
  })
})

describe('buildRestoreReport', () => {
  it('khớp ⇒ ok, năm dòng luôn hiện', () => {
    const expected = withDerivedPaid(ledgerK())

    const report = buildRestoreReport(expected, actualOf(ledgerK()))

    expect(report.ok).toBe(true)
    expect(report.rows.map((row) => row.key)).toEqual(['orders', 'customers', 'items', 'payments', 'debtTotal'])
    expect(report.rows.find((row) => row.key === 'debtTotal')).toMatchObject({ expected: 490_000, actual: 490_000, matches: true })
    expect(report.overpaidOrders).toBe(0)
  })

  it('thiếu một đơn ⇒ dòng đơn lệch, ok=false', () => {
    const actual = actualOf(ledgerK())
    actual.counts.orders -= 1

    const report = buildRestoreReport(withDerivedPaid(ledgerK()), actual)

    expect(report.ok).toBe(false)
    expect(report.rows.find((row) => row.key === 'orders')).toMatchObject({ expected: 4, actual: 3, matches: false })
  })

  it('thiếu một khoản thu ⇒ dòng khoản thu lệch', () => {
    const actual = actualOf(ledgerK())
    actual.counts.payments -= 1

    const report = buildRestoreReport(withDerivedPaid(ledgerK()), actual)

    expect(report.ok).toBe(false)
    expect(report.rows.find((row) => row.key === 'payments')?.matches).toBe(false)
  })

  it('lệch tổng nợ 1 đ ⇒ dòng tổng nợ lệch', () => {
    const actual = actualOf(ledgerK())
    actual.debtTotal += 1

    const report = buildRestoreReport(withDerivedPaid(ledgerK()), actual)

    expect(report.ok).toBe(false)
    expect(report.rows.find((row) => row.key === 'debtTotal')?.matches).toBe(false)
  })

  it('bảng ngoài năm dòng chính chỉ hiện khi lệch', () => {
    const actual = actualOf(ledgerK())
    actual.counts.expenses += 1

    const report = buildRestoreReport(withDerivedPaid(ledgerK()), actual)

    expect(report.ok).toBe(false)
    expect(report.rows.map((row) => row.key)).toEqual(['orders', 'customers', 'items', 'payments', 'expenses', 'debtTotal'])
  })

  it('mang theo số đơn thu vượt tổng của bản kỳ vọng', () => {
    const data = ledgerK()
    data.payments.push(mk.payment(9, 29, 4, 60_000))

    expect(buildRestoreReport(withDerivedPaid(data), actualOf(data)).overpaidOrders).toBe(1)
  })
})

describe('toReportActual', () => {
  it('đổi dạng của getLedgerOverview sang dạng đối chiếu', () => {
    const actual = toReportActual({
      totals: { debtTotal: 12 },
      counts: [
        { table: 'orders', count: 3 },
        { table: 'payments', count: 2 },
      ],
    })

    expect(actual.debtTotal).toBe(12)
    expect(actual.counts.orders).toBe(3)
    expect(actual.counts.payments).toBe(2)
    expect(actual.counts.items).toBe(0)
  })
})

describe('expectedAfterReplace', () => {
  it('lọc dòng giá rác giống replaceLedger rồi dựng lại tiền', () => {
    const data = ledgerK()
    data.customerPrices.push(mk.price(9, 99, 404, 404))
    data.orders[0] = { ...data.orders[0]!, paidAmount: 999 }

    const { data: expected } = expectedAfterReplace(data)

    expect(expected.customerPrices).toHaveLength(1)
    expect(expected.orders[0]?.paidAmount).toBe(0)
  })
})
