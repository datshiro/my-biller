import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ request }) => {
  await request.post('/__test__/mode/recovery')
})

async function seedItem(page: Page, name: string): Promise<string[]> {
  return page.evaluate(async (itemName) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('my-biller')
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    const names = [...database.objectStoreNames]
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('items', 'readwrite')
      transaction.objectStore('items').add({
        gid: crypto.randomUUID(),
        name: itemName,
        groupId: null,
        unit: 'phần',
        unitPrice: 45_000,
        costPrice: null,
        isActive: 1,
        note: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
    return names
  }, name)
}

test('artifact recovery mở schema v5, chạy offline và chỉ tải backup', async ({ page, context }) => {
  const syncRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('my-biller-sync')) syncRequests.push(request.url())
  })

  await page.goto('/')
  await expect(page).toHaveTitle('my-biller — Phục hồi chỉ đọc')
  await expect(page.locator('[data-app-mode="recovery"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Phục hồi dữ liệu — chỉ đọc' })).toBeVisible()

  const stores = await seedItem(page, 'Món cần cứu')
  expect(stores).toContain('outbox')
  expect(stores).toContain('deviceState')

  await page.reload()
  await expect(page.getByText(/0 đơn · 1 mặt hàng/)).toBeVisible()

  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Phục hồi dữ liệu — chỉ đọc' })).toBeVisible()
  await context.setOffline(false)

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'TẢI FILE SAO LƯU' }).click(),
  ])
  const path = await download.path()
  expect(path).not.toBeNull()
  const backup = JSON.parse(readFileSync(path ?? '', 'utf8')) as {
    app: string
    version: number
    data: { items: Array<{ name: string }> }
  }
  expect(backup).toMatchObject({ app: 'my-biller', version: 4 })
  expect(backup.data.items).toEqual([expect.objectContaining({ name: 'Món cần cứu' })])

  const localWrites = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('my-biller')
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    const readAll = (store: string) =>
      new Promise<unknown[]>((resolve, reject) => {
        const request = database.transaction(store, 'readonly').objectStore(store).getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    const outbox = await readAll('outbox')
    const settings = await readAll('settings') as Array<{
      key?: string
      value?: { lastBackupAt?: number }
    }>
    database.close()
    return {
      outbox: outbox.length,
      lastBackupAt: settings.find((row) => row.key === 'app')?.value?.lastBackupAt ?? null,
    }
  })
  expect(localWrites).toEqual({ outbox: 0, lastBackupAt: null })
  expect(syncRequests).toEqual([])

  await page.goto('/don')
  await expect(page.getByRole('heading', { name: 'Phục hồi dữ liệu — chỉ đọc' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Bán' })).toHaveCount(0)
})

test('service worker normal chuyển sang recovery trên cùng origin trước khi cứu dữ liệu', async ({
  page,
  context,
  request,
}) => {
  await context.route('https://my-biller-sync.datshiro.workers.dev/**', (route) => route.abort())
  await request.post('/__test__/mode/normal')
  await page.goto('/')
  await expect(page).toHaveTitle('my-biller — Bán hàng')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null)).toMatch(
    /\/sw\.js$/,
  )
  await seedItem(page, 'Món giữ qua lúc chuyển recovery')

  await request.post('/__test__/mode/recovery')
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) throw new Error('Normal service worker chưa được đăng ký.')
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('Recovery service worker không giành quyền điều khiển.')),
        20_000,
      )
      navigator.serviceWorker.addEventListener(
        'controllerchange',
        () => {
          window.clearTimeout(timeout)
          resolve()
        },
        { once: true },
      )
      void registration.update().catch(reject)
    })
  })

  await page.reload()
  await expect(page).toHaveTitle('my-biller — Phục hồi chỉ đọc')
  await expect(page.getByText('CHẾ ĐỘ PHỤC HỒI — KHÔNG BÁN HÀNG')).toBeVisible()
  await expect(page.locator('[data-app-mode="recovery"]')).toBeVisible()
  await expect(page.getByText(/0 đơn · 1 mặt hàng/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Bán' })).toHaveCount(0)

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'TẢI FILE SAO LƯU' }).click(),
  ])
  const path = await download.path()
  expect(path).not.toBeNull()
  const backup = JSON.parse(readFileSync(path ?? '', 'utf8')) as {
    data: { items: Array<{ name: string }> }
  }
  expect(backup.data.items).toEqual([
    expect.objectContaining({ name: 'Món giữ qua lúc chuyển recovery' }),
  ])
})
