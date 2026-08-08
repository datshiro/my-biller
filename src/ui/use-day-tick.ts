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
    const schedule = () => {
      const now = Date.now()
      timer = setTimeout(
        () => {
          setTick((previous) => previous + 1)
          schedule()
        },
        Math.max(1_000, addDays(startOfDay(now), 1).getTime() - now),
      )
    }
    schedule()
    return () => clearTimeout(timer)
  }, [])

  return tick
}
