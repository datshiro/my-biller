import { afterEach, describe, expect, it, vi } from 'vitest'
import { tapHaptic } from '../haptic'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('rung khi thêm món', () => {
  it('gọi navigator.vibrate đúng 10ms khi trình duyệt có API rung', () => {
    const vibrate = vi.fn(() => true)
    vi.stubGlobal('navigator', { vibrate })

    tapHaptic()

    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(vibrate).toHaveBeenCalledWith(10)
  })

  it('máy không có API rung (iOS Safari, WebView thiếu quyền) thì không ném lỗi', () => {
    vi.stubGlobal('navigator', {})

    expect(() => tapHaptic()).not.toThrow()
  })
})
