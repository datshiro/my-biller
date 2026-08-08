// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDayTick } from '../use-day-tick'

const NOON = new Date(2026, 7, 7, 12, 0).getTime()
const DAY = 24 * 60 * 60 * 1000

const setNow = (at: number) => vi.spyOn(Date, 'now').mockReturnValue(at)

const showPage = () => {
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  setNow(NOON)
})

// Dự án không bật `globals` của vitest nên RTL không tự dọn. Thiếu dòng này thì hook của ca trước
// vẫn còn gắn khi ca sau chạy, và `showPage()` đánh thức cả hai.
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/**
 * Điện thoại bóp timer của trang chạy nền. `setTimeout` tới nửa đêm vì thế không phải một lời hứa —
 * và cái giá của việc tin nó là màn hình ghi "HÔM NAY" kèm doanh thu hôm qua.
 */
describe('useDayTick', () => {
  it('nhích một nấc khi qua nửa đêm', () => {
    const { result } = renderHook(() => useDayTick())
    expect(result.current).toBe(0)

    setNow(NOON + DAY)
    act(() => vi.advanceTimersByTime(12 * 60 * 60 * 1000))

    expect(result.current).toBe(1)
  })

  it('trang hiện lại sau khi qua ngày thì nhích ngay, không chờ timer', () => {
    const { result } = renderHook(() => useDayTick())

    // Timer chưa hề chạy — đúng cảnh trang bị treo dưới nền qua đêm rồi được mở lại.
    setNow(NOON + DAY)
    showPage()

    expect(result.current).toBe(1)
  })

  it('trang hiện lại trong cùng ngày thì không nhích', () => {
    const { result } = renderHook(() => useDayTick())

    setNow(NOON + 60_000)
    showPage()
    showPage()

    expect(result.current).toBe(0)
  })

  /**
   * Năm màn hình cùng gọi hook này và chúng bị tháo/dựng lại mỗi lần đổi tab. Rò một listener hay một
   * timer mỗi lần tháo thì sau một ca bán hàng, mỗi lần hiện lại trang là hàng chục lượt hẹn giờ cùng
   * nổ. Không ca nào ở trên bắt được chuyện đó vì chúng chỉ nhìn hook còn sống.
   */
  it('tháo hook thì gỡ sạch cả timer lẫn listener', () => {
    const { unmount } = renderHook(() => useDayTick())
    expect(vi.getTimerCount()).toBe(1)

    unmount()
    expect(vi.getTimerCount()).toBe(0)

    // Nếu listener còn sót, `bump()` chạy và hẹn lại giờ — số timer sẽ nhảy lên 1.
    setNow(NOON + DAY)
    showPage()
    expect(vi.getTimerCount()).toBe(0)
  })
})
