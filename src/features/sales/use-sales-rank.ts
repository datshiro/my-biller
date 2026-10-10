import { useEffect, useState } from 'react'
import { cachedSalesRank, loadSalesRank, type SalesRank } from './sales-rank'

/** `undefined` = đang đọc. Mount lại trong ngày lấy ngay bản đã nhớ, nên quay về từ phiếu không nháy khung giữ chỗ. */
export function useSalesRank(): SalesRank | undefined {
  const [rank, setRank] = useState<SalesRank | undefined>(() => cachedSalesRank(Date.now()))

  useEffect(() => {
    if (rank) return
    let alive = true
    void loadSalesRank(Date.now()).then((loaded) => {
      if (alive) setRank(loaded)
    })
    return () => {
      alive = false
    }
  }, [rank])

  return rank
}
