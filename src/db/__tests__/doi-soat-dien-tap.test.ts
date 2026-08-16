import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { replaceAllData } from '../backup'
import { db } from '../db'
import { assertReconciled } from '@/domain/doi-soat'
import { mergeLedgers } from '@/domain/gop-so'
import { ledgerA, ledgerB } from '@/domain/__tests__/ledger-fixtures'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('diễn tập gộp hai sổ bằng fixture', () => {
  it('nhập kết quả vào Dexie sạch không mất dòng, không ghi đè id', async () => {
    const { merged } = mergeLedgers(ledgerA, ledgerB)
    assertReconciled(ledgerA, ledgerB, merged)

    await replaceAllData(merged)

    expect(await db.customers.count()).toBe(2)
    expect(await db.items.count()).toBe(2)
    expect(await db.orders.count()).toBe(5)
    expect(await db.orderLines.count()).toBe(5)
    expect(await db.payments.count()).toBe(3)
    expect(await db.expenses.count()).toBe(2)
    expect((await db.orders.toArray()).map((row) => row.gid).sort()).toEqual(
      merged.orders.map((row) => row.gid).sort(),
    )
  })
})
