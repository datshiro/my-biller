import { expect, test, type Page } from '@playwright/test'

/**
 * 320px là bề ngang của iPhone SE thế hệ 1 và của phần lớn máy Android giá rẻ. Màn nào tràn ngang ở
 * đó là người bán phải vuốt qua vuốt lại mới đọc hết một dòng — kiểm bằng máy thật mới thấy, jsdom
 * không có layout nên không bắt được.
 */
const NARROW = { width: 320, height: 640 }

/** `[đường dẫn, tên màn, chữ chờ hiện ra]` — chờ đúng nội dung của màn rồi mới đo, không đo lúc đang tải. */
const ROUTES = [
  ['/', 'Bán hàng', 'HÔM NAY'],
  ['/don', 'Đơn', 'Anh Hùng'],
  ['/chi-phi', 'Chi phí', 'CHI HÔM NAY'],
  ['/bao-cao', 'Báo cáo', 'DOANH THU'],
  ['/cong-no', 'Công nợ', 'TỔNG NỢ'],
  ['/them', 'Thêm', 'Cài đặt'],
  ['/them/mat-hang', 'Mặt hàng', 'Phở bò đặc biệt'],
  ['/them/mat-hang/moi', 'Thêm mặt hàng', 'LƯU MẶT HÀNG'],
  ['/them/khach-hang', 'Khách hàng', 'Anh Hùng'],
  ['/them/khach-hang/moi', 'Thêm khách hàng', 'LƯU KHÁCH HÀNG'],
  ['/them/khach-hang/1/bang-gia', 'Bảng giá của khách', 'Để trống là bán giá lẻ'],
  ['/them/cai-dat', 'Cài đặt', 'SAO LƯU RA FILE'],
  ['/them/cua-hang', 'Thông tin cửa hàng', 'LƯU THÔNG TIN'],
  ['/them/nhom-mat-hang', 'Nhóm mặt hàng', 'Đồ uống'],
  ['/them/loai-chi-phi', 'Loại chi phí', 'Nguyên liệu'],
] as const

async function seed(page: Page) {
  await page.goto('/them')
  const seedButton = page.getByRole('button', { name: /Nạp dữ liệu mẫu/ })
  await seedButton.click()
  await expect(seedButton).toBeEnabled()
  await expect(page.getByText(/4 món/)).toBeVisible()
}

/** Bề ngang thừa ra của chính trang và của mọi khối con — chỉ đo trang thôi thì lọt bảng tràn bên trong. */
async function overflowing(page: Page) {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth
    const offenders: string[] = []

    /**
     * Chỉ tha cho khung **cố ý** cuộn ngang (hàng chip lọc): chip bên trong nó được phép thò ra,
     * đó chính là thứ người bán vuốt.
     *
     * Nhận diện bằng class chứ không bằng `getComputedStyle`: theo CSS spec, khung nào đặt
     * `overflow-y: auto` thì trục còn lại **cũng** tính ra `auto`. `<main>` của app đúng như vậy,
     * nên hỏi computed style sẽ tha cho toàn bộ nội dung mọi màn — bộ dò xanh mà không thấy gì.
     */
    const insideScroller = (element: HTMLElement) => {
      for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        if (node.classList.contains('overflow-x-auto') || node.classList.contains('overflow-x-scroll')) {
          return true
        }
      }
      return false
    }

    if (document.documentElement.scrollWidth > limit) offenders.push('<html>')
    for (const element of document.querySelectorAll<HTMLElement>('body *')) {
      if (insideScroller(element)) continue
      const { right, left } = element.getBoundingClientRect()
      if (right > limit + 0.5 || left < -0.5) {
        offenders.push(`${element.tagName.toLowerCase()}.${element.className}`.slice(0, 120))
      }
    }
    return offenders
  })
}

test.beforeEach(async ({ page }) => {
  await seed(page)
  await page.setViewportSize(NARROW)
})

for (const [path, title, ready] of ROUTES) {
  test(`${title} (${path}) không tràn ngang ở 320px`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByText(ready).first()).toBeVisible()
    expect(await overflowing(page)).toEqual([])
  })
}

/**
 * Ca tự kiểm bộ dò. Không có nó thì 15 ca trên có thể xanh chỉ vì bộ dò mù — đã từng đúng như vậy:
 * `<main>` cuộn dọc nên `overflow-x` computed ra `auto`, và mọi nội dung của mọi màn bị tha hết.
 */
test('bộ dò tràn ngang bắt được phần tử vượt khổ nằm trong <main>', async ({ page }) => {
  await page.goto('/bao-cao')
  await expect(page.getByText('DOANH THU').first()).toBeVisible()
  expect(await overflowing(page)).toEqual([])

  await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.cssText = 'width:420px;height:4px'
    probe.className = 'moi-nhet-vao-de-thu'
    document.querySelector('main')?.append(probe)
  })

  expect(await overflowing(page)).toEqual(['div.moi-nhet-vao-de-thu'])
})

test('phiếu bán hàng và chi tiết đơn không tràn ngang ở 320px', async ({ page }) => {
  await page.goto('/don')
  await page.getByText('Anh Hùng').first().click()
  await page.waitForURL(/\/don\/\d+$/)
  await expect(page.getByRole('button', { name: /XEM PHIẾU/ })).toBeVisible()
  expect(await overflowing(page)).toEqual([])

  await page.getByRole('button', { name: /XEM PHIẾU/ }).click()
  await page.waitForURL(/\/don\/\d+\/phieu/)
  await expect(page.getByRole('heading', { name: 'PHIẾU BÁN HÀNG', exact: true })).toBeVisible()
  expect(await overflowing(page)).toEqual([])
})

test('hàng trong giỏ không tràn ngang ở 320px', async ({ page }) => {
  // Route `/` ở bảng trên được đo với giỏ RỖNG — `CartLines` chỉ render khi `count > 0`, nên hàng
  // giỏ (hai nút ±, ô số lượng gõ được, ô thành tiền) chưa từng đi qua cổng 320px lần nào.
  await page.goto('/')
  await page.getByRole('button', { name: /Phở bò đặc biệt/ }).first().click()
  await expect(page.getByRole('textbox', { name: 'Số lượng Phở bò đặc biệt' })).toBeVisible()
  expect(await overflowing(page)).toEqual([])

  // Số tiền dài nhất mà hàng giỏ phải chứa được: 999.999 ly × 55.000 vượt xa mọi đơn thật, nhưng ô
  // thành tiền chỉ còn ~112px sau khi trừ hai nút và ô số lượng, nên đo bằng số dài mới có nghĩa.
  await page.getByRole('textbox', { name: 'Số lượng Phở bò đặc biệt' }).fill('999')
  await expect(page.getByText('54.945.000').first()).toBeVisible()
  expect(await overflowing(page)).toEqual([])
})
