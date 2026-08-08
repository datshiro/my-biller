// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
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

afterEach(() => {
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
})
