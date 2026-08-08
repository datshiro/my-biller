import { useSyncExternalStore, type ReactNode } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { getDbBlock, subscribeDbBlock, type DbBlockReason } from '@/db/db-block'
import { Button } from '@/ui/button'

/**
 * Chặn cả app khi kho dữ liệu không còn dùng được. Khác `ErrorBoundary` ở chỗ nó không đợi cây React
 * sập — Dexie đóng kết nối thì không có gì ném cả, màn hình vẫn hiện y như cũ và người bán cứ bấm.
 */
export function DbBlockGate({ children }: { children: ReactNode }): ReactNode {
  const reason = useSyncExternalStore(subscribeDbBlock, getDbBlock, getDbBlock)
  if (!reason) return children
  return <DbBlockScreen reason={reason} />
}

/**
 * Chỉ mount khi đã bị chặn — nhờ vậy `useRegisterSW` ở đây không chạy song song với lời gọi trong
 * `PwaUpdatePrompt`, vì lúc này cả cây `AppRoutes` đã bị thay bằng màn này.
 */
function DbBlockScreen({ reason }: { reason: DbBlockReason }) {
  const { updateServiceWorker } = useRegisterSW()

  return (
    <div className="flex min-h-dvh flex-col justify-center gap-4 p-6">
      {reason === 'stale-app' ? (
        <>
          <h1 className="text-[24px] font-bold">Cần cập nhật app</h1>
          <p className="text-[17px]">
            Dữ liệu trong máy đã ở bản mới hơn app đang chạy, nên bản này không đọc được nữa. Bán tiếp
            thì đơn sẽ không lưu được. Dữ liệu vẫn nằm nguyên trong máy, chưa mất gì.
          </p>
          <Button size="cta" onClick={() => void updateServiceWorker(true)}>
            CẬP NHẬT NGAY
          </Button>
          <p className="text-[15px] text-muted">
            Bấm xong mà vẫn thấy màn này thì đóng hẳn app rồi mở lại.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-[24px] font-bold">Còn tab khác đang mở app</h1>
          <p className="text-[17px]">
            Một tab hoặc cửa sổ khác đang giữ bản cũ, nên máy không nâng cấp dữ liệu được. Đóng hết
            những tab đó rồi bấm thử lại.
          </p>
          <Button size="cta" onClick={() => window.location.reload()}>
            THỬ LẠI
          </Button>
        </>
      )}
    </div>
  )
}
