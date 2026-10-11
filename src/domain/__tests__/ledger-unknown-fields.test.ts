import { describe, expect, it } from 'vitest'
import { safeParseLedgerPayload } from '@shared/ledger-schemas'

const GID = '5f1c9a0e-8b1d-4e0a-9f6e-2d3c4b5a6f70'

describe('payload sổ cái bỏ trường lạ một cách im lặng', () => {
  it('Worker chạy schema cũ sẽ XOÁ trường mới khỏi oplog dù parse vẫn thành công', () => {
    const payload = {
      gid: GID,
      name: 'Trà sữa',
      unit: 'ly',
      unitPrice: 25_000,
      costPrice: null,
      qty: 1,
      amount: 25_000,
      note: '',
      truongMoiCuaBanSau: [{ name: 'Trân châu', unitPrice: 5_000, qty: 2 }],
    }
    const parsed = safeParseLedgerPayload('orderLines', payload)

    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data).not.toHaveProperty('truongMoiCuaBanSau')
    // Đây là lý do mỗi trường mới của dòng đơn buộc phải deploy Worker TRƯỚC máy khách: máy khách mới
    // đẩy trường đó lên Worker cũ thì mất vĩnh viễn, kể cả trên máy gốc khi kéo lại từ đầu.
  })
})

describe('trường ghim của món', () => {
  const item = {
    gid: GID,
    name: 'Trà sữa',
    groupId: null,
    unit: 'ly',
    unitPrice: 25_000,
    costPrice: null,
    isActive: 1,
    note: '',
    createdAt: 1,
    updatedAt: 1,
  }

  it('hàng thiếu pinned đi qua schema không sinh khoá — "không biết" phải còn là không biết để Worker giữ ghim', () => {
    const parsed = safeParseLedgerPayload('items', item)

    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data).not.toHaveProperty('pinned')
  })

  it('pinned 0/1 được giữ nguyên qua schema', () => {
    for (const pinned of [0, 1]) {
      const parsed = safeParseLedgerPayload('items', { ...item, pinned })
      expect(parsed.success && parsed.data).toMatchObject({ pinned })
    }
  })
})
