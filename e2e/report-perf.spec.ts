import { expect, test, type Page } from '@playwright/test'

/**
 * Máy người bán là điện thoại rẻ tiền và dữ liệu chỉ có tăng. fake-indexeddb chạy trong bộ nhớ nên
 * không nói được gì về IndexedDB thật — chỉ đo trong trình duyệt mới biết màn Báo cáo có kịp không.
 *
 * Nạp thẳng vào object store bằng IndexedDB thuần: đi qua repository thì 5.000 đơn mất vài phút và
 * bài đo này chỉ quan tâm tới lúc đọc.
 */
const ORDERS = 5_000
const BUDGET_MS = 300

async function seedOrders(page: Page, count: number) {
  return page.evaluate(async (total) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('my-biller')
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })

    const start = new Date()
    start.setDate(1)
    start.setHours(9, 0, 0, 0)
    const stamp = Date.now()

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['orders', 'orderLines', 'payments'], 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)

      const orders = tx.objectStore('orders')
      const lines = tx.objectStore('orderLines')
      const payments = tx.objectStore('payments')

      for (let i = 0; i < total; i += 1) {
        const orderId = i + 1
        // Rải đều trong tháng đang xem: đây là trường hợp nặng nhất, cả 5.000 đơn đều lọt vào kỳ.
        const soldAt = start.getTime() + (i % 28) * 86_400_000 + i * 1_000
        orders.put({
          id: orderId,
          code: `PERF${orderId}`,
          customerId: null,
          customerName: 'Khách lẻ',
          subtotal: 85_000,
          discount: 0,
          surcharge: 0,
          total: 85_000,
          paidAmount: 85_000,
          status: 'paid',
          soldAt,
          note: '',
          createdAt: stamp,
          updatedAt: stamp,
        })
        lines.put({
          orderId,
          itemId: 1,
          name: 'Phở bò',
          unit: 'tô',
          unitPrice: 55_000,
          costPrice: 30_000,
          qty: 1,
          amount: 55_000,
        })
        lines.put({
          orderId,
          itemId: 2,
          name: 'Trà đá',
          unit: 'ly',
          unitPrice: 3_000,
          costPrice: 500,
          qty: 10,
          amount: 30_000,
        })
        payments.put({
          orderId,
          customerId: null,
          amount: 85_000,
          method: 'cash',
          paidAt: soldAt,
          note: '',
        })
      }
    })

    db.close()
    return total
  }, count)
}

test(`màn Báo cáo hiện số dưới ${BUDGET_MS}ms với ${ORDERS} đơn`, async ({ page }) => {
  await page.goto('/')
  expect(await seedOrders(page, ORDERS)).toBe(ORDERS)
  await page.reload()

  // Bấm tab rồi đo tới lúc con số lãi có mặt trong DOM — đúng thứ người bán chờ, không phải thời
  // gian query. Mốc bắt đầu lấy ngay trong trình duyệt để không dính độ trễ điều khiển từ xa.
  const shown = page.evaluate(() => {
    return new Promise<number>((resolve) => {
      let tapped = 0
      document.addEventListener('click', () => (tapped = performance.now()), {
        capture: true,
        once: true,
      })
      const seen = () => /LỢI NHUẬN|LỖ/.test(document.body.textContent ?? '')
      const observer = new MutationObserver(() => {
        if (!tapped || !seen()) return
        observer.disconnect()
        resolve(performance.now() - tapped)
      })
      observer.observe(document.body, { subtree: true, childList: true, characterData: true })
    })
  })

  await page.getByRole('link', { name: 'Báo cáo' }).click()
  const elapsed = await shown

  console.log(`Báo cáo: ${Math.round(elapsed)}ms với ${ORDERS} đơn / ${ORDERS * 2} dòng hàng`)

  // 5.000 × 85.000: đo mà số ra sai thì con số ms không có nghĩa gì.
  await expect(page.getByText('425.000.000', { exact: true }).first()).toBeVisible()
  expect(elapsed).toBeLessThan(BUDGET_MS)
})
