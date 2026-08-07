import { readFileSync } from 'node:fs'
import { expect, test, type Download, type Page } from '@playwright/test'

/**
 * Bốn kịch bản mà unit test không chứng minh được: IndexedDB thật (fake-indexeddb chỉ nằm trong bộ
 * nhớ, reload là mất), tải file thật, và chọn file thật từ ổ đĩa.
 */

/** Ảnh chụp những con số người bán nhìn thấy, đọc thẳng từ IndexedDB thật. */
type Snapshot = {
  orders: number
  orderLines: number
  payments: number
  items: number
  customers: number
  expenses: number
  revenue: number
  paid: number
  shopName: string
}

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('my-biller')
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })

    const readAll = <T>(store: string) =>
      new Promise<T[]>((resolve, reject) => {
        const request = db.transaction(store, 'readonly').objectStore(store).getAll()
        request.onsuccess = () => resolve(request.result as T[])
        request.onerror = () => reject(request.error)
      })

    const [orders, orderLines, payments, items, customers, expenses, settings] = await Promise.all([
      readAll<{ total: number; paidAmount: number; status: string }>('orders'),
      readAll('orderLines'),
      readAll('payments'),
      readAll('items'),
      readAll('customers'),
      readAll('expenses'),
      readAll<{ key: string; value: { name?: string } }>('settings'),
    ])
    db.close()

    const alive = orders.filter((order) => order.status !== 'void')
    return {
      orders: orders.length,
      orderLines: orderLines.length,
      payments: payments.length,
      items: items.length,
      customers: customers.length,
      expenses: expenses.length,
      revenue: alive.reduce((sum, order) => sum + order.total, 0),
      paid: alive.reduce((sum, order) => sum + order.paidAmount, 0),
      shopName: settings.find((row) => row.key === 'shop')?.value.name ?? '',
    }
  })
}

async function seed(page: Page) {
  await page.goto('/them')
  const seedButton = page.getByRole('button', { name: /Nạp dữ liệu mẫu/ })
  await seedButton.click()
  await expect(seedButton).toBeEnabled()
  await expect(page.getByText(/4 món/)).toBeVisible()
}

const readDownload = async (download: Download) =>
  readFileSync((await download.path()) ?? '', 'utf8')

/** Bấm nút và lấy nội dung file vừa tải về. */
async function downloadFrom(page: Page, name: string | RegExp) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name }).click(),
  ])
  return { filename: download.suggestedFilename(), text: await readDownload(download) }
}

async function importFile(page: Page, contents: string) {
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(contents) })
}

test('mất mạng vẫn lên được đơn và ghi vào máy', async ({ page, context }) => {
  await seed(page)

  await context.setOffline(true)

  // Điều hướng bằng thanh dưới chứ không `goto`: người bán đang mở app sẵn, không tải lại trang.
  await page.getByRole('link', { name: 'Bán' }).click()
  const grid = page.getByRole('group', { name: 'Mặt hàng' })
  await grid.getByRole('button', { name: /Phở bò/ }).click()
  await page.getByRole('button', { name: /THU TIỀN/ }).click()
  await page.getByRole('button', { name: /XONG & XUẤT PHIẾU/ }).click()
  await page.waitForURL(/\/don\/\d+\/phieu/)

  await expect(page.getByRole('heading', { name: 'PHIẾU BÁN HÀNG', exact: true })).toBeVisible()
  expect((await snapshot(page)).orders).toBe(3)

  await context.setOffline(false)
})

test('tạo đơn rồi tải lại trang: dữ liệu vẫn còn', async ({ page }) => {
  await seed(page)
  const before = await snapshot(page)

  await page.reload()
  await page.goto('/don')

  await expect(page.getByText('Anh Hùng').first()).toBeVisible()
  expect(await snapshot(page)).toEqual(before)
})

test('sao lưu → xoá sạch → nhập lại: mọi số khớp 100%', async ({ page }) => {
  await seed(page)
  const before = await snapshot(page)
  expect(before.orders).toBeGreaterThan(0)

  await page.goto('/them/cai-dat')
  const backup = await downloadFrom(page, 'SAO LƯU RA FILE')
  expect(backup.filename).toMatch(/^my-biller-backup-\d{6}-\d{4}\.json$/)
  await expect(page.getByText(/Đã tải my-biller-backup/)).toBeVisible()

  // Xoá sạch — Danger Zone cũng tự tải một file trước khi xoá, rồi tải lại trang.
  await page.getByRole('button', { name: 'Xoá toàn bộ dữ liệu' }).click()
  await page.getByLabel('Gõ XOA').fill('XOA')
  await Promise.all([
    page.waitForEvent('download'),
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'XOÁ TẤT CẢ' }).click(),
  ])
  expect((await snapshot(page)).orders).toBe(0)

  await page.goto('/them/cai-dat')
  await importFile(page, backup.text)
  await Promise.all([
    page.waitForEvent('download'),
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Nhập và ghi đè' }).click(),
  ])

  expect(await snapshot(page)).toEqual(before)

  await page.goto('/don')
  await expect(page.getByText('Anh Hùng').first()).toBeVisible()
})

test('file hỏng: báo lỗi và dữ liệu đang có không suy suyển', async ({ page }) => {
  await seed(page)
  const before = await snapshot(page)

  await page.goto('/them/cai-dat')
  await importFile(page, '{"app":"my-biller","version":1,"data":{"orders":"không phải mảng"}}')

  await expect(page.getByRole('alert')).toContainText('hỏng')
  await expect(page.getByText('Ghi đè toàn bộ dữ liệu?')).toHaveCount(0)
  expect(await snapshot(page)).toEqual(before)

  await importFile(page, 'đây không phải JSON')
  await expect(page.getByRole('alert')).toContainText('không phải file sao lưu')
  expect(await snapshot(page)).toEqual(before)
})
