import { describe, expect, it } from 'vitest'
import type { Customer, Item, ItemGroup } from '../schema'
import { parseCsv } from '../csv'
import {
  CUSTOMER_TEMPLATE,
  effectiveCustomerWrites,
  effectiveItemWrites,
  ITEM_TEMPLATE,
  planCustomerImport,
  planItemImport,
  readCustomerRows,
  readItemRows,
} from '../nhap-file'
import { CsvFileError } from '../csv'
import { itemNameKey } from '@shared/item-name'

function rows(text: string) {
  return parseCsv(text)
}

let nextId = 1
function item(overrides: Partial<Item> = {}): Item {
  return {
    id: nextId++,
    gid: crypto.randomUUID(),
    name: 'Trà đá',
    groupId: null,
    unit: 'Ly',
    unitPrice: 3000,
    costPrice: 500,
    isActive: 1,
    note: '',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function group(overrides: Partial<ItemGroup> = {}): ItemGroup {
  return {
    id: nextId++,
    gid: crypto.randomUUID(),
    name: 'Đồ uống',
    sortOrder: 0,
    optionGroups: [],
    toppingMenu: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: nextId++,
    gid: crypto.randomUUID(),
    name: 'Anh Hùng',
    phone: '0912 345 678',
    address: '',
    note: 'Khách quen',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('readItemRows', () => {
  it('đọc đúng cột theo tên tiêu đề, thứ tự cột tuỳ ý', () => {
    const { rows: out, errors } = readItemRows(rows('Giá bán,Tên món\n3000,Trà đá'))
    expect(errors).toEqual([])
    expect(out).toEqual([{ line: 2, group: '', name: 'Trà đá', unit: '', unitPrice: 3000, costPrice: null, note: '' }])
  })

  it('thiếu cột Tên món thì ném CsvFileError', () => {
    expect(() => readItemRows(rows('Giá bán\n3000'))).toThrow(/Tên món/)
  })

  it('thiếu cột Giá bán thì ném CsvFileError', () => {
    expect(() => readItemRows(rows('Tên món\nTrà đá'))).toThrow(/Giá bán/)
  })

  it('hàng mọi ô trống thì bỏ qua, không phải lỗi', () => {
    const { rows: out, errors } = readItemRows(rows('Tên món,Giá bán\nTrà đá,3000\n,\nPhở,45000'))
    expect(errors).toEqual([])
    expect(out).toHaveLength(2)
  })

  it('thiếu tên thì lỗi dòng', () => {
    const { errors } = readItemRows(rows('Tên món,Giá bán\n,3000'))
    expect(errors).toEqual([{ line: 2, message: 'Dòng 2: thiếu tên món.' }])
  })

  it('giá bán trống thì lỗi dòng', () => {
    const { errors } = readItemRows(rows('Tên món,Giá bán\nTrà đá,'))
    expect(errors).toEqual([{ line: 2, message: 'Dòng 2: thiếu giá bán.' }])
  })

  it('giá không đọc được thì lỗi dòng có trích giá gốc', () => {
    const { errors } = readItemRows(rows('Tên món,Giá bán\nTrà đá,25.5'))
    expect(errors).toEqual([{ line: 2, message: 'Dòng 2: giá bán "25.5" không đọc được.' }])
  })

  it('giá vượt trần thì lỗi dòng', () => {
    const { errors } = readItemRows(rows('Tên món,Giá bán\nTrà đá,9999999999'))
    expect(errors[0]?.message).toMatch(/vượt/)
  })

  it('giá vốn có nhưng không đọc được thì lỗi dòng', () => {
    const { errors } = readItemRows(rows('Tên món,Giá bán,Giá vốn\nTrà đá,3000,abc'))
    expect(errors).toEqual([{ line: 2, message: 'Dòng 2: giá vốn "abc" không đọc được.' }])
  })

  it('giá bóc hậu tố đ/₫/vnd không phân biệt hoa thường', () => {
    const { rows: out } = readItemRows(rows('Tên món,Giá bán,Giá vốn\nA,3000đ,500VND'))
    expect(out[0]).toMatchObject({ unitPrice: 3000, costPrice: 500 })
  })

  it('cột lạ bị bỏ qua, cột thiếu cho giá trị rỗng', () => {
    const { rows: out } = readItemRows(rows('Tên món,Giá bán,Cột lạ\nTrà đá,3000,gì đó'))
    expect(out[0]).toEqual({ line: 2, group: '', name: 'Trà đá', unit: '', unitPrice: 3000, costPrice: null, note: '' })
  })

  it('file mẫu ITEM_TEMPLATE đọc ra 2 dòng, 0 lỗi', () => {
    const { rows: out, errors } = readItemRows(rows(ITEM_TEMPLATE.text))
    expect(errors).toEqual([])
    expect(out).toHaveLength(2)
  })

  it('tên dạng tổ hợp NFD (dấu rời) được chuẩn hoá về NFC', () => {
    const nfd = 'Trà đá'.normalize('NFD')
    const { rows: out } = readItemRows(rows(`Tên món,Giá bán\n${nfd},3000`))
    expect(out[0]?.name).toBe('Trà đá'.normalize('NFC'))
  })
})

describe('readCustomerRows', () => {
  it('đọc đúng cột, thiếu Tên thì ném CsvFileError', () => {
    expect(() => readCustomerRows(rows('Số điện thoại\n0912345678'))).toThrow(/Tên/)
  })

  it('thiếu tên thì lỗi dòng', () => {
    const { errors } = readCustomerRows(rows('Tên,Số điện thoại\n,0912345678'))
    expect(errors).toEqual([{ line: 2, message: 'Dòng 2: thiếu tên.' }])
  })

  it('SĐT có chữ cái hoặc dạng khoa học thì báo định dạng lại cột', () => {
    const scientific = readCustomerRows(rows('Tên,Số điện thoại\nA,9.12E+08'))
    expect(scientific.errors[0]?.message).toMatch(/Excel đổi thành số/)
    const letters = readCustomerRows(rows('Tên,Số điện thoại\nA,abc123'))
    expect(letters.errors[0]?.message).toMatch(/Excel đổi thành số/)
  })

  it('SĐT 9 số không bắt đầu bằng 0 (Excel làm mất số 0 đầu) thì báo định dạng lại cột', () => {
    const { errors } = readCustomerRows(rows('Tên,Số điện thoại\nA,912345678'))
    expect(errors[0]?.message).toMatch(/Excel đổi thành số/)
  })

  it('SĐT 10 số đủ, đúng bắt đầu bằng 0 thì không báo lỗi', () => {
    const { rows: out, errors } = readCustomerRows(rows('Tên,Số điện thoại\nA,0912345678'))
    expect(errors).toEqual([])
    expect(out[0]?.phone).toBe('0912345678')
  })

  it('SĐT hợp lệ với khoảng trắng và dấu () - + vẫn đọc được', () => {
    const { rows: out, errors } = readCustomerRows(rows('Tên,Số điện thoại\nA,(091) 234-567+8'))
    expect(errors).toEqual([])
    expect(out[0]?.phone).toBe('(091) 234-567+8')
  })

  it('file mẫu CUSTOMER_TEMPLATE đọc ra 1 dòng, 0 lỗi', () => {
    const { rows: out, errors } = readCustomerRows(rows(CUSTOMER_TEMPLATE.text))
    expect(errors).toEqual([])
    expect(out).toHaveLength(1)
  })
})

describe('planItemImport — phân loại', () => {
  it('"TRÀ ĐÁ" khớp "Trà đá" (trùng), "Bò" không khớp "Bơ" (mới)', () => {
    const existing = [item({ name: 'Trà đá' }), item({ name: 'Bơ' })]
    const r = [
      { line: 2, group: '', name: 'TRÀ ĐÁ', unit: '', unitPrice: 3000, costPrice: null, note: '' },
      { line: 3, group: '', name: 'Bò', unit: '', unitPrice: 5000, costPrice: null, note: '' },
    ]
    const plan = planItemImport(r, existing, [])
    expect(plan.duplicates).toHaveLength(1)
    expect(plan.duplicates[0]?.existing.name).toBe('Trà đá')
    expect(plan.creates).toHaveLength(1)
    expect(plan.creates[0]?.row.name).toBe('Bò')
  })

  it('món đang ngừng bán vẫn tính là trùng', () => {
    const existing = [item({ name: 'Trà đá', isActive: 0 })]
    const r = [{ line: 2, group: '', name: 'trà đá', unit: '', unitPrice: 3000, costPrice: null, note: '' }]
    const plan = planItemImport(r, existing, [])
    expect(plan.duplicates).toHaveLength(1)
  })

  it('hai món cũ cùng tên thì lỗi mơ hồ', () => {
    const existing = [item({ name: 'Trà đá' }), item({ name: 'Trà đá' })]
    const r = [{ line: 2, group: '', name: 'Trà đá', unit: '', unitPrice: 3000, costPrice: null, note: '' }]
    const plan = planItemImport(r, existing, [])
    expect(plan.errors).toEqual([{ line: 2, message: 'Dòng 2: Sổ đang có 2 món tên "Trà đá", sửa trong app trước.' }])
    expect(plan.duplicates).toHaveLength(0)
  })

  it('ô trống giữ giá trị cũ, file giống hệt DB thì changes rỗng', () => {
    const existing = [item({ name: 'Trà đá', unitPrice: 3000, costPrice: 500, unit: 'Ly', note: 'Ghi chú cũ' })]
    const r = [{ line: 2, group: '', name: 'Trà đá', unit: '', unitPrice: 3000, costPrice: null, note: '' }]
    const plan = planItemImport(r, existing, [])
    expect(plan.duplicates[0]?.changes).toEqual({})
  })

  it('dòng khác giá/đơn vị/ghi chú thì changes chỉ gồm trường đổi', () => {
    const existing = [item({ name: 'Trà đá', unitPrice: 3000, costPrice: 500, unit: 'Ly', note: 'cũ' })]
    const r = [{ line: 2, group: '', name: 'Trà đá', unit: 'Chai', unitPrice: 4000, costPrice: null, note: '' }]
    const plan = planItemImport(r, existing, [])
    expect(plan.duplicates[0]?.changes).toEqual({ unitPrice: 4000, unit: 'Chai' })
  })

  it('nhóm: tên khớp nhóm có sẵn (không phân biệt hoa thường) ra existingId', () => {
    const groups = [group({ id: 10, name: 'Đồ uống' })]
    const r = [{ line: 2, group: 'ĐỒ UỐNG', name: 'Mới', unit: '', unitPrice: 1000, costPrice: null, note: '' }]
    const plan = planItemImport(r, [], groups)
    expect(plan.creates[0]?.group).toEqual({ existingId: 10 })
  })

  it('nhóm: tên không khớp nhóm nào ra newName', () => {
    const r = [{ line: 2, group: 'Bánh', name: 'Mới', unit: '', unitPrice: 1000, costPrice: null, note: '' }]
    const plan = planItemImport(r, [], [])
    expect(plan.creates[0]?.group).toEqual({ newName: 'Bánh' })
  })

  it('nhóm trống thì group là null', () => {
    const r = [{ line: 2, group: '', name: 'Mới', unit: '', unitPrice: 1000, costPrice: null, note: '' }]
    const plan = planItemImport(r, [], [])
    expect(plan.creates[0]?.group).toBeNull()
  })
})

describe('planItemImport — xung đột theo đích trong cùng file', () => {
  it('hai dòng món cùng đích mới (khác cách viết hoa) → lỗi ở dòng sau', () => {
    const r = [
      { line: 2, group: '', name: 'Trà đá', unit: '', unitPrice: 3000, costPrice: null, note: '' },
      { line: 3, group: '', name: 'trà đá ', unit: '', unitPrice: 3500, costPrice: null, note: '' },
    ]
    const plan = planItemImport(r, [], [])
    expect(plan.creates).toHaveLength(1)
    expect(plan.errors).toEqual([{ line: 3, message: 'Dòng 3: cùng một món với dòng 2 (Trà đá).' }])
  })

  it('hai dòng cùng khớp một món có sẵn → lỗi ở dòng sau', () => {
    const existing = [item({ name: 'Trà đá' })]
    const r = [
      { line: 2, group: '', name: 'Trà đá', unit: '', unitPrice: 3000, costPrice: null, note: '' },
      { line: 3, group: '', name: 'TRÀ ĐÁ', unit: '', unitPrice: 3500, costPrice: null, note: '' },
    ]
    const plan = planItemImport(r, existing, [])
    expect(plan.duplicates).toHaveLength(1)
    expect(plan.errors).toEqual([{ line: 3, message: 'Dòng 3: cùng một món với dòng 2 (Trà đá).' }])
  })
})

describe('effectiveItemWrites — áp chính sách bỏ qua/cập nhật', () => {
  it("'skip': groupsToCreate rỗng, creates/updates rỗng cho dòng trùng", () => {
    const existing = [item({ name: 'Trà đá', unitPrice: 3000 })]
    const r = [{ line: 2, group: 'Nước', name: 'Trà đá', unit: '', unitPrice: 4000, costPrice: null, note: '' }]
    const plan = planItemImport(r, existing, [])
    const writes = effectiveItemWrites(plan, 'skip')
    expect(writes).toMatchObject({ groupsToCreate: [], creates: [], updates: [], skipped: 1 })
  })

  it("'update': cùng file ra groupsToCreate ['Nước'] và một update", () => {
    const existing = [item({ name: 'Trà đá', unitPrice: 3000 })]
    const r = [{ line: 2, group: 'Nước', name: 'Trà đá', unit: '', unitPrice: 4000, costPrice: null, note: '' }]
    const plan = planItemImport(r, existing, [])
    const writes = effectiveItemWrites(plan, 'update')
    expect(writes.groupsToCreate).toEqual(['Nước'])
    expect(writes.updates).toHaveLength(1)
  })

  it('10 dòng món mới cùng nhóm "Bánh" (viết hoa khác nhau) → groupsToCreate chỉ có một "Bánh"', () => {
    const r = Array.from({ length: 10 }, (_, i) => ({
      line: i + 2,
      group: i % 2 === 0 ? 'Bánh' : 'BÁNH',
      name: `Món ${i}`,
      unit: '',
      unitPrice: 1000,
      costPrice: null,
      note: '',
    }))
    const plan = planItemImport(r, [], [])
    const writes = effectiveItemWrites(plan, 'skip')
    expect(writes.groupsToCreate).toEqual(['Bánh'])
  })

  it('món mới không có nhóm và trùng skip → không có nhóm nào', () => {
    const existing = [item({ name: 'Trà đá' })]
    const r = [
      { line: 2, group: '', name: 'Mới', unit: '', unitPrice: 1000, costPrice: null, note: '' },
      { line: 3, group: 'Chưa có', name: 'Trà đá', unit: '', unitPrice: 2000, costPrice: null, note: '' },
    ]
    const plan = planItemImport(r, existing, [])
    const writes = effectiveItemWrites(plan, 'skip')
    expect(writes.groupsToCreate).toEqual([])
  })
})

describe('planCustomerImport', () => {
  it('"0912345678" khớp "0912 345 678" (trùng)', () => {
    const existing = [customer({ name: 'Anh Hùng', phone: '0912 345 678' })]
    const r = [{ line: 2, name: 'Anh Hùng', phone: '0912345678', address: '', note: '' }]
    const plan = planCustomerImport(r, existing)
    expect(plan.duplicates).toHaveLength(1)
  })

  it('dòng có SĐT không khớp khách cùng tên mà khác số → tạo mới', () => {
    const existing = [customer({ name: 'Anh Hùng', phone: '0912 345 678' })]
    const r = [{ line: 2, name: 'Anh Hùng', phone: '0999999999', address: '', note: '' }]
    const plan = planCustomerImport(r, existing)
    expect(plan.creates).toHaveLength(1)
    expect(plan.duplicates).toHaveLength(0)
  })

  it('dòng không SĐT khớp theo tên và changes không có name', () => {
    const existing = [customer({ name: 'Anh Hùng', phone: '0912 345 678', address: '' })]
    const r = [{ line: 2, name: 'anh hùng', phone: '', address: '5 Lê Lợi', note: '' }]
    const plan = planCustomerImport(r, existing)
    expect(plan.duplicates[0]?.changes).toEqual({ address: '5 Lê Lợi' })
  })

  it('khớp SĐT khác cách viết thì changes không có phone, có name khi tên đổi', () => {
    const existing = [customer({ name: 'Anh Hùng', phone: '0912 345 678' })]
    const r = [{ line: 2, name: 'Anh Hùng Mới', phone: '0912345678', address: '', note: '' }]
    const plan = planCustomerImport(r, existing)
    expect(plan.duplicates[0]?.changes).toEqual({ name: 'Anh Hùng Mới' })
  })

  it('ô trống giữ giá trị cũ; file giống hệt DB thì mọi changes rỗng', () => {
    const existing = [customer({ name: 'Anh Hùng', phone: '0912 345 678', address: 'A', note: 'B' })]
    const r = [{ line: 2, name: 'Anh Hùng', phone: '0912 345 678', address: '', note: '' }]
    const plan = planCustomerImport(r, existing)
    expect(plan.duplicates[0]?.changes).toEqual({})
  })

  it('xung đột: dòng 3 khớp theo SĐT, dòng 9 không SĐT khớp cùng khách theo tên → lỗi', () => {
    const existing = [customer({ name: 'Anh Hùng', phone: '0912 345 678' })]
    const r = [
      { line: 3, name: 'Anh Hùng', phone: '0912345678', address: '', note: '' },
      { line: 9, name: 'anh hùng', phone: '', address: '', note: '' },
    ]
    const plan = planCustomerImport(r, existing)
    expect(plan.duplicates).toHaveLength(1)
    expect(plan.errors).toEqual([{ line: 9, message: 'Dòng 9: cùng một khách với dòng 3 (Anh Hùng).' }])
  })

  it('xung đột: dòng 3 là khách mới (có SĐT), dòng 7 không SĐT khớp theo tên với đích mới đó → lỗi', () => {
    const r = [
      { line: 3, name: 'Chị Lan', phone: '0901111111', address: '', note: '' },
      { line: 7, name: 'chị lan', phone: '', address: '', note: '' },
    ]
    const plan = planCustomerImport(r, [])
    expect(plan.creates).toHaveLength(1)
    expect(plan.errors).toEqual([{ line: 7, message: 'Dòng 7: cùng một khách với dòng 3 (Chị Lan).' }])
  })

  it('xung đột: dòng 3 là khách mới (có SĐT), dòng 9 cùng SĐT viết khác → lỗi', () => {
    const r = [
      { line: 3, name: 'Chị Lan', phone: '0901 111 111', address: '', note: '' },
      { line: 9, name: 'Chị Lan Khác', phone: '0901111111', address: '', note: '' },
    ]
    const plan = planCustomerImport(r, [])
    expect(plan.creates).toHaveLength(1)
    expect(plan.errors).toEqual([{ line: 9, message: 'Dòng 9: cùng một khách với dòng 3 (Chị Lan).' }])
  })

  it('hai khách cũ cùng khớp một SĐT thì lỗi mơ hồ', () => {
    const existing = [customer({ phone: '0912345678' }), customer({ phone: '0912345678' })]
    const r = [{ line: 2, name: 'X', phone: '0912345678', address: '', note: '' }]
    const plan = planCustomerImport(r, existing)
    expect(plan.errors[0]?.message).toMatch(/Sổ đang có 2 khách/)
  })
})

describe('effectiveCustomerWrites', () => {
  it("'skip' bỏ qua trùng, 'update' áp changes", () => {
    const existing = [customer({ name: 'Anh Hùng', phone: '0912 345 678' })]
    const r = [{ line: 2, name: 'Anh Hùng', phone: '0912345678', address: 'Mới', note: '' }]
    const plan = planCustomerImport(r, existing)
    const skip = effectiveCustomerWrites(plan, 'skip')
    expect(skip).toMatchObject({ creates: [], updates: [], skipped: 1, unchanged: 0 })
    const update = effectiveCustomerWrites(plan, 'update')
    expect(update.updates).toHaveLength(1)
  })

  it("'update' với file giống hệt DB thì unchanged, không updates", () => {
    const existing = [customer({ name: 'Anh Hùng', phone: '0912 345 678' })]
    const r = [{ line: 2, name: 'Anh Hùng', phone: '0912 345 678', address: '', note: '' }]
    const plan = planCustomerImport(r, existing)
    const writes = effectiveCustomerWrites(plan, 'update')
    expect(writes).toMatchObject({ updates: [], unchanged: 1 })
  })
})

describe('itemNameKey', () => {
  it('trim + lowercase tiếng Việt', () => {
    expect(itemNameKey(' TRÀ ĐÁ ')).toBe('trà đá')
  })
})

describe('hiệu năng đọc và phân loại', () => {
  it('500 dòng món, 300 món + 20 nhóm có sẵn chạy dưới 2s', () => {
    const existingItems = Array.from({ length: 300 }, (_, i) => item({ name: `Món có sẵn ${i}` }))
    const existingGroups = Array.from({ length: 20 }, (_, i) => group({ id: i + 1000, name: `Nhóm ${i}` }))
    const header = 'Nhóm,Tên món,Giá bán\n'
    const body = Array.from({ length: 500 }, (_, i) => `Nhóm ${i % 20},Món mới ${i},${1000 + i}\n`).join('')
    const start = performance.now()
    const { rows: parsed, errors } = readItemRows(rows(header + body))
    const plan = planItemImport(parsed, existingItems, existingGroups)
    effectiveItemWrites(plan, 'skip')
    const elapsed = performance.now() - start
    expect(errors).toEqual([])
    expect(plan.creates).toHaveLength(500)
    expect(elapsed).toBeLessThan(2000)
  })
})

describe('CsvFileError', () => {
  it('readItemRows ném đúng kiểu lỗi cho cột thiếu', () => {
    expect(() => readItemRows(rows('A\nB'))).toThrow(CsvFileError)
  })
})
