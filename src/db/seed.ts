import { startOfDay } from 'date-fns'
import { db } from './db'
import { createOrder } from './repositories/orders'
import { createCustomer } from './repositories/customers'
import { createExpense, createExpenseCategory } from './repositories/expenses'
import { createGroup, createItem } from './repositories/items'
import { saveShop } from './repositories/settings'

const DAY = 86_400_000

/** Dữ liệu mẫu cho lúc dev. Chỉ gọi khi `import.meta.env.DEV` — bản build không được chạy hàm này. */
export async function seedDemoData(): Promise<void> {
  if ((await db.items.count()) > 0) return

  await saveShop({ name: 'Quán Cơm Bà Tư', phone: '0909 123 456', address: '12 Lê Lợi, Q1' })

  const doAn = await createGroup({ name: 'Đồ ăn', sortOrder: 1 })
  const doUong = await createGroup({ name: 'Đồ uống', sortOrder: 2 })

  const items = await Promise.all([
    createItem({ name: 'Phở bò đặc biệt', groupId: doAn, unit: 'tô', unitPrice: 55_000, costPrice: 30_000, isActive: 1 }),
    createItem({ name: 'Cơm tấm sườn', groupId: doAn, unit: 'đĩa', unitPrice: 45_000, costPrice: 24_000, isActive: 1 }),
    createItem({ name: 'Trà đá', groupId: doUong, unit: 'ly', unitPrice: 3_000, costPrice: 500, isActive: 1 }),
    createItem({ name: 'Cà phê sữa', groupId: doUong, unit: 'ly', unitPrice: 20_000, costPrice: 8_000, isActive: 1 }),
  ])

  const anh = await createCustomer({ name: 'Anh Hùng', phone: '0912 345 678', address: '', note: 'Khách quen, hay ghi sổ' })

  const now = Date.now()
  // Đơn "hôm nay" phải rơi vào hôm nay kể cả khi chạy lúc 0-2h sáng: `now - 2h` lúc 00:55 là 22:55 hôm
  // qua, và mọi ca kiểm tra theo ngày trong `test:live` đọc ra số 0.
  const homNay = Math.max(startOfDay(now).getTime(), now - 2 * 60 * 60 * 1000)

  await createOrder({
    customerId: null,
    customerName: 'Khách lẻ',
    lines: [
      { itemId: items[0] ?? null, name: 'Phở bò đặc biệt', unit: 'tô', unitPrice: 55_000, costPrice: 30_000, qty: 2 },
      { itemId: items[2] ?? null, name: 'Trà đá', unit: 'ly', unitPrice: 3_000, costPrice: 500, qty: 2 },
    ],
    discount: 0,
    surcharge: 0,
    soldAt: now - DAY,
    note: '',
    payment: { amount: 116_000, method: 'cash', note: '' },
  })

  await createOrder({
    customerId: anh,
    customerName: 'Anh Hùng',
    lines: [
      { itemId: items[1] ?? null, name: 'Cơm tấm sườn', unit: 'đĩa', unitPrice: 45_000, costPrice: 24_000, qty: 3 },
      { itemId: items[3] ?? null, name: 'Cà phê sữa', unit: 'ly', unitPrice: 20_000, costPrice: 8_000, qty: 1 },
    ],
    discount: 5_000,
    surcharge: 0,
    soldAt: homNay,
    note: 'Ghi sổ',
    payment: { amount: 50_000, method: 'cash', note: 'Trả trước' },
  })

  const nguyenLieu = await createExpenseCategory({ name: 'Nguyên liệu' })
  await createExpense({ categoryId: nguyenLieu, amount: 1_200_000, note: 'Chợ đầu mối', spentAt: now - DAY })
}
