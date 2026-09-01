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

type LineOptions = {
  name?: (index: number) => string
  unit?: string
  note?: string
  /** Ghi chú của cả đơn — chữ tự do, không chặn độ dài, và chỉ in ở tấm cuối. */
  orderNote?: string
}

/** Dựng đơn nhiều dòng qua chính repository của app, rồi mở phiếu của nó. */
async function buildReceiptWithLines(page: Page, lineCount: number, options: LineOptions = {}) {
  const orderId = await page.evaluate(
    async ([modulePath, count, unit, note, longName, orderNote]) => {
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
        note: orderNote as string,
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
      options.orderNote ?? '',
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

/** 1mm = 96/25,4 px. Hộp nội dung trang = 80 − 2×4 = 72mm ⇒ 272,126 px; k = 272,126/360 = 0,755906. */
const MM_PX = 96 / 25.4
const NỘI_DUNG_TRANG_PX = 72 * MM_PX

/**
 * Chiều cao `@page`, CHỐT BẰNG SỐ ĐO chứ không chọn cho đẹp.
 *
 * Chromium fragment theo hộp **BỐ CỤC**, không theo phần đã `scale` — đo được: với `@page` 200mm,
 * hai `.receipt-frame` (layout 700px + 745px) ra **ba** trang PDF, dù phần mực chỉ cao 140mm và
 * 149mm. Nên `H` phải phủ chiều cao CHƯA scale.
 *
 * Trang xấu nhất đo được: 10 dòng tên dài nhất + ghi chú từng dòng + giảm giá + phụ thu + khối nợ
 * cũ + ghi chú đơn dài + chân phiếu + số trang = **1110px** = 293,7mm. Cộng 8mm lề và 15% dư,
 * làm tròn lên chục ⇒ 350mm.
 */
const CAO_TRANG_MM = 350
const CAO_TRANG_PT = (CAO_TRANG_MM * 72) / 25.4

/**
 * Bộ chỉ số làm nên mệnh đề "hai đường dùng chung một layout". `offsetWidth`/`offsetHeight` là hộp
 * BỐ CỤC nên miễn nhiễm với `transform`; `getBoundingClientRect()` là hộp SAU transform, tức phần
 * mực thật sự chiếm trên giấy. Tỉ số của hai cái đó chính là px→mm.
 */
async function layoutProbe(page: Page) {
  return page.evaluate((needle) => {
    const view = document.querySelector('.receipt-view') as HTMLElement
    const cell = [...document.querySelectorAll('td')].find((td) => td.textContent?.includes(needle))
    if (!cell) throw new Error(`Không thấy ô chứa "${needle}"`)
    const range = document.createRange()
    range.selectNodeContents(cell)
    return {
      layoutWidth: view.offsetWidth,
      cssWidth: getComputedStyle(view).width,
      layoutHeight: view.offsetHeight,
      tdHeight: cell.offsetHeight,
      textLines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top * 10) / 10)).size,
      visualWidth: view.getBoundingClientRect().width,
    }
  }, TÊN_DÀI_NHẤT)
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

  // Bản in giữ nguyên khung bố cục 360px rồi mới `scale` xuống 72mm — đo bằng
  // `getBoundingClientRect()` chứ không `offsetWidth`, vì `offsetWidth` là hộp bố cục và KHÔNG đổi
  // theo transform. Đổi API đo, không chỉ nới con số: `offsetWidth` một mình không phân biệt được
  // "trải rộng theo viewport" với "360px rồi thu nhỏ".
  const layout = await page.evaluate(() => {
    const view = document.querySelector('.receipt-view') as HTMLElement
    return {
      visualWidth: view.getBoundingClientRect().width,
      overflowing: view.scrollWidth > view.clientWidth,
    }
  })
  expect(layout.visualWidth).toBeCloseTo(NỘI_DUNG_TRANG_PX, 0)
  expect(layout.overflowing).toBe(false)

  await page.emulateMedia({ media: null })
})

test('bản in và ảnh dùng chung một layout', async ({ page }) => {
  // `transform: scale()` là phép VẼ, không phải phép BỐ CỤC: Chromium chạy layout ở bề ngang chưa
  // scale rồi mới thu nhỏ lúc paint. Nên chứng minh hai media bố cục cùng một cây DOM ở cùng bề
  // ngang 360px là chứng minh điểm vỡ dòng giống nhau THEO CẤU TẠO, không cần so ảnh.
  await buildReceiptWithLines(page, 3, { name: () => TÊN_DÀI_NHẤT, unit: 'Ly' })

  const trênMànHình = await layoutProbe(page)
  await page.emulateMedia({ media: 'print' })
  const bảnIn = await layoutProbe(page)

  expect(trênMànHình.layoutWidth).toBe(360)
  expect(bảnIn.layoutWidth).toBe(360)
  // `offsetWidth` một mình không phân biệt "360 vì ta khai" với "360 vì tình cờ"; `width:auto` cũ
  // cho ra bề ngang viewport (Pixel 7 ≈ 412px) nên chính assert này bắt được thủ phạm.
  expect(bảnIn.cssWidth).toBe('360px')
  expect(bảnIn.layoutHeight).toBe(trênMànHình.layoutHeight)
  expect(bảnIn.tdHeight).toBe(trênMànHình.tdHeight)
  expect(bảnIn.textLines).toBe(trênMànHình.textLines)
  expect(bảnIn.textLines).toBeLessThanOrEqual(2)

  // Có `visualWidth = 72mm` và `layoutWidth = 360px` thì "1 px bố cục = 0,2mm" là hằng đẳng thức,
  // nên `font-size: 11px ⇒ 2,20mm` SUY RA được chứ không phải đo thêm.
  expect(bảnIn.visualWidth).toBeCloseTo(NỘI_DUNG_TRANG_PX, 0)
  expect(bảnIn.visualWidth / bảnIn.layoutWidth).toBeCloseTo(0.7559, 3)

  await page.emulateMedia({ media: null })
})

/**
 * Cổng đếm trang ĐÃ ĐƯỢC CHỨNG MINH LÀ ĐỎ ĐƯỢC: đặt tạm `@page { size: 80mm 100mm }` (cùng lúc hạ
 * `CAO_TRANG_MM` để hai assert khổ giấy vẫn xanh) thì ca đỏ ở **đúng** assert đếm trang — 6 trang
 * cho 2 `.receipt-frame` — chứ không đỏ ở assert bề ngang. Không có bước đó thì không ai biết cổng
 * này có biết đỏ hay không.
 *
 * Đối chứng đã đo cho `size`: bỏ hẳn `size` ⇒ 612×792pt (Letter); `size: 80mm auto` ⇒ **cũng Letter**
 * (Chromium nuốt khai báo một-length), page count đúng nhưng khổ giấy sai. Chỉ hai length mới ăn.
 */
test('@page ra đúng khổ 80mm, không rơi về Letter', async ({ page }) => {
  await buildReceiptWithLines(page, 15, { name: () => TÊN_DÀI_NHẤT, unit: 'Ly', note: 'Đá riêng' })

  // `MediaBox` là khổ giấy Chromium THẬT SỰ đã dùng, đọc từ chính sản phẩm đầu ra. Khi Chromium
  // nuốt một khai báo `@page` sai cú pháp thì `document.styleSheets` vẫn hiện khai báo đó — chỉ
  // `MediaBox` mới tố cáo. Đối chứng đã đo: không có `size` thì ra 612×792pt (Letter).
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
  const raw = pdf.toString('latin1')
  const hộp = raw.match(/\/MediaBox\s*\[\s*0(?:\.\d+)?\s+0(?:\.\d+)?\s+([\d.]+)\s+([\d.]+)\s*\]/)
  expect(hộp).not.toBeNull()

  const [, bềNgang, chiềuCao] = hộp as RegExpMatchArray
  expect(Number(bềNgang)).toBeGreaterThan(226.0) // 80mm = 226,77pt
  expect(Number(bềNgang)).toBeLessThan(227.5)
  // Range tường minh ±1pt chứ không `toBeCloseTo(…, 0)` (chỉ ±0,5): Chromium làm tròn mm→pt hơi
  // lệch — 100mm ra 282,96pt thay vì 283,46 — nên ±0,5 đỏ oan vì phép làm tròn, không vì lỗi.
  expect(Number(chiềuCao)).toBeGreaterThan(CAO_TRANG_PT - 1)
  expect(Number(chiềuCao)).toBeLessThan(CAO_TRANG_PT + 1)

  // Cổng đếm trang: một `.receipt-frame` phải ra đúng một tờ. Nó là cổng DUY NHẤT bắt được `H` hụt.
  const sốTấm = await page.locator('.receipt-frame').count()
  expect((raw.match(/\/MediaBox/g) ?? []).length).toBe(sốTấm)
})

/**
 * Ghi chú đơn và chân phiếu là chữ TỰ DO, không chặn độ dài, và chỉ in ở tấm cuối — nên tấm cuối là
 * tấm duy nhất có thể cao hơn khổ trang. Đây là ranh giới trước nay không có cổng nào canh.
 *
 * Cổng đếm trang ở ca trên đòi số tờ BẰNG số tấm cho phiếu thường; ở đây thì ngược lại — nội dung
 * thật sự dài hơn một tờ thì chẻ ra nhiều tờ mới là đúng, còn bằng nhau nghĩa là phần thừa đã biến
 * mất khỏi phiếu tiền mà không báo gì.
 *
 * ĐÃ ĐO, để lần review sau khỏi tranh lại: `overflow: hidden` trên `.receipt-frame` KHÔNG cắt mất
 * phần thừa. Chạy đúng ca này ở cả hai cấu hình cho ra số liệu y hệt — tấm cao 1991,5px trên khổ
 * trang 1292,6px đều ra 2 tờ. Chromium vẫn chẻ tấm dù `overflow` khác `visible`, nên `overflow:
 * hidden` (thứ cắt phần TRÀN NGANG vô hình của hộp bố cục 360px) không đánh đổi bằng chữ bị mất.
 */
test('ghi chú đơn dài không bị cắt mất: tấm cao quá khổ thì chẻ sang tờ sau', async ({ page }) => {
  const ghiChúDài = Array.from({ length: 200 }, (_, i) => `Dòng ghi chú số ${i + 1} của đơn này`).join(' — ')
  await buildReceiptWithLines(page, 2, { orderNote: ghiChúDài })

  await page.emulateMedia({ media: 'print' })

  // Chứng minh bằng sản phẩm đầu ra chứ không bằng computed style: tấm cao hơn khổ trang thì PDF
  // phải có nhiều tờ hơn số tấm. Bằng nhau tức phần thừa đã biến mất.
  const caoTấm = await page.evaluate(
    () => (document.querySelector('.receipt-frame') as HTMLElement).getBoundingClientRect().height,
  )
  const caoTrangPx = (CAO_TRANG_MM - 8) * MM_PX // trừ `margin: 4mm` hai đầu
  expect(caoTấm).toBeGreaterThan(caoTrangPx)

  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
  const raw = pdf.toString('latin1')
  const sốTấm = await page.locator('.receipt-frame').count()
  expect((raw.match(/\/MediaBox/g) ?? []).length).toBeGreaterThan(sốTấm)

  await page.emulateMedia({ media: null })
})

/**
 * Cổng này KHÔNG phải cổng đỏ-rồi-xanh: ở 13px tên món đã vỡ đúng 2 dòng rồi. Con số "vỡ 4 dòng"
 * trong hợp đồng đến từ ảnh in thử THỨ NHẤT, mà rev.2 đã kết luận ảnh đó chụp từ bản PWA cũ còn kẹt
 * cache. Nó là cổng phòng thủ — nên đã chứng minh là biết đỏ: tạm đẩy thân bảng lên 16px thì ca này
 * đỏ ở đúng assert đếm dòng (ra 3).
 */
test('phiếu: tên món dài nhất chỉ vỡ 2 dòng trên đường ảnh', async ({ page }) => {
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
