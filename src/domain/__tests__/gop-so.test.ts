import { describe, expect, it } from 'vitest'
import { mergeLedgers } from '../gop-so'
import { testGid } from '@/test-fixtures'
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

  it('nhóm topping của B trỏ món đã nối vào món của A thì trỏ sang gid của món A', () => {
    const toppingOfB = { ...toppingGroup(40), toppings: [{ itemGid: testGid(22), price: null }] }
    const { merged } = mergeLedgers(ledgerA, { ...ledgerB, optionGroups: [toppingOfB] }, { items: { 1: 1 } })

    expect(merged.items.map((row) => row.gid)).toEqual([testGid(21)])
    expect(merged.optionGroups).toEqual([{ ...toppingOfB, toppings: [{ itemGid: testGid(21), price: null }] }])
  })

  it('nhóm topping của B trỏ món không được nối thì giữ nguyên gid món', () => {
    const toppingOfB = { ...toppingGroup(40), toppings: [{ itemGid: testGid(22), price: 3_000 }] }
    const { merged } = mergeLedgers(ledgerA, { ...ledgerB, optionGroups: [toppingOfB] })

    const [group] = merged.optionGroups
    expect(group?.kind === 'topping' ? group.toppings : null).toEqual([{ itemGid: testGid(22), price: 3_000 }])
  })

  it('nhóm của hai máy cùng có mặt, id nhóm của B được đánh số lại sau id lớn nhất của A', () => {
    const groupOfA = { ...toppingGroup(41), toppings: [{ itemGid: testGid(21), price: null }] }
    const groupOfB = { ...toppingGroup(40), toppings: [{ itemGid: testGid(22), price: null }] }
    const { merged } = mergeLedgers({ ...ledgerA, optionGroups: [groupOfA] }, { ...ledgerB, optionGroups: [groupOfB] })

    expect(merged.optionGroups.map((row) => [row.gid, row.id])).toEqual([
      [testGid(41), 1],
      [testGid(40), 2],
    ])
  })
})

function toppingGroup(sequence: number) {
  return {
    id: 1,
    gid: testGid(sequence),
    kind: 'topping' as const,
    name: 'Topping',
    required: 0 as const,
    maxSelect: null,
    defaultChoice: null,
    sortOrder: 1,
    isActive: 1 as const,
    createdAt: 1,
    updatedAt: 1,
    toppings: [] as { itemGid: string; price: number | null }[],
  }
}
