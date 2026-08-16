import { describe, expect, it } from 'vitest'
import { assertReconciled, ledgerTotals } from '../doi-soat'
import { mergeLedgers } from '../gop-so'
import { ledgerA, ledgerB } from './ledger-fixtures'

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
