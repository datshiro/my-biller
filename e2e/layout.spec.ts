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

    // Hàng chip lọc cố ý cuộn ngang: bản thân khung cuộn không được vượt bề ngang màn, nhưng chip
    // bên trong nó thì được — đó chính là thứ người bán vuốt.
    const insideScroller = (element: HTMLElement) => {
      for (let node = element; node !== document.body; ) {
        const parent = node.parentElement
        if (!parent) return false
        if (getComputedStyle(parent).overflowX !== 'visible') return true
        node = parent
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
