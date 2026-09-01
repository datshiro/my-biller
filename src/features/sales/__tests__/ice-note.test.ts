import { describe, expect, it } from 'vitest'
import { toggleIceToken } from '../ice-note'

/**
 * Một ly không thể vừa đá chung vừa đá riêng — muốn cả hai kiểu thì đó là HAI DÒNG, đúng thứ tính
 * năng này làm. Luật loại trừ nằm ở đây chứ không trong `cart.ts`: `toggleNoteToken` phải giữ nguyên
 * nghĩa toggle thuần, nó không biết gì về nghiệp vụ đá.
 */
describe('hai chip đá loại trừ nhau', () => {
  it('X1 · ghi chú rỗng, bấm Đá chung', () => {
    expect(toggleIceToken('', 'Đá chung')).toBe('Đá chung')
  })

  it('X2 · đang Đá chung mà bấm Đá riêng thì gỡ cái cũ, không giữ cả hai', () => {
    expect(toggleIceToken('Đá chung', 'Đá riêng')).toBe('Đá riêng')
  })

  it('X3 · đổi nhãn đá KHÔNG đụng chữ người bán tự gõ', () => {
    expect(toggleIceToken('ít đường, Đá chung', 'Đá riêng')).toBe('ít đường, Đá riêng')
  })

  it('X4 · bấm lại chính nó vẫn là TẮT, hai chip không phải radio button', () => {
    expect(toggleIceToken('Đá riêng', 'Đá riêng')).toBe('')
  })
})
