import { db } from '../db'
import { newGid } from '@/domain/gid'
import { CustomerPriceSchema, type CustomerPrice } from '@/domain/schema'
import { syncTransaction } from '../sync/outbox'

/** `null` = xoá dòng giá riêng. `0` = một giá thật, lưu lại. Không có giá trị đặc biệt nào khác. */
export type PriceEntry = { itemId: number; unitPrice: number | null }

const now = () => Date.now()

export function listPriceBook(customerId: number): Promise<CustomerPrice[]> {
  return db.customerPrices.where('customerId').equals(customerId).toArray()
}

/**
 * Cả bảng giá lưu trong **một** transaction: nửa lưu được nửa không thì người bán không có cách nào
 * biết ô nào đã vào.
 */
export async function savePriceBook(customerId: number, entries: readonly PriceEntry[]): Promise<void> {
  await syncTransaction(async () => {
    for (const { itemId, unitPrice } of entries) {
      const existing = await db.customerPrices.where('[customerId+itemId]').equals([customerId, itemId]).first()

      if (unitPrice === null) {
        if (existing?.id !== undefined) await db.customerPrices.delete(existing.id)
        continue
      }

      const stamp = now()
      // Khoá chính là `++id` còn uniqueness nằm ở index phụ, nên `put` một object **không có `id`** sẽ
      // được cấp id mới rồi đụng `&[customerId+itemId]` → ConstraintError, rollback cả transaction và
      // mọi ô người bán vừa gõ mất sạch. Phải tra dòng cũ rồi mang `id` của nó theo.
      await db.customerPrices.put(
        CustomerPriceSchema.parse({
          ...existing,
          gid: existing?.gid ?? newGid(),
          customerId,
          itemId,
          unitPrice,
          createdAt: existing?.createdAt ?? stamp,
          updatedAt: stamp,
        }),
      )
    }
  })
}

/**
 * Cửa đọc. Một `unitPrice` bẩn (bản build cũ, sửa tay qua DevTools) chảy tới `cartTotals` sẽ ném ngay
 * trong thân render và chiếm màn hình giữa lúc đang bán — thà bỏ đúng dòng đó.
 */
export function buildPriceBook(rows: readonly CustomerPrice[]): Map<number, number> {
  const book = new Map<number, number>()
  for (const row of rows) {
    if (!Number.isInteger(row.unitPrice) || row.unitPrice < 0) {
      console.error('Bỏ qua giá riêng không hợp lệ:', row)
      continue
    }
    book.set(row.itemId, row.unitPrice)
  }
  return book
}

export function deleteByItem(itemId: number): Promise<number> {
  return db.customerPrices.where('itemId').equals(itemId).delete()
}

export function deleteByCustomer(customerId: number): Promise<number> {
  return db.customerPrices.where('customerId').equals(customerId).delete()
}
