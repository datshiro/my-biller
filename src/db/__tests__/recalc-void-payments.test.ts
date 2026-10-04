import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  collectBackup,
  countPaymentsOnVoidOrders,
  mergeAllDataAndRecalculate,
  replaceAllData,
  replaceAllDataAndRecalculate,
} from '../backup'
import { db } from '../db'
import { recalcAll } from '../recalc'
import { findPaymentConflicts } from '@/domain/backup-merge'
import type { BackupData } from '@/domain/schema'
import { ledgerK, mk, shiftIds } from '@/domain/__tests__/backup-merge-fixtures'
import { installTestDevice } from '@/test-fixtures'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await installTestDevice()
})

/** Mọi khoản thu đang trừ vào một đơn đã huỷ — bất biến của `recalcAll` là danh sách này rỗng. */
async function paymentsOnVoidOrders() {
  const orders = await db.orders.toArray()
  const voids = new Set(orders.filter((order) => order.status === 'void').map((order) => order.id))
  return (await db.payments.toArray()).filter((payment) => voids.has(payment.allocatedOrderId))
}

/** Sổ K, với các khoản thu ở vị trí cho trước đang trừ vào đơn 2 (đã huỷ). */
function voidAllocatedAt(positions: ('first' | 'middle' | 'last')[]): BackupData {
  const data = ledgerK()
  const extra = (id: number) => mk.payment(id, 60 + id, 2, 5_000)
  const rows = [...data.payments]
  for (const position of positions) {
    if (position === 'first') rows.unshift(extra(10))
    if (position === 'middle') rows.splice(Math.floor(rows.length / 2), 0, extra(11))
    if (position === 'last') rows.push(extra(12))
  }
  return { ...data, payments: rows }
}

describe('recalcAll bỏ phân bổ mọi khoản thu trừ vào đơn đã huỷ', () => {
  it.each([[['last']], [['middle']], [['first']], [['first', 'middle', 'last']]] as const)(
    'khoản thu ở vị trí %j của bảng payments',
    async (positions) => {
      await replaceAllData(voidAllocatedAt([...positions]))

      await recalcAll()

      expect(await paymentsOnVoidOrders()).toEqual([])
    },
  )

  it('khoản thu trừ vào đơn huỷ là dòng có id lớn nhất (dòng cuối bảng)', async () => {
    const data = ledgerK()
    data.payments.push(mk.payment(99, 99, 3, 7_000))
    await replaceAllData(data)

    await recalcAll()

    expect((await db.payments.get(99))?.allocatedOrderId).toBe(0)
  })
})

describe('khôi phục không để khoản thu trừ vào đơn đã huỷ', () => {
  it('Ghi đè: file có khoản thu của đơn huỷ ở dòng cuối', async () => {
    const data = ledgerK()
    data.payments.push(mk.payment(99, 99, 3, 7_000))

    await replaceAllDataAndRecalculate(data)

    expect(await paymentsOnVoidOrders()).toEqual([])
  })

  it('Gộp: máy đã huỷ đơn, file cũ hơn còn khoản thu trừ vào đơn đó, chọn Thêm riêng', async () => {
    const device = ledgerK()
    device.orders[3] = { ...device.orders[3]!, status: 'void', paidAmount: 0, updatedAt: 9 }
    device.payments[2] = { ...device.payments[2]!, allocatedOrderId: 0, note: 'Đơn đã huỷ' }
    await replaceAllData(device)
    const file = shiftIds(ledgerK(), 10)
    const current = (await collectBackup(Date.now())).data
    const conflicts = findPaymentConflicts(current, file)

    await mergeAllDataAndRecalculate(
      file,
      Object.fromEntries(conflicts.map((conflict) => [conflict.gid, 'append' as const])),
      conflicts.map((conflict) => conflict.fingerprint),
    )

    expect(await db.payments.count()).toBe(device.payments.length + 1)
    expect(await paymentsOnVoidOrders()).toEqual([])
  })
})

describe('countPaymentsOnVoidOrders', () => {
  it('đếm đúng khoản thu còn trừ vào đơn đã huỷ (cho báo cáo sau khôi phục)', async () => {
    await replaceAllData(voidAllocatedAt(['first', 'last']))

    expect(await countPaymentsOnVoidOrders()).toBe(2)
    await recalcAll()
    expect(await countPaymentsOnVoidOrders()).toBe(0)
  })
})
