import { useEffect, useState } from 'react'
import { addDays, startOfDay } from 'date-fns'

/**
 * Nhích một nấc mỗi khi qua nửa đêm. Dùng làm dep cho `useLiveQuery` của những con số tính theo
 * "hôm nay": `useLiveQuery` chỉ chạy lại khi bảng nó quan sát đổi, nên quán vắng từ 23:30 tới 00:30
 * là suốt một tiếng đó thanh tiêu đề vẫn ghi "HÔM NAY" kèm doanh thu của hôm qua.
 */
export function useDayTick(): number {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    let day = startOfDay(Date.now()).getTime()

    /** Chỉ nhích khi ngày thật sự đổi — nhích thừa là bắt mọi `useLiveQuery` phụ thuộc chạy lại. */
    const bump = () => {
      const today = startOfDay(Date.now()).getTime()
      if (today === day) return
      day = today
      setTick((previous) => previous + 1)
    }

    const schedule = () => {
      const now = Date.now()
      timer = setTimeout(
        () => {
          bump()
          schedule()
        },
        Math.max(1_000, addDays(startOfDay(now), 1).getTime() - now),
      )
    }
    schedule()

    /**
     * Điện thoại bóp timer của trang đang chạy nền, nên chỉ trông vào `setTimeout` là quán đóng cửa
     * lúc 22h, sáng mở app ra vẫn thấy "HÔM NAY" kèm doanh thu hôm qua. Lúc trang hiện lại là lúc
     * duy nhất chắc chắn có người đang nhìn, nên đối chiếu ngày ngay tại đó và hẹn lại giờ.
     */
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      bump()
      clearTimeout(timer)
      schedule()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return tick
}
