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
