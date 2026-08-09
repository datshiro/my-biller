import { readFileSync } from 'node:fs'
import { expect, test, type Download, type Page } from '@playwright/test'

/**
 * Bốn kịch bản mà unit test không chứng minh được: IndexedDB thật (fake-indexeddb chỉ nằm trong bộ
 * nhớ, reload là mất), tải file thật, và chọn file thật từ ổ đĩa.
 */

/**
 * Ảnh chụp **toàn bộ nội dung** IndexedDB thật, không phải vài con số tổng: một vòng sao lưu đánh
 * rơi `orders.note` hay cả bảng `itemGroups` vẫn cho số đếm y hệt, và đó đúng là kiểu mất dữ liệu
 * âm thầm mà bộ e2e này sinh ra để chặn.
 */
type Snapshot = {
  revenue: number
  paid: number
  shopName: string
  tables: Record<string, unknown[]>
}

/** `settings` không nằm trong ảnh chụp: mốc `lastBackupAt` đổi sau mỗi lần xuất file, đúng như thiết kế. */
const STORES = [
  'itemGroups',
  'items',
  'customers',
  'customerPrices',
  'orders',
  'orderLines',
  'payments',
  'expenseCategories',
  'expenses',
]

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(async (stores) => {
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

    const rows = await Promise.all(stores.map((store) => readAll<{ id?: number }>(store)))
    const settings = await readAll<{ key: string; value: { name?: string } }>('settings')
    db.close()

    const tables: Record<string, unknown[]> = {}
    stores.forEach((store, index) => {
      tables[store] = (rows[index] ?? []).sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
    })

    const orders = (rows[stores.indexOf('orders')] ?? []) as { total: number; paidAmount: number; status: string }[]
    const alive = orders.filter((order) => order.status !== 'void')
    return {
      revenue: alive.reduce((sum, order) => sum + order.total, 0),
      paid: alive.reduce((sum, order) => sum + order.paidAmount, 0),
      shopName: settings.find((row) => row.key === 'shop')?.value.name ?? '',
      tables,
    }
  }, STORES)
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

/**
 * Bộ mẫu không có dòng giá riêng nào, mà `[]` khớp `[]` thì vòng sao lưu không chứng minh gì cho bảng
 * này. Đặt giá qua đúng màn người bán dùng rồi mới sao lưu.
 */
async function setPrice(page: Page, customer: string, item: string, price: string) {
  await page.goto('/them/khach-hang')
  await page.getByRole('button', { name: new RegExp(customer) }).click()
  await page.getByRole('button', { name: /Bảng giá sỉ/ }).click()
  await page.getByLabel(item).fill(price)
  await page.getByRole('button', { name: 'LƯU BẢNG GIÁ' }).click()
  await expect(page.getByText(/món có giá riêng/)).toBeVisible()
}

/** Đi hết hai cửa xác nhận của đường nhập file. */
async function confirmImport(page: Page) {
  await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Tải file an toàn' }).click(),
  ])
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Đã thấy — ghi đè' }).click(),
  ])
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
  expect((await snapshot(page)).tables.orders).toHaveLength(3)

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

test('sao lưu → xoá sạch → nhập lại: từng bản ghi của từng bảng khớp lại', async ({ page }) => {
  await seed(page)
  await setPrice(page, 'Anh Hùng', 'Phở bò đặc biệt', '45000')

  const before = await snapshot(page)
  expect(before.tables.orders?.length).toBeGreaterThan(0)
  expect(before.tables.itemGroups?.length).toBeGreaterThan(0)
  expect(before.tables.customerPrices?.length).toBeGreaterThan(0)

  await page.goto('/them/cai-dat')
  const backup = await downloadFrom(page, 'SAO LƯU RA FILE')
  expect(backup.filename).toMatch(/^my-biller-backup-\d{6}-\d{4}\.json$/)
  await expect(page.getByText(/Đã tải my-biller-backup/)).toBeVisible()

  // Xoá sạch: tải file an toàn trước, rồi phải tự xác nhận đã thấy file mới xoá được.
  await page.getByRole('button', { name: 'Xoá toàn bộ dữ liệu' }).click()
  await page.getByLabel('Gõ XOA').fill('XOA')
  await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'SAO LƯU RỒI XOÁ' }).click(),
  ])
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Đã thấy — xoá tất cả' }).click(),
  ])
  expect((await snapshot(page)).tables.orders).toEqual([])

  await page.goto('/them/cai-dat')
  await importFile(page, backup.text)
  await confirmImport(page)

  expect(await snapshot(page)).toEqual(before)

  await page.goto('/don')
  await expect(page.getByText('Anh Hùng').first()).toBeVisible()
})

/**
 * Dòng giá riêng mồ côi **không** được chặn cả file: giá tra theo `itemId` của dòng đang trong giỏ
 * nên dòng đó không bao giờ được đọc. Nhưng nó phải bị lọc trước khi ghi — hai dòng cùng cặp
 * khách–món đụng index unique `&[customerId+itemId]` và `bulkPut` ném `ConstraintError`, huỷ **cả**
 * lượt nhập. Ca này chạy đường ghi thật vào IndexedDB thật, chỗ duy nhất chứng minh được điều đó.
 */
test('file có dòng giá riêng rác: cửa xác nhận nói rõ, nhập vẫn xong, rác không vào máy', async ({
  page,
}) => {
  await seed(page)
  await setPrice(page, 'Anh Hùng', 'Phở bò đặc biệt', '45000')

  await page.goto('/them/cai-dat')
  const backup = await downloadFrom(page, 'SAO LƯU RA FILE')

  const file = JSON.parse(backup.text) as {
    data: { customerPrices: { id: number; customerId: number; itemId: number; unitPrice: number }[] }
  }
  const good = file.data.customerPrices[0]
  if (!good) throw new Error('Bản sao lưu chưa có dòng giá riêng nào để dựng ca này.')
  file.data.customerPrices.push(
    { ...good, id: 9001, customerId: 9999 },
    { ...good, id: 9002, itemId: 9999 },
    { ...good, id: 9003, unitPrice: 11_000 },
  )

  await importFile(page, JSON.stringify(file))
  await expect(page.getByText(/3 dòng giá riêng sẽ bị bỏ/)).toBeVisible()
  await confirmImport(page)

  const prices = (await snapshot(page)).tables.customerPrices as { id: number; unitPrice: number }[]
  // Trùng cặp giữ dòng cuối, nên giá còn lại là 11.000 chứ không phải 45.000 — và đúng một dòng.
  expect(prices).toHaveLength(1)
  expect(prices[0]?.unitPrice).toBe(11_000)

  // Đường xoá sạch vẫn dùng được sau khi nhập file có rác: nhập hỏng nửa chừng thì lối thoát cuối
  // cùng của người bán cũng hỏng theo.
  await page.goto('/them/cai-dat')
  await page.getByRole('button', { name: 'Xoá toàn bộ dữ liệu' }).click()
  await page.getByLabel('Gõ XOA').fill('XOA')
  await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'SAO LƯU RỒI XOÁ' }).click(),
  ])
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Đã thấy — xoá tất cả' }).click(),
  ])
  expect((await snapshot(page)).tables.customerPrices).toEqual([])
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
