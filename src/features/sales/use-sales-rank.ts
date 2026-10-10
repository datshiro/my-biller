import { useEffect, useState } from 'react'
import { cachedSalesRank, loadSalesRank, type SalesRank } from './sales-rank'

const KHONG_XEP_HANG: SalesRank = new Map()

/** `undefined` = đang đọc. Đọc hỏng thì trả thứ hạng rỗng để lưới về thứ tự tên, không kẹt ở khung giữ chỗ. */
export function useSalesRank(): SalesRank | undefined {
  const [rank, setRank] = useState<SalesRank | undefined>(() => cachedSalesRank(Date.now()))

  useEffect(() => {
    if (rank) return
    let alive = true
    loadSalesRank(Date.now()).then(
      (loaded) => {
        if (alive) setRank(loaded)
      },
      (caught: unknown) => {
        console.error('Không đọc được thứ hạng bán chạy:', caught)
        if (alive) setRank(KHONG_XEP_HANG)
      },
    )
    return () => {
      alive = false
    }
  }, [rank])

  return rank
}
