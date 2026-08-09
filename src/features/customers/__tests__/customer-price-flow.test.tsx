// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CustomerPricePage } from '../customer-price-page'
import { db } from '@/db/db'
import { listPriceBook } from '@/db/repositories/customer-prices'
import { createCustomer } from '@/db/repositories/customers'
import { createItem, deactivateItem } from '@/db/repositories/items'

afterEach(cleanup)

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

const seed = async () => {
  const customerId = await createCustomer({ name: 'Cô Bảy', phone: '', address: '', note: '' })
  const phở = await createItem({
    name: 'Phở bò',
    groupId: null,
    unit: 'tô',
    unitPrice: 55_000,
    costPrice: 30_000,
    isActive: 1,
  })
  const trà = await createItem({
    name: 'Trà đá',
    groupId: null,
    unit: 'ly',
    unitPrice: 3_000,
    costPrice: 500,
    isActive: 1,
  })
  return { customerId, phở, trà }
}

function renderPriceSheet(customerId: number) {
  return render(
    <MemoryRouter initialEntries={[`/them/khach-hang/${customerId}/bang-gia`]}>
      <Routes>
        <Route path="/them/khach-hang/:id/bang-gia" element={<CustomerPricePage />} />
        <Route path="/them/khach-hang/:id" element={<p>Màn chi tiết khách</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const ôGiáCủa = async (tên: string) => screen.findByLabelText(tên)
const lưu = async () => userEvent.click(await screen.findByRole('button', { name: /LƯU BẢNG GIÁ/ }))

describe('bảng giá riêng của khách', () => {
  it('nhập giá rồi lưu thì dòng giá nằm trong DB, và mở lại thấy đúng số đó', async () => {
    const { customerId, phở } = await seed()
    renderPriceSheet(customerId)

    await userEvent.type(await ôGiáCủa('Phở bò'), '38000')
    await lưu()

    await screen.findByText('Màn chi tiết khách')
    expect(await listPriceBook(customerId)).toMatchObject([{ itemId: phở, unitPrice: 38_000 }])

    cleanup()
    renderPriceSheet(customerId)
    expect(await ôGiáCủa('Phở bò')).toHaveProperty('value', '38.000')
  })

  /**
   * Lưu lần thứ hai đi qua đúng đường từng đẻ `ConstraintError`: khoá chính là `++id` còn uniqueness nằm ở
   * `&[customerId+itemId]`, nên `put` một object không mang `id` cũ sẽ rollback cả transaction và mọi ô
   * người bán vừa gõ mất sạch.
   */
  it('lưu lần thứ hai cùng món thì cập nhật một dòng, không đẻ dòng thứ hai', async () => {
    const { customerId } = await seed()
    renderPriceSheet(customerId)

    await userEvent.type(await ôGiáCủa('Phở bò'), '38000')
    await lưu()
    await screen.findByText('Màn chi tiết khách')

    cleanup()
    renderPriceSheet(customerId)
    await userEvent.clear(await ôGiáCủa('Phở bò'))
    await userEvent.type(await ôGiáCủa('Phở bò'), '40000')
    await lưu()

    await screen.findByText('Màn chi tiết khách')
    expect(await listPriceBook(customerId)).toMatchObject([{ unitPrice: 40_000 }])
  })

  /** `0` là giá thật — món tặng kèm. Hiểu nhầm thành ô trống là món tặng bị tính đủ tiền. */
  it('nhập 0 thì lưu thành giá 0, không bị coi là ô trống', async () => {
    const { customerId, phở } = await seed()
    renderPriceSheet(customerId)

    await userEvent.type(await ôGiáCủa('Phở bò'), '0')
    await lưu()

    await screen.findByText('Màn chi tiết khách')
    expect(await listPriceBook(customerId)).toMatchObject([{ itemId: phở, unitPrice: 0 }])
  })

  it('xoá sạch ô thì dòng giá biến khỏi DB, món về bán giá lẻ', async () => {
    const { customerId } = await seed()
    renderPriceSheet(customerId)

    await userEvent.type(await ôGiáCủa('Phở bò'), '38000')
    await lưu()
    await screen.findByText('Màn chi tiết khách')

    cleanup()
    renderPriceSheet(customerId)
    await userEvent.clear(await ôGiáCủa('Phở bò'))
    await lưu()

    await screen.findByText('Màn chi tiết khách')
    expect(await listPriceBook(customerId)).toEqual([])
  })

  it('mỗi dòng hiện giá lẻ để đối chiếu, và nói rõ để trống là bán giá lẻ', async () => {
    const { customerId } = await seed()
    renderPriceSheet(customerId)

    expect(await screen.findByText(/Giá lẻ 55.000 \/ tô/)).toBeDefined()
    expect(screen.getByText(/Giá lẻ 3.000 \/ ly/)).toBeDefined()
    expect(screen.getByText(/Để trống là bán giá lẻ/)).toBeDefined()
  })

  /**
   * Ca Robot cũng khoá chỗ này, nhưng Robot cố ý không chạy trong CI (`.github/workflows/kiem-thu.yml`)
   * nên một mình nó thì trả code về bản cũ vẫn xanh hết mọi cổng tự động. Ca này là cổng CI thật.
   * Khớp chuỗi tuyệt đối chứ không regex: "Giá lẻ 40.000 /" cũng chứa "Giá lẻ 40.000".
   */
  it('món chưa đặt đơn vị thì gợi ý giá lẻ không kéo theo gạch chéo lủng lẳng', async () => {
    const { customerId } = await seed()
    await createItem({
      name: 'Bún bò',
      groupId: null,
      unit: '',
      unitPrice: 40_000,
      costPrice: null,
      isActive: 1,
    })
    renderPriceSheet(customerId)

    expect(await screen.findByText('Giá lẻ 40.000')).toBeDefined()
  })

  it('món đã có giá riêng nổi lên đầu danh sách', async () => {
    const { customerId } = await seed()
    renderPriceSheet(customerId)

    // Theo tên thì "Phở bò" đứng trước "Trà đá"; đặt giá riêng cho Trà đá là nó phải vượt lên.
    await userEvent.type(await ôGiáCủa('Trà đá'), '2000')
    await lưu()
    await screen.findByText('Màn chi tiết khách')

    cleanup()
    renderPriceSheet(customerId)
    await screen.findByLabelText('Trà đá')
    expect(screen.getAllByText(/^Phở bò$|^Trà đá$/).map((node) => node.textContent)).toEqual(['Trà đá', 'Phở bò'])
  })

  it('ô tìm lọc theo tên không dấu', async () => {
    const { customerId } = await seed()
    renderPriceSheet(customerId)

    await userEvent.type(await screen.findByLabelText('Tìm món…'), 'tra')

    expect(screen.getByLabelText('Trà đá')).toBeDefined()
    expect(screen.queryByLabelText('Phở bò')).toBeNull()
  })

  /** Ngừng bán rồi bán lại thì giá riêng phải còn đó — lọc khỏi danh sách, **không** xoá khỏi DB. */
  it('món đã ngừng bán không hiện ra nhưng giá riêng của nó vẫn nằm nguyên', async () => {
    const { customerId, trà } = await seed()
    renderPriceSheet(customerId)

    await userEvent.type(await ôGiáCủa('Trà đá'), '2000')
    await lưu()
    await screen.findByText('Màn chi tiết khách')

    await deactivateItem(trà)
    cleanup()
    renderPriceSheet(customerId)

    await screen.findByLabelText('Phở bò')
    expect(screen.queryByLabelText('Trà đá')).toBeNull()
    expect(await listPriceBook(customerId)).toMatchObject([{ itemId: trà, unitPrice: 2_000 }])
  })

  it('còn ô chưa lưu mà bấm ✕ thì hỏi lại thay vì im lặng bỏ hết', async () => {
    const { customerId } = await seed()
    renderPriceSheet(customerId)

    await userEvent.type(await ôGiáCủa('Phở bò'), '38000')
    await userEvent.click(screen.getByRole('button', { name: 'Quay lại' }))

    expect(await screen.findByRole('alertdialog')).toBeDefined()
    expect(screen.getByText(/chưa được lưu/)).toBeDefined()
  })

  it('chưa đổi ô nào thì bấm ✕ đi thẳng, không hỏi', async () => {
    const { customerId } = await seed()
    renderPriceSheet(customerId)

    await screen.findByLabelText('Phở bò')
    await userEvent.click(screen.getByRole('button', { name: 'Quay lại' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })
})
