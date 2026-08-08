import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db'
import {
  buildPriceBook,
  listPriceBook,
  savePriceBook,
} from '../repositories/customer-prices'
import { createCustomer, deleteCustomer } from '../repositories/customers'
import { createItem, deleteItem } from '../repositories/items'
import type { CustomerPrice } from '@/domain/schema'

const item = { name: 'Phở bò', groupId: null, unit: 'tô', unitPrice: 55_000, costPrice: null, isActive: 1 } as const

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

const newCustomer = () => createCustomer({ name: 'Chị Hoa', phone: '', address: '', note: '' })

describe('savePriceBook', () => {
  it('lưu hai lần cùng một cặp thì đè lên dòng cũ, không đẻ dòng thứ hai', async () => {
    const customerId = await newCustomer()
    const itemId = await createItem({ ...item })

    await savePriceBook(customerId, [{ itemId, unitPrice: 45_000 }])
    await savePriceBook(customerId, [{ itemId, unitPrice: 40_000 }])

    expect(await listPriceBook(customerId)).toMatchObject([{ customerId, itemId, unitPrice: 40_000 }])
  })

  it('lần lưu sau bump updatedAt nhưng giữ nguyên createdAt', async () => {
    const customerId = await newCustomer()
    const itemId = await createItem({ ...item })
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    await savePriceBook(customerId, [{ itemId, unitPrice: 45_000 }])

    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    await savePriceBook(customerId, [{ itemId, unitPrice: 40_000 }])

    expect(await listPriceBook(customerId)).toMatchObject([{ createdAt: 1_000, updatedAt: 2_000 }])
    vi.restoreAllMocks()
  })

  /** `0` là giá thật — hàng biếu, khuyến mãi. Chỉ `null` mới có nghĩa "bỏ giá riêng đi". */
  it('giá 0 lưu lại được và đọc ra vẫn là 0; null mới là lệnh xoá dòng', async () => {
    const customerId = await newCustomer()
    const itemId = await createItem({ ...item })

    await savePriceBook(customerId, [{ itemId, unitPrice: 0 }])
    expect(await listPriceBook(customerId)).toMatchObject([{ unitPrice: 0 }])

    await savePriceBook(customerId, [{ itemId, unitPrice: null }])
    expect(await listPriceBook(customerId)).toEqual([])
  })

  it('xoá một dòng chưa từng có thì im lặng, không ném', async () => {
    const customerId = await newCustomer()
    const itemId = await createItem({ ...item })

    await expect(savePriceBook(customerId, [{ itemId, unitPrice: null }])).resolves.toBeUndefined()
  })

  it('chỉ trả về bảng giá của đúng khách đó', async () => {
    const [một, hai] = [await newCustomer(), await newCustomer()]
    const itemId = await createItem({ ...item })
    await savePriceBook(một, [{ itemId, unitPrice: 45_000 }])
    await savePriceBook(hai, [{ itemId, unitPrice: 30_000 }])

    expect(await listPriceBook(hai)).toMatchObject([{ unitPrice: 30_000 }])
  })
})

describe('buildPriceBook', () => {
  const row = (over: Partial<CustomerPrice>): CustomerPrice => ({
    id: 1, customerId: 1, itemId: 1, unitPrice: 45_000, createdAt: 0, updatedAt: 0, ...over,
  })

  it('giá 0 vào được bảng tra — nó là giá, không phải "chưa đặt"', () => {
    expect(buildPriceBook([row({ itemId: 5, unitPrice: 0 })]).get(5)).toBe(0)
  })

  /** Giá bẩn chảy tới `cartTotals` sẽ ném ngay trong thân render và chiếm màn giữa lúc đang bán. */
  it('bỏ dòng giá bẩn thay vì ném — màn bán hàng không được sập vì một dòng rác', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const rác = [row({ itemId: 1, unitPrice: 25_500.5 }), row({ itemId: 2, unitPrice: -1 })]

    const book = buildPriceBook([...rác, row({ itemId: 3, unitPrice: 40_000 })])

    expect([...book]).toEqual([[3, 40_000]])
    vi.restoreAllMocks()
  })
})

describe('xoá món / xoá khách kéo theo giá riêng', () => {
  it('xoá mặt hàng thì giá riêng của mọi khách cho món đó mất theo', async () => {
    const customerId = await newCustomer()
    const itemId = await createItem({ ...item })
    await savePriceBook(customerId, [{ itemId, unitPrice: 45_000 }])

    await deleteItem(itemId)

    expect(await db.customerPrices.count()).toBe(0)
  })

  it('xoá khách thì bảng giá riêng của khách đó mất theo', async () => {
    const customerId = await newCustomer()
    const itemId = await createItem({ ...item })
    await savePriceBook(customerId, [{ itemId, unitPrice: 45_000 }])

    await deleteCustomer(customerId)

    expect(await db.customerPrices.count()).toBe(0)
  })
})
