import { expect, test, type Page } from '@playwright/test'

/**
 * Những thứ jsdom không kiểm được: html-to-image cần canvas thật, và `@media print` cần trình
 * duyệt thật. Đó là lý do phase này có e2e chứ không chỉ có unit test.
 */

const ORDERS_MODULE = '/src/db/repositories/orders.ts'
const SHARE_MODULE = '/src/features/receipt/share-receipt.ts'

async function seed(page: Page) {
  await page.goto('/them')
  const seedButton = page.getByRole('button', { name: /Nạp dữ liệu mẫu/ })
  await seedButton.click()
  await expect(seedButton).toBeEnabled()
  await expect(page.getByText(/4 món/)).toBeVisible()
}

async function sellTwoItems(page: Page) {
  await page.goto('/')
  const grid = page.getByRole('group', { name: 'Mặt hàng' })
  await grid.getByRole('button', { name: /Phở bò/ }).click()
  await grid.getByRole('button', { name: /Trà đá/ }).click()
  await page.getByRole('button', { name: /THU TIỀN/ }).click()
  await page.getByRole('button', { name: /XONG & XUẤT PHIẾU/ }).click()
  await page.waitForURL(/\/don\/\d+\/phieu/)
}

/** Tiêu đề in trong phiếu — phân biệt với `<h1>Phiếu bán hàng</h1>` của thanh tiêu đề màn hình. */
const receiptTitle = (page: Page) =>
  page.getByRole('heading', { name: 'PHIẾU BÁN HÀNG', exact: true })

const receiptReady = (page: Page) =>
  expect(page.getByRole('button', { name: /CHIA SẺ QUA ZALO|TẢI ẢNH PHIẾU/ })).toBeEnabled({
    timeout: 20_000,
  })

type CapturedImage = { size: number; type: string; width: number; ratio: number; filename: string }

/**
 * Lấy đúng bộ ảnh mà nút "Tải ảnh" đưa cho người dùng — chặn ở `createObjectURL` thay vì gọi thẳng
 * hàm chụp, để bài test đi qua chính đường mà người bán bấm. Phiếu dài trả về nhiều tấm.
 */
async function captureDownloadedImages(page: Page): Promise<CapturedImage[]> {
  return page.evaluate(async () => {
    const realCreate = URL.createObjectURL.bind(URL)
    const realClick = HTMLAnchorElement.prototype.click
    const captured: { blob: Blob; filename: string }[] = []
    let pending: Blob | null = null

    URL.createObjectURL = (blob: Blob | MediaSource) => {
      if (blob instanceof Blob) pending = blob
      return realCreate(blob)
    }
    // Chặn cú click tải thật để bài test không rải file ra đĩa; nhân đó lấy luôn tên file đề xuất.
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (!this.download) return realClick.call(this)
      if (pending) captured.push({ blob: pending, filename: this.download })
      pending = null
    }

    try {
      // Nút tải là CTA chính khi máy không chia sẻ được file ("TẢI ẢNH PHIẾU"), và là nút phụ khi
      // chia sẻ được ("Tải ảnh") — bắt cả hai để bài test chạy đúng trên cả hai nhánh.
      const button = [...document.querySelectorAll('button')].find((element) =>
        /tải ảnh/i.test(element.textContent ?? ''),
      )
      if (!button) throw new Error('Không thấy nút tải ảnh')
      button.click()

      for (let i = 0; i < 200 && captured.length === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      if (captured.length === 0) throw new Error('Không bắt được ảnh phiếu')

      const views = document.querySelectorAll<HTMLElement>('.receipt-view')
      return Promise.all(
        captured.map(async ({ blob, filename }, index) => {
          const bitmap = await createImageBitmap(blob)
          const view = views[index] ?? views[0]
          return {
            size: blob.size,
            type: blob.type,
            width: bitmap.width,
            ratio: Number((bitmap.width / (view as HTMLElement).offsetWidth).toFixed(2)),
            filename,
          }
        }),
      )
    } finally {
      URL.createObjectURL = realCreate
      HTMLAnchorElement.prototype.click = realClick
    }
  })
}

/**
 * Tên món dài nhất thực địa. Ảnh in thử của chủ quán cho thấy nó vỡ 4 dòng trong ô cột 1 — đây là
 * chuỗi mọi phép đo bẻ dòng bám vào, nên nó nằm ở một chỗ chứ không chép lại từng ca.
 */
const TÊN_DÀI_NHẤT = 'TRÀ SỮA TRUYỀN THỐNG KEM CHEESE'

type LineOptions = { name?: (index: number) => string; unit?: string; note?: string }

/** Dựng đơn nhiều dòng qua chính repository của app, rồi mở phiếu của nó. */
async function buildReceiptWithLines(page: Page, lineCount: number, options: LineOptions = {}) {
  const orderId = await page.evaluate(
    async ([modulePath, count, unit, note, longName]) => {
      const orders = (await import(modulePath as string)) as typeof import('@/db/repositories/orders')
      const total = 25_000 * (count as number)
      const { id } = await orders.createOrder({
        customerId: null,
        customerName: 'Khách lẻ',
        lines: Array.from({ length: count as number }, (_, index) => ({
          itemId: null,
          name: (longName as string | null) ?? `Món số ${index + 1} tên dài vừa phải`,
          unit: unit as string,
          unitPrice: 25_000,
          costPrice: null,
          qty: 1,
          note: note as string,
        })),
        discount: 0,
        surcharge: 0,
        soldAt: Date.now(),
        note: '',
        payment: { amount: total, method: 'cash' as const, note: '' },
      })
      return id
    },
    [
      ORDERS_MODULE,
      lineCount,
      options.unit ?? 'phần',
      options.note ?? '',
      // `page.evaluate` tuần tự hoá tham số nên hàm `name` không đi qua được; ca duy nhất cần đặt tên
      // riêng dùng đúng một tên cho mọi dòng, nên truyền chuỗi đã dựng sẵn.
      options.name ? options.name(0) : null,
    ] as const,
  )

  await page.goto(`/don/${orderId}/phieu`)
  await receiptReady(page)
  return orderId
}

async function openReceiptWithLines(page: Page, lineCount: number, options: LineOptions = {}) {
  await buildReceiptWithLines(page, lineCount, options)
  return captureDownloadedImages(page)
}

/**
 * Số dòng chữ thật của ô cột 1. `Range.getClientRects()` trả một hình chữ nhật cho mỗi hộp dòng —
 * API DOM duy nhất đọc thẳng kết quả bẻ dòng thay vì suy từ chiều cao chia line-height. Gom theo
 * `top` làm tròn 0,1 để tên món và `<span> (Ly)</span>` cùng dòng không bị đếm hai lần.
 */
async function textLineCount(page: Page, cellText: string) {
  return page.evaluate((needle) => {
    const cell = [...document.querySelectorAll('td')].find((td) => td.textContent?.includes(needle))
    if (!cell) throw new Error(`Không thấy ô chứa "${needle}"`)
    const range = document.createRange()
    range.selectNodeContents(cell)
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top * 10) / 10)).size
  }, cellText)
}

// Mỗi ca chạy trong một BrowserContext riêng nên IndexedDB đã sạch sẵn — không cần (và không nên)
// tự xoá database: app đang giữ kết nối Dexie thì `deleteDatabase` bị chặn chứ không xoá được.
test.beforeEach(async ({ page }) => {
  await seed(page)
})

test('bán 2 món → phiếu mở ra và tải được ảnh PNG thật', async ({ page }) => {
  await sellTwoItems(page)

  await expect(receiptTitle(page)).toBeVisible()
  await expect(page.getByText(/Số: PBH-/)).toBeVisible()
  await receiptReady(page)

  const images = await captureDownloadedImages(page)

  expect(images).toHaveLength(1)
  const [image] = images as [CapturedImage]
  expect(image.type).toBe('image/png')
  expect(image.size).toBeGreaterThan(0)
  expect(image.size).toBeLessThanOrEqual(300 * 1024)
  // Phiếu ngắn phải chụp ở 2× cho nét: rộng 360 CSS px → 720 điểm ảnh.
  expect(image.ratio).toBe(2)
  expect(image.width).toBe(720)
  // Một trang thì giữ đúng tên số phiếu, không đánh số thừa.
  expect(image.filename).toMatch(/^PBH-\d{6}-[A-Z]\d{3}\.png$/)
})

/**
 * Chụp lại phiếu ngay tại chỗ với một font chỉ định. Phải gọi thẳng `renderReceiptPng` chứ không
 * bấm nút tải: trang chụp ảnh một lần rồi giữ nguyên blob đó, nên bấm nút sau khi đổi font vẫn trả
 * về đúng tấm ảnh cũ.
 */
async function hashReceiptRender(page: Page, fontFamily: string | null) {
  return page.evaluate(
    async ([modulePath, family]) => {
      const share = (await import(modulePath as string)) as typeof import('@/features/receipt/share-receipt')
      const node = document.querySelector('.receipt-view') as HTMLElement
      node.style.fontFamily = family ?? ''
      try {
        const blob = await share.renderReceiptPng(node)
        const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
        return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
      } finally {
        node.style.fontFamily = ''
      }
    },
    [SHARE_MODULE, fontFamily] as const,
  )
}

test('ảnh phiếu vẽ bằng Be Vietnam Pro đã nhúng, không rơi về font hệ thống', async ({ page }) => {
  await sellTwoItems(page)
  await receiptReady(page)

  const embedded = await hashReceiptRender(page, null)

  // Đối chứng phải là ĐÚNG ngăn xếp dự phòng của app, không phải một font bất kỳ: nếu html-to-image
  // không nhúng được Be Vietnam Pro thì canvas đã vẽ bằng chính ngăn xếp này rồi, hai ảnh sẽ trùng
  // hệt nhau và bài test đổ. Ép sang monospace thì hai ảnh vẫn khác nhau kể cả khi nhúng font hỏng.
  const fallback = await hashReceiptRender(page, 'system-ui, -apple-system, "Segoe UI", sans-serif')

  expect(fallback).not.toBe(embedded)
})

test('bản in chỉ còn phiếu: không header, không nút, không thanh điều hướng', async ({ page }) => {
  await sellTwoItems(page)
  await expect(receiptTitle(page)).toBeVisible()

  // Màn phiếu nằm ngoài AppLayout nên thanh điều hướng không có mặt trong DOM ngay từ đầu.
  await expect(page.locator('nav')).toHaveCount(0)

  await page.emulateMedia({ media: 'print' })

  await expect(page.getByRole('button', { name: /CHIA SẺ QUA ZALO|TẢI ẢNH PHIẾU/ })).toBeHidden()
  await expect(page.getByRole('button', { name: /In \/ Lưu PDF/ })).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Phiếu bán hàng', exact: true })).toBeHidden()
  await expect(receiptTitle(page)).toBeVisible()

  // Khung 360px chỉ để ảnh ổn định; in ra giấy phải trải rộng và KHÔNG được cắt chữ.
  const layout = await page.evaluate(() => {
    const view = document.querySelector('.receipt-view') as HTMLElement
    return { width: view.offsetWidth, overflowing: view.scrollWidth > view.clientWidth }
  })
  expect(layout.width).toBeGreaterThan(360)
  expect(layout.overflowing).toBe(false)

  await page.emulateMedia({ media: null })
})

test('phiếu: tên món dài nhất chỉ vỡ 2 dòng trên đường ảnh', async ({ page }) => {
  // Ảnh in thử của chủ quán: đúng tên này vỡ 4 dòng vì thân bảng 13px và header "Đơn giá" chiếm cột.
  // Tiêu chí chỉ tính TÊN MÓN — dòng ghi chú bên dưới là dòng thứ ba có chủ ý.
  await buildReceiptWithLines(page, 1, { name: () => TÊN_DÀI_NHẤT, unit: 'Ly' })

  expect(await textLineCount(page, TÊN_DÀI_NHẤT)).toBeLessThanOrEqual(2)
})

test('phiếu 15 dòng → chia 2 tấm, tấm nào cũng dưới 300KB và vẫn chụp ở 2×', async ({ page }) => {
  const images = await openReceiptWithLines(page, 15)

  expect(images).toHaveLength(2)
  for (const image of images) {
    expect(image.size).toBeLessThanOrEqual(300 * 1024)
    // Đúng cái đổi lại của việc chia trang: không phải hạ độ phân giải nữa, mỗi tấm vẫn nét 2×.
    expect(image.ratio).toBe(2)
  }
  expect(images.map((image) => image.filename)).toEqual([
    expect.stringMatching(/-1\.png$/),
    expect.stringMatching(/-2\.png$/),
  ])
})

test('phiếu 40 dòng → chia 4 tấm đều nhau, không tấm nào vượt 300KB', async ({ page }) => {
  const images = await openReceiptWithLines(page, 40)

  expect(images).toHaveLength(4)
  for (const image of images) {
    expect(image.size).toBeLessThanOrEqual(300 * 1024)
    expect(image.ratio).toBe(2)
  }
})

test('phiếu nhiều trang: khối tiền chỉ ở tấm cuối, mọi tấm đều có đầu phiếu', async ({ page }) => {
  await openReceiptWithLines(page, 15)

  await expect(receiptTitle(page)).toHaveCount(2)
  await expect(page.getByText('Trang 1/2 · còn tiếp')).toBeVisible()
  await expect(page.getByText('Trang 2/2', { exact: true })).toBeVisible()

  const views = page.locator('.receipt-view')
  await expect(views.nth(0).getByText('Tổng cộng')).toHaveCount(0)
  await expect(views.nth(1).getByText('Tổng cộng')).toBeVisible()
})
