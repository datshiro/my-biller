import { describe, expect, it } from 'vitest'
import { toBase64 } from '../base64.ts'

describe('toBase64', () => {
  it.each([0, 1, 2, 3, 70_000])('%i byte khớp Buffer.toString(base64)', (length) => {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 31 + 7) & 0xff)
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'))
  })

  it('subarray không kéo theo byte ngoài cửa sổ', () => {
    const whole = Uint8Array.of(1, 2, 3, 4, 5)
    expect(toBase64(whole.subarray(1, 4))).toBe(Buffer.from([2, 3, 4]).toString('base64'))
  })
})
