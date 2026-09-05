import { expect, test, type Page } from '@playwright/test'

/**
 * Đường cập nhật thật: hai bản build khác nhau (`dist` và `dist-next`), service worker thật, Chrome
 * thật. Robot không lái tới được vì dev server không sinh service worker — nên chốt chặn nằm ở đây.
 */
test.beforeEach(async ({ context, request }) => {
  // Bundle normal trỏ Worker production, bundle `next` (build staging) trỏ Worker staging: chặn cả hai.
  await context.route(/my-biller-sync(-staging)?\.datshiro\.workers\.dev/, (route) => route.abort())
  await request.post('/__test__/mode/normal')
})

const bundleSrc = (page: Page) => page.locator('script[type="module"]').getAttribute('src')

/** Mở Cài đặt, đợi SW cài xong rồi tải lại để nó nắm quyền điều khiển trang. */
async function openSettingsUnderServiceWorker(page: Page) {
  await page.goto('/them/cai-dat')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect(page.getByText('CẬP NHẬT APP')).toBeVisible()
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null)).toMatch(
    /\/sw\.js$/,
  )
}

test('nút Kiểm tra bản mới tải bản mới về, bấm Tải lại ngay thì đổi sang bundle mới', async ({
  page,
  request,
}) => {
  await openSettingsUnderServiceWorker(page)
  const bundleCũ = await bundleSrc(page)
  expect(bundleCũ).toMatch(/^\/assets\/index-/)

  const nútKiểm = page.getByRole('button', { name: 'KIỂM TRA BẢN MỚI' })
  await nútKiểm.click()
  await expect(page.getByText('Đang dùng bản mới nhất.')).toBeVisible()

  await request.post('/__test__/mode/next')
  await nútKiểm.click()
  // Tên phải đủ "NGAY": thanh PwaUpdatePrompt cũng hiện nút "Tải lại" cùng lúc.
  const nútTảiLại = page.getByRole('button', { name: 'TẢI LẠI NGAY' })
  await expect(nútTảiLại).toBeVisible({ timeout: 20_000 })
  expect(
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state),
  ).toBe('installed')

  const loaded = page.waitForEvent('load', { timeout: 20_000 })
  await nútTảiLại.click()
  await loaded

  await expect(page.getByText('CẬP NHẬT APP')).toBeVisible()
  expect(await bundleSrc(page)).not.toBe(bundleCũ)
  expect(
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting ?? null),
  ).toBeNull()
})

test('không tải được sw.js (mất mạng) thì báo không kiểm tra được và nút bấm lại được', async ({
  page,
  request,
}) => {
  await openSettingsUnderServiceWorker(page)
  // `context.setOffline(true)` không chặn được cú tải sw.js do trình duyệt phát — đã thử, update()
  // vẫn thành công. Server giả mất mạng bằng 503 cho riêng sw.js.
  await request.post('/__test__/mode/mat-mang')

  await page.getByRole('button', { name: 'KIỂM TRA BẢN MỚI' }).click()
  await expect(page.getByRole('alert')).toHaveText('Không kiểm tra được. Xem lại mạng rồi thử lại.')

  await request.post('/__test__/mode/normal')
  await expect(page.getByRole('button', { name: 'KIỂM TRA BẢN MỚI' })).toBeEnabled()
})
