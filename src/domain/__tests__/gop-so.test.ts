import { describe, expect, it } from 'vitest'
import { mergeLedgers } from '../gop-so'
import { ledgerA, ledgerB } from './ledger-fixtures'

describe('mergeLedgers', () => {
  it('dịch id/khoá ngoại, đổi mã trùng và giữ dấu chưa phân bổ', () => {
    const { merged, report } = mergeLedgers(ledgerA, ledgerB)

    expect(merged.orders).toHaveLength(5)
    expect(new Set(merged.orders.map((row) => row.id)).size).toBe(5)
    expect(new Set(merged.orders.map((row) => row.code)).size).toBe(5)
    expect(report.codeChanges.map((row) => [row.originalCode, row.code])).toEqual([
      ['PBH-260809-001', 'PBH-260809-B002'],
      ['PBH-260809-002', 'PBH-260809-B003'],
    ])
    expect(merged.orders.filter((row) => row.originalCode).map((row) => row.originalCode)).toEqual([
      'PBH-260809-001',
      'PBH-260809-002',
    ])
    expect(merged.payments.find((row) => row.gid === ledgerB.payments[1]?.gid)?.allocatedOrderId).toBe(0)

    const shiftedLine = merged.orderLines.find((row) => row.gid === ledgerB.orderLines[0]?.gid)
    expect(shiftedLine).toMatchObject({ orderId: 3, itemId: 2 })
  })

  it('không tự gộp hai khách cùng tên; chỉ gộp khi có quyết định tường minh', () => {
    expect(mergeLedgers(ledgerA, ledgerB).merged.customers).toHaveLength(2)

    const result = mergeLedgers(ledgerA, ledgerB, { customers: { 1: 1 } })
    expect(result.merged.customers).toHaveLength(1)
    expect(result.merged.orders.every((row) => row.customerId === 1)).toBe(true)
  })

  it('chạy hai lần cho kết quả giống hệt', () => {
    expect(mergeLedgers(ledgerA, ledgerB)).toEqual(mergeLedgers(ledgerA, ledgerB))
  })
})
