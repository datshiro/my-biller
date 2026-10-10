import { describe, expect, it } from 'vitest'
import { shortId } from '@/domain/short-id'

describe('shortId', () => {
  it('rút mã UUID thành bốn ký tự đầu, dấu …, ba ký tự cuối', () => {
    expect(shortId('3f9a1234-aaaa-bbbb-cccc-dddddddddc21')).toBe('3f9a…c21')
  })

  it('chuỗi đúng 8 ký tự vẫn rút gọn theo cùng quy tắc', () => {
    expect(shortId('3f9a1234')).toBe('3f9a…234')
  })

  it('chuỗi 7 ký tự giữ nguyên', () => {
    expect(shortId('3f9a123')).toBe('3f9a123')
  })

  it('chuỗi rỗng giữ nguyên', () => {
    expect(shortId('')).toBe('')
  })
})
