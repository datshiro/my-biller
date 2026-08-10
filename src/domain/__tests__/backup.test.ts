import { describe, expect, it } from 'vitest'
import {
  backupFilename,
  cleanPriceRows,
  countOperationalRecords,
  countRecords,
  describeCounts,
  describeDroppedPrices,
  isOperationallyEmpty,
  parseBackupFile,
} from '../backup'
import type { BackupData } from '../schema'

const emptyData: BackupData = {
  settings: [],
  itemGroups: [],
  items: [],
  customers: [],
  customerPrices: [],
  orders: [],
  orderLines: [],
  payments: [],
  expenseCategories: [],
  expenses: [],
}

const file = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    app: 'my-biller',
    version: 1,
    appVersion: '1.0.0',
    exportedAt: '2026-08-07T07:00:00.000Z',
    data: emptyData,
    ...overrides,
  })

type Row = Record<string, unknown>

const customer = (over: Row = {}) => ({
  id: 7, name: 'Chị Hoa', phone: '0911', address: '', note: '', createdAt: 0, updatedAt: 0, ...over,
})
const order = (over: Row = {}) => ({
  id: 1, code: 'HD001', customerId: null, customerName: 'Khách lẻ', subtotal: 100_000, discount: 0,
  surcharge: 0, total: 100_000, paidAmount: 100_000, status: 'paid', soldAt: 0, note: '',
  createdAt: 0, updatedAt: 0, ...over,
})
const orderLine = (over: Row = {}) => ({
  id: 1, orderId: 1, itemId: null, name: 'Phở', unit: 'tô', unitPrice: 100_000, costPrice: null,
  qty: 1, amount: 100_000, ...over,
})
const payment = (over: Row = {}) => ({
  id: 1, orderId: 1, customerId: null, amount: 100_000, method: 'cash', paidAt: 0, note: '', ...over,
})
const item = (over: Row = {}) => ({
  id: 3, name: 'Phở', groupId: null, unit: 'tô', unitPrice: 50_000, costPrice: null, isActive: 1,
  note: '', createdAt: 0, updatedAt: 0, ...over,
})
const price = (over: Row = {}) => ({
  id: 1, customerId: 7, itemId: 3, unitPrice: 45_000, createdAt: 0, updatedAt: 0, ...over,
})

/** Một file nhỏ nhưng đủ liên kết: đơn ↔ dòng hàng ↔ phiếu thu ↔ khách. */
const wholeFile = (over: Partial<Record<keyof BackupData, unknown[]>> = {}) =>
  file({
    data: {
      ...emptyData,
      customers: [customer()],
      orders: [order({ customerId: 7 })],
      orderLines: [orderLine()],
      payments: [payment({ customerId: 7 })],
      ...over,
    },
  })

describe('backupFilename', () => {
  it('mang ngày giờ để hai lần sao lưu trong ngày không đè lên nhau', () => {
    const at = new Date(2026, 7, 7, 14, 5).getTime()
    expect(backupFilename(at)).toBe('my-biller-backup-260807-1405.json')
  })
})

describe('parseBackupFile', () => {
  it('nhận file đúng định dạng', () => {
    expect(parseBackupFile(file()).app).toBe('my-biller')
  })

  it('file không phải JSON', () => {
    expect(() => parseBackupFile('đây là ảnh chụp màn hình')).toThrow(/không phải file sao lưu/)
  })

  it('file của app khác nói rõ là app khác, không nói "hỏng"', () => {
    expect(() => parseBackupFile(file({ app: 'sổ-tay-khác' }))).toThrow(/ứng dụng khác/)
  })

  it('file của bản mới hơn bảo người dùng cập nhật, không bảo file hỏng', () => {
    expect(() => parseBackupFile(file({ version: 3 }))).toThrow(/v3/)
  })

  it('thiếu bảng thì chỉ đúng chỗ hỏng', () => {
    const missingOrders: Partial<BackupData> = { ...emptyData }
    delete missingOrders.orders
    expect(() => parseBackupFile(file({ data: missingOrders }))).toThrow(/data\.orders/)
  })

  it('số tiền lẻ trong file bị chặn — bất biến "tiền là số nguyên" áp cả với đường nhập', () => {
    const data = {
      ...emptyData,
      expenses: [
        { id: 1, categoryId: null, amount: 1000.5, note: '', spentAt: 0, createdAt: 0, updatedAt: 0 },
      ],
    }
    expect(() => parseBackupFile(file({ data }))).toThrow(/hỏng/)
  })
})

/**
 * File sao lưu là **đầu vào không tin cậy**: app dạy người bán mở nó ra sửa tay khi hỏng, và nó đi
 * thẳng vào `bulkPut` chứ không qua `createOrder`. Mọi chốt chặn của repository phải có bản sao ở đây.
 */
describe('parseBackupFile — liên kết giữa các bảng', () => {
  it('nhận file có đủ đơn ↔ dòng hàng ↔ phiếu thu ↔ khách', () => {
    expect(parseBackupFile(wholeFile()).data.orders[0]?.id).toBe(1)
  })

  it('đơn thiếu id bị chặn — nhập vào là IndexedDB cấp số mới, dòng hàng rời khỏi đơn', () => {
    const headless = order()
    delete (headless as Row).id
    expect(() => parseBackupFile(wholeFile({ orders: [headless] }))).toThrow(/data\.orders\.0\.id/)
  })

  it('hai đơn trùng id bị chặn — bulkPut sẽ để con sau đè lên con trước', () => {
    const twins = [order({ customerId: 7 }), order({ customerId: 7, code: 'HD002' })]
    expect(() => parseBackupFile(wholeFile({ orders: twins }))).toThrow(/hai dòng cùng mang số 1/)
  })

  it('dòng hàng trỏ tới đơn không có trong file bị chặn', () => {
    expect(() => parseBackupFile(wholeFile({ orderLines: [orderLine({ orderId: 99 })] }))).toThrow(
      /đơn số 99 mà file không có đơn đó/,
    )
  })

  it('phiếu thu trỏ tới đơn không có trong file bị chặn — tiền không được treo lơ lửng', () => {
    expect(() => parseBackupFile(wholeFile({ payments: [payment({ orderId: 99 })] }))).toThrow(
      /phiếu thu 100.000 đ của đơn số 99/,
    )
  })

  it('đơn ghi cho khách không có trong file bị chặn', () => {
    expect(() => parseBackupFile(wholeFile({ customers: [] }))).toThrow(/khách số 7 mà file không có khách đó/)
  })

  it('mặt hàng thuộc nhóm không có trong file bị chặn', () => {
    const items = [
      { id: 1, name: 'Phở', groupId: 5, unit: 'tô', unitPrice: 50_000, costPrice: null, isActive: 1, note: '', createdAt: 0, updatedAt: 0 },
    ]
    expect(() => parseBackupFile(wholeFile({ items }))).toThrow(/nhóm số 5 mà file không có nhóm đó/)
  })

  it('đơn còn nợ mà không ghi khách bị chặn — nợ đó sẽ tàng hình khỏi mọi màn hình', () => {
    const data = { orders: [order({ paidAmount: 40_000, status: 'partial' })], payments: [payment({ amount: 40_000 })] }
    expect(() => parseBackupFile(wholeFile(data))).toThrow(/còn thiếu 60.000 đ nhưng không ghi khách nào/)
  })

  it('số còn thiếu tính theo phiếu thu chứ không theo paidAmount trong file', () => {
    // File nói đã thu đủ nhưng chỉ kèm 1 phiếu thu 40k — `recalcAll` sau khi nhập cũng sẽ tin phiếu thu.
    const data = { orders: [order({ paidAmount: 100_000, status: 'paid' })], payments: [payment({ amount: 40_000 })] }
    expect(() => parseBackupFile(wholeFile(data))).toThrow(/còn thiếu 60.000 đ/)
  })

  it('đơn huỷ chưa thu đồng nào vẫn nhận được — huỷ thì không phải là nợ', () => {
    const data = { orders: [order({ paidAmount: 0, status: 'void' })], payments: [] }
    expect(parseBackupFile(wholeFile(data)).data.orders[0]?.status).toBe('void')
  })
})

/**
 * Bảng giá riêng sinh sau, nên **mọi** file người bán đang giữ trong máy đều là v1 và thiếu hẳn khoá đó.
 */
describe('parseBackupFile — bảng giá riêng', () => {
  const withoutPriceBook = (): Partial<BackupData> => {
    const data: Partial<BackupData> = { ...emptyData }
    delete data.customerPrices
    return data
  }

  it('file v1 tạo trước khi có bảng giá vẫn nhập được, bảng giá để rỗng', () => {
    expect(parseBackupFile(file({ data: withoutPriceBook() })).data.customerPrices).toEqual([])
  })

  it('file v2 thiếu hẳn khoá bảng giá thì bị từ chối, không im lặng thành rỗng', () => {
    expect(() => parseBackupFile(file({ version: 2, data: withoutPriceBook() }))).toThrow(/customerPrices/)
  })

  it('dòng giá mồ côi KHÔNG chặn file — rác đó không đụng tới đồng nào', () => {
    const data = { ...emptyData, customerPrices: [price()] }
    expect(parseBackupFile(file({ version: 2, data })).data.customerPrices).toHaveLength(1)
  })
})

describe('cleanPriceRows', () => {
  const withPrices = (customerPrices: unknown[]): BackupData => ({
    ...emptyData,
    customers: [customer()],
    items: [item()] as BackupData['items'],
    customerPrices: customerPrices as BackupData['customerPrices'],
  })

  it('giữ nguyên dòng có đủ cả khách lẫn món', () => {
    expect(cleanPriceRows(withPrices([price()]))).toEqual({ rows: [price()], dropped: 0 })
  })

  it('bỏ dòng mồ côi ở cả hai phía và đếm đúng số đã bỏ', () => {
    const rác = [price(), price({ id: 2, itemId: 99 }), price({ id: 3, customerId: 99 })]
    const { rows, dropped } = cleanPriceRows(withPrices(rác))

    expect(rows).toEqual([price()])
    expect(dropped).toBe(2)
  })

  it('trùng cặp thì giữ dòng cuối — để nguyên thì bulkPut ném ConstraintError, huỷ cả lượt nhập', () => {
    const { rows, dropped } = cleanPriceRows(withPrices([price(), price({ id: 2, unitPrice: 40_000 })]))

    expect(rows).toEqual([price({ id: 2, unitPrice: 40_000 })])
    expect(dropped).toBe(1)
  })

  it('cửa xác nhận chỉ nói thêm khi thật sự có dòng bị bỏ', () => {
    expect(describeDroppedPrices(withPrices([price()]))).toBe('')
    expect(describeDroppedPrices(withPrices([price({ itemId: 99 })]))).toMatch(/1 dòng giá riêng/)
  })
})

describe('countRecords', () => {
  it('đếm những thứ người bán nhận ra, không đếm bảng phụ', () => {
    const counts = countRecords({
      ...emptyData,
      orders: [1, 2, 3].map(() => ({}) as never),
      items: [1, 2].map(() => ({}) as never),
    })
    expect(counts).toEqual({ orders: 3, items: 2, customers: 0, expenses: 0, customerPrices: 0 })
    expect(describeCounts(counts)).toBe('3 đơn · 2 mặt hàng · 0 khách · 0 khoản chi · 0 giá riêng')
  })
})

describe('dữ liệu nghiệp vụ trong bản sao', () => {
  it('metadata, danh mục mặc định và giá riêng mồ côi vẫn là kho không có nghiệp vụ', () => {
    const counts = countOperationalRecords({
      ...emptyData,
      settings: [{ key: 'app', value: { lastBackupAt: null, seededExpenseCategories: true } }],
      itemGroups: [{ id: 1, name: 'Món nước', sortOrder: 0, createdAt: 0, updatedAt: 0 }],
      expenseCategories: [{ id: 1, name: 'Nguyên liệu', createdAt: 0, updatedAt: 0 }],
      customerPrices: [price()] as BackupData['customerPrices'],
    })

    expect(counts).toEqual({ orders: 0, items: 0, customers: 0, expenses: 0, customerPrices: 0 })
    expect(isOperationallyEmpty(counts)).toBe(true)
  })

  it.each([
    ['đơn', { orders: [order()] }],
    ['mặt hàng', { items: [item()] }],
    ['khách', { customers: [customer()] }],
    [
      'khoản chi',
      {
        expenses: [
          { id: 1, categoryId: null, amount: 10_000, note: '', spentAt: 0, createdAt: 0, updatedAt: 0 },
        ],
      },
    ],
  ])('chỉ cần một %s là không còn rỗng nghiệp vụ', (_label, patch) => {
    expect(isOperationallyEmpty(countOperationalRecords({ ...emptyData, ...patch } as BackupData))).toBe(false)
  })

  it('giá riêng còn dùng được đi qua count đã chuẩn hoá', () => {
    const counts = countOperationalRecords({
      ...emptyData,
      customers: [customer()] as BackupData['customers'],
      items: [item()] as BackupData['items'],
      customerPrices: [price()] as BackupData['customerPrices'],
    })

    expect(counts.customerPrices).toBe(1)
    expect(isOperationallyEmpty(counts)).toBe(false)
  })
})

describe('diagnostic từ bản ghi', () => {
  it('bỏ control/bidi và giới hạn phần dữ liệu người bán ở 80 code points', () => {
    const unsafeName = `Phở\u0000\n\u202E${'rất-dài-'.repeat(20)}`
    let message = ''

    try {
      parseBackupFile(wholeFile({ orderLines: [orderLine({ orderId: 99, name: unsafeName })] }))
    } catch (caught) {
      message = caught instanceof Error ? caught.message : ''
    }

    const shownName = message.match(/dòng hàng “([^”]*)”/)?.[1] ?? ''
    expect(shownName).not.toContain('\u0000')
    expect(shownName).not.toContain('\n')
    expect(shownName).not.toContain('\u202E')
    expect([...shownName]).toHaveLength(80)
    expect(shownName.endsWith('…')).toBe(true)
  })
})
