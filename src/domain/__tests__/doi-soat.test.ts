import { describe, expect, it } from 'vitest'
import { groupDebts, totalDebt } from '../debt'
import { assertReconciled, ledgerTotals } from '../doi-soat'
import { mergeLedgers } from '../gop-so'
import type { BackupData, Payment } from '../schema'
import { ledgerA, ledgerB } from './ledger-fixtures'
import { testGid } from '@/test-fixtures'

const at = new Date(2026, 7, 9, 10).getTime()

/** Một khách, một đơn nợ, và các phiếu thu chưa gắn đơn truyền vào — mọi thứ khác để trống. */
function ledgerWithCredit(
  orderTotal: number,
  payments: Array<Pick<Payment, 'amount'> & { unallocatedStatus?: Payment['unallocatedStatus'] }>,
  customers: BackupData['customers'] = [
    { id: 1, gid: testGid(901), name: 'Chị Tư', phone: '0903', address: '', note: '', createdAt: 1, updatedAt: 1 },
  ],
): BackupData {
  return {
    settings: [],
    itemGroups: [],
    items: [],
    customers,
    customerPrices: [],
    orders: [
      {
        id: 1,
        gid: testGid(902),
        code: 'PBH-260809-T001',
        originalCode: '',
        customerId: 1,
        customerName: 'Chị Tư',
        subtotal: orderTotal,
        discount: 0,
        surcharge: 0,
        total: orderTotal,
        paidAmount: 0,
        status: 'unpaid',
        soldAt: at,
        note: '',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    orderLines: [],
    payments: payments.map((payment, index) => ({
      id: index + 1,
      gid: testGid(910 + index),
      orderId: 1,
      allocatedOrderId: 0,
      customerId: 1,
      amount: payment.amount,
      method: 'cash' as const,
      paidAt: at + index,
      note: '',
      ...(payment.unallocatedStatus ? { unallocatedStatus: payment.unallocatedStatus } : {}),
    })),
    expenseCategories: [],
    expenses: [],
  }
}

describe('assertReconciled', () => {
  it('đối chiếu doanh thu, chi, đã thu và nợ từng khách chính xác tới đồng', () => {
    const { merged } = mergeLedgers(ledgerA, ledgerB)
    const totals = assertReconciled(ledgerA, ledgerB, merged)

    expect(totals).toMatchObject({ revenue: 250_000, expenses: 25_000, collected: 140_000 })
    expect([...totals.debtByCustomerGid.values()]).toEqual([100_000, 10_000])
  })

  it('ném nếu kết quả gộp lệch dù một đồng', () => {
    const { merged } = mergeLedgers(ledgerA, ledgerB)
    const broken = {
      ...merged,
      expenses: merged.expenses.map((row, index) =>
        index === 0 ? { ...row, amount: row.amount + 1 } : row,
      ),
    }
    expect(() => assertReconciled(ledgerA, ledgerB, broken)).toThrow(/chi phí/)
  })

  it('nợ không âm khi tiền chưa gắn lớn hơn phần còn nợ', () => {
    const overpaid = {
      ...ledgerB,
      payments: ledgerB.payments.map((row) =>
        row.allocatedOrderId === 0 ? { ...row, amount: 99_000 } : row,
      ),
    }
    expect([...ledgerTotals(overpaid).debtByCustomerGid.values()]).toEqual([])
  })
})

describe('ledgerTotals dùng cùng định nghĩa phiếu thu với Báo cáo và Công nợ', () => {
  it('phiếu đã trả lại khách không cộng vào đã thu và không trừ vào nợ', () => {
    const ledger = ledgerWithCredit(100_000, [
      { amount: 30_000 },
      { amount: 20_000, unallocatedStatus: 'refunded' },
    ])
    const totals = ledgerTotals(ledger)

    expect(totals.collected).toBe(30_000)
    expect(totals.debtTotal).toBe(70_000)
    expect(totals.debtByCustomerGid.get(testGid(901))).toBe(70_000)
  })

  it('nợ gộp đổi có chủ ý khi tín dụng từng vượt nợ, còn assertReconciled vẫn xanh', () => {
    // Trước khi lọc, 80k + 50k tín dụng nuốt trọn đơn 100k và groupDebts kẹp về 0.
    // Bỏ phiếu refunded ra thì chỉ còn 80k, đơn còn nợ 20k — con số nợ thật sự khác đi.
    const ledger = ledgerWithCredit(100_000, [
      { amount: 80_000 },
      { amount: 50_000, unallocatedStatus: 'refunded' },
    ])
    const debtIfEveryPaymentCounted = totalDebt(groupDebts(ledger.orders, new Map([[1, 130_000]])))
    expect(debtIfEveryPaymentCounted).toBe(0)

    const totals = ledgerTotals(ledger)
    expect(totals.debtTotal).toBe(20_000)
    expect(totals.debtTotal).not.toBe(debtIfEveryPaymentCounted)

    const { merged } = mergeLedgers(ledgerA, ledger)
    expect(() => assertReconciled(ledgerA, ledger, merged)).not.toThrow()
  })

  it('đơn nợ của khách không còn trong bảng customers vẫn nằm trong debtTotal', () => {
    const ledger = ledgerWithCredit(100_000, [], [])
    const totals = ledgerTotals(ledger)

    // Cùng định nghĩa với summarizeDebt của Công nợ: gom mọi nhóm nợ, không tra gid.
    expect(totals.debtTotal).toBe(totalDebt(groupDebts(ledger.orders)))
    expect(totals.debtTotal).toBe(100_000)
    expect([...totals.debtByCustomerGid.values()].reduce((sum, amount) => sum + amount, 0)).toBe(0)
  })
})
