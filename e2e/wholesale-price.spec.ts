import { expect, test, type Page } from '@playwright/test'

/**
 * Giá sỉ đi trọn một vòng trong trình duyệt thật: nhập bảng giá → bán → chốt → **tờ phiếu đưa khách**.
 * Vitest dừng ở IndexedDB và Robot cũng vậy, nên đoạn cuối — con số in trên phiếu — chỉ chỗ này kiểm.
 */

async function seed(page: Page) {
  await page.goto('/them')
  const seedButton = page.getByRole('button', { name: /Nạp dữ liệu mẫu/ })
  await seedButton.click()
  await expect(seedButton).toBeEnabled()
  await expect(page.getByText(/4 món/)).toBeVisible()
}

async function addCustomer(page: Page, name: string) {
  await page.goto('/them/khach-hang/moi')
  await page.getByLabel('Tên khách hàng *').fill(name)
  await page.getByRole('button', { name: 'LƯU KHÁCH HÀNG' }).click()
  await expect(page.getByText(name).first()).toBeVisible()
}

/** Đặt giá riêng qua đúng màn người bán dùng, không cấy thẳng vào IndexedDB. */
async function setPrice(page: Page, customer: string, item: string, price: string) {
  await page.goto('/them/khach-hang')
  await page.getByRole('button', { name: new RegExp(customer) }).click()
  await page.getByRole('button', { name: /Bảng giá sỉ/ }).click()
  await expect(page.getByText(/Để trống là bán giá lẻ/)).toBeVisible()
  await page.getByLabel(item).fill(price)
  await page.getByRole('button', { name: 'LƯU BẢNG GIÁ' }).click()
  await expect(page.getByText(/món có giá riêng/)).toBeVisible()
}

const grid = (page: Page) => page.getByRole('group', { name: 'Mặt hàng' })

async function pickCustomer(page: Page, name: string) {
  await page.getByRole('dialog', { name: 'Chọn khách' }).getByRole('button', { name }).click()
}

/** Đơn giá đang hiện trên dòng giỏ — chữ nằm trong nút "Sửa <tên>". */
const cartLine = (page: Page, name: string) => page.getByRole('button', { name: `Sửa ${name}`, exact: true })

test('một đơn sỉ trọn vòng: chỉ món có bảng giá xuống giá, phiếu in đúng đơn giá từng dòng', async ({
  page,
}) => {
  await seed(page)
  await setPrice(page, 'Anh Hùng', 'Phở bò đặc biệt', '45000')

  await page.goto('/')
  await grid(page).getByRole('button', { name: /Phở bò/ }).click()
  await grid(page).getByRole('button', { name: /Trà đá/ }).click()

  await page.getByRole('button', { name: 'SỈ', exact: true }).click()
  await pickCustomer(page, /Anh Hùng/)

  // Món có bảng giá xuống 45.000; món không có vẫn đúng giá lẻ 3.000 — đây là cả cái ý của "2 tầng giá".
  await expect(cartLine(page, 'Phở bò đặc biệt')).toContainText('45.000')
  await expect(cartLine(page, 'Trà đá')).toContainText('3.000')
  await expect(page.getByText('48.000 đ')).toBeVisible()

  await page.getByRole('button', { name: /THU TIỀN/ }).click()
  await page.getByRole('button', { name: /XONG & XUẤT PHIẾU/ }).click()
  await page.waitForURL(/\/don\/\d+\/phieu/)

  const rows = page.locator('table tbody tr')
  await expect(rows.filter({ hasText: 'Phở bò đặc biệt' })).toContainText('45.000')
  await expect(rows.filter({ hasText: 'Trà đá' })).toContainText('3.000')
  await expect(page.getByText('48.000 đ').first()).toBeVisible()
})

test('đổi khách khi đang SỈ: soi từng đơn giá, không chỉ tổng', async ({ page }) => {
  await seed(page)
  await addCustomer(page, 'Chị Hoa')
  await setPrice(page, 'Anh Hùng', 'Phở bò đặc biệt', '45000')
  await setPrice(page, 'Chị Hoa', 'Phở bò đặc biệt', '30000')
  await setPrice(page, 'Chị Hoa', 'Trà đá', '2000')

  await page.goto('/')
  await grid(page).getByRole('button', { name: /Phở bò/ }).click()
  await grid(page).getByRole('button', { name: /Trà đá/ }).click()

  await page.getByRole('button', { name: 'SỈ', exact: true }).click()
  await pickCustomer(page, /Anh Hùng/)
  await expect(cartLine(page, 'Phở bò đặc biệt')).toContainText('45.000')
  await expect(cartLine(page, 'Trà đá')).toContainText('3.000')

  await page.locator('header').getByRole('button', { name: /KHÁCH/ }).click()
  await pickCustomer(page, /Chị Hoa/)

  // Tổng của hai khách có thể trùng nhau do trùng số; đơn giá từng dòng thì không che được.
  await expect(cartLine(page, 'Phở bò đặc biệt')).toContainText('30.000')
  await expect(cartLine(page, 'Trà đá')).toContainText('2.000')
  await expect(cartLine(page, 'Phở bò đặc biệt')).not.toContainText('45.000')
})

/**
 * Khoá dòng có `#priceSource` sinh ra vì đúng ca này: giá tay đặt **trùng** giá sỉ. Không có nó thì
 * dòng catalog vừa xuống 45.000 trùng khoá dòng gõ tay 45.000 → `upsert` gộp thành một dòng `manual`
 * qty 2; tắt SỈ không đụng dòng manual nên cả 2 tô bán 45.000 thay vì 1×45.000 + 1×55.000.
 */
test('giá gõ tay trùng đúng giá sỉ vẫn là hai dòng riêng, tắt SỈ thì tách lại đúng', async ({ page }) => {
  await seed(page)
  await setPrice(page, 'Anh Hùng', 'Phở bò đặc biệt', '45000')

  await page.goto('/')
  await grid(page).getByRole('button', { name: /Phở bò/ }).click()
  await cartLine(page, 'Phở bò đặc biệt').click()
  await page.getByLabel(/Đơn giá riêng/).fill('45000')
  await page.getByRole('button', { name: 'XONG', exact: true }).click()

  await grid(page).getByRole('button', { name: /Phở bò/ }).click()
  await expect(cartLine(page, 'Phở bò đặc biệt')).toHaveCount(2)

  await page.getByRole('button', { name: 'SỈ', exact: true }).click()
  await pickCustomer(page, /Anh Hùng/)
  await expect(cartLine(page, 'Phở bò đặc biệt')).toHaveCount(2)
  await expect(page.getByText('90.000 đ')).toBeVisible()

  await page.locator('header').getByRole('button', { name: /KHÁCH/ }).click()
  await pickCustomer(page, /Khách lẻ/)

  await expect(cartLine(page, 'Phở bò đặc biệt')).toHaveCount(2)
  await expect(page.getByText('100.000 đ')).toBeVisible()

  await page.getByRole('button', { name: /THU TIỀN/ }).click()
  await page.getByRole('button', { name: /XONG & XUẤT PHIẾU/ }).click()
  await page.waitForURL(/\/don\/\d+\/phieu/)

  const rows = page.locator('table tbody tr')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('45.000')
  await expect(rows.nth(1)).toContainText('55.000')
})
