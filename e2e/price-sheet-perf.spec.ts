import { expect, test, type Page } from '@playwright/test'

/**
 * Màn bảng giá là màn duy nhất trong app dựng **một ô nhập cho mỗi mặt hàng**. Mỗi `MoneyInput` mang một
 * `useLayoutEffect` không có mảng phụ thuộc, nên nếu dòng giá không được `memo` chặn lại thì gõ một chữ
 * số ở giữa danh sách kéo theo M lượt render + M lượt layout effect.
 *
 * Đây là ca duy nhất trong bộ e2e đo **độ trễ phím**, và nó tồn tại vì tiêu chí nghiệm thu của màn này
 * có một con số: 200 món.
 */
const ITEMS = 200
const KEYSTROKES = 10
/**
 * Ngưỡng này đặt theo phép đo hai chiều, không phải đoán. Máy làm việc, 3 lượt mỗi bên:
 * có `memo` **32–33ms**, bỏ `memo` đi **68–70ms**. Sai số ±1ms, nên 50ms nằm gọn giữa hai cụm và ca
 * này **thật sự đỏ** khi ai đó gỡ `memo` — đã thử.
 *
 * Runner CI dùng vCPU chia sẻ, chậm 4–6 lần theo mốc đo ở `report-perf.spec.ts`: có `memo` rơi vào
 * ~165–198ms, bỏ ra là ~350–420ms. 300ms giữ được cả hai phía.
 */
const BUDGET_MS = process.env.CI ? 300 : 50

async function seedCatalog(page: Page, count: number) {
  return page.evaluate(async (total) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('my-biller')
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })

    const stamp = Date.now()

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['items', 'customers'], 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)

      tx.objectStore('customers').put({
        id: 1,
        name: 'Cô Bảy',
        phone: '',
        address: '',
        note: '',
        createdAt: stamp,
        updatedAt: stamp,
      })

      const items = tx.objectStore('items')
      for (let i = 0; i < total; i += 1) {
        items.put({
          id: i + 1,
          // Số có đệm 0 để thứ tự theo tên trùng với thứ tự id — ô thứ n đúng là món thứ n.
          name: `Món ${String(i + 1).padStart(3, '0')}`,
          groupId: null,
          unit: 'phần',
          unitPrice: 10_000 + i * 1_000,
          costPrice: 5_000,
          isActive: 1,
          note: '',
          createdAt: stamp,
          updatedAt: stamp,
        })
      }
    })

    db.close()
    return total
  }, count)
}

test(`gõ giá giữa danh mục ${ITEMS} món không trễ phím`, async ({ page }) => {
  await page.goto('/')
  expect(await seedCatalog(page, ITEMS)).toBe(ITEMS)

  await page.goto('/them/khach-hang/1/bang-gia')
  await expect(page.getByLabel('Món 100')).toBeVisible()

  // Gõ ở giữa danh sách: ô đầu tiên rẻ giả tạo vì phần lớn danh sách nằm ngoài vùng nhìn.
  const elapsed = await page.evaluate((keystrokes) => {
    const input = document.querySelectorAll<HTMLInputElement>('input[inputmode="numeric"]')[99]
    if (!input) throw new Error('Không tìm thấy ô giá thứ 100')

    // React chỉ nhận giá trị đi qua setter gốc của HTMLInputElement; gán thẳng `.value` nó bỏ qua.
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!setValue) throw new Error('Trình duyệt không có setter value để mô phỏng gõ phím')

    input.focus()
    const start = performance.now()
    for (let i = 1; i <= keystrokes; i += 1) {
      // `input` là sự kiện rời rạc nên React 19 commit ngay trong `dispatchEvent` — phép đo này gồm
      // cả lượt render lẫn lượt layout effect, đúng phần mà `memo` chặn.
      setValue.call(input, '1'.repeat(i))
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    return performance.now() - start
  }, KEYSTROKES)

  console.log(`Bảng giá: ${Math.round(elapsed)}ms cho ${KEYSTROKES} phím với ${ITEMS} món`)

  // Đo mà ô không nhận chữ thì con số ms vô nghĩa.
  await expect(page.getByLabel('Món 100')).toHaveValue('1.111.111.111')
  expect(elapsed).toBeLessThan(BUDGET_MS)
})
