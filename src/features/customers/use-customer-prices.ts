import { useLiveQuery } from 'dexie-react-hooks'
import { buildPriceBook, listPriceBook } from '@/db/repositories/customer-prices'
import { listActiveItems } from '@/db/repositories/items'
import type { Item } from '@/domain/schema'

/** Món đã nằm trong DB thì chắc chắn có `id`; lọc một lần ở đây để màn ngoài không phải đỡ `undefined`. */
export type PricedItem = Item & { id: number }

export type PriceSheet = {
  /** Món **đã có giá riêng** đứng trước, phần còn lại giữ thứ tự danh mục (theo tên). */
  items: PricedItem[]
  prices: Map<number, number>
}

/**
 * Món đã ngừng bán không nằm trong danh sách (`listActiveItems`) nhưng dòng giá của nó **vẫn nằm
 * nguyên trong DB** — bán lại thì giá còn đó. Đổi lại: màn này không sửa được giá của món đã ngừng bán.
 */
export function useCustomerPriceSheet(customerId: number | null): PriceSheet | undefined {
  return useLiveQuery(async () => {
    if (customerId === null) return { items: [], prices: new Map<number, number>() }

    const [rows, all] = await Promise.all([listPriceBook(customerId), listActiveItems()])
    const prices = buildPriceBook(rows)
    const items = all.filter((item): item is PricedItem => item.id !== undefined)

    return {
      items: [...items.filter((item) => prices.has(item.id)), ...items.filter((item) => !prices.has(item.id))],
      prices,
    }
  }, [customerId])
}

/** Chỉ con số cho dòng "Bảng giá sỉ" ở màn chi tiết khách — không kéo theo cả danh mục. */
export function useCustomerPriceCount(customerId: number | null): number | undefined {
  return useLiveQuery(
    async () => (customerId === null ? 0 : (await listPriceBook(customerId)).length),
    [customerId],
  )
}
