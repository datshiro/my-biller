import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router'
import {
  clearDeviceNotice,
  getDeviceConnection,
  getDeviceNotice,
  getDeviceSyncState,
} from '@/db/repositories/device-state'
import { countPendingOperations } from '@/db/sync/outbox'

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const connected = () => setOnline(true)
    const disconnected = () => setOnline(false)
    window.addEventListener('online', connected)
    window.addEventListener('offline', disconnected)
    return () => {
      window.removeEventListener('online', connected)
      window.removeEventListener('offline', disconnected)
    }
  }, [])
  return online
}

export function SyncBanner() {
  const online = useOnline()
  const state = useLiveQuery(async () => {
    const [connection, sync, pending, notice] = await Promise.all([
      getDeviceConnection(),
      getDeviceSyncState(),
      countPendingOperations(),
      getDeviceNotice(),
    ])
    return { connection, sync, pending, notice: notice ?? null }
  })

  if (!state) return null

  const notice = state.notice ? (
      <div
        role="alert"
        className="flex items-start gap-3 bg-danger-tint px-4 py-2.5 text-[13px] font-semibold text-danger"
      >
        <span className="min-w-0 flex-1">
          {state.notice.message}{' '}
          <Link to="/ghep-may" className="underline">
            Xem máy
          </Link>
        </span>
        {state.notice.kind === 'sync' ? (
          <button
            type="button"
            className="shrink-0 underline"
            aria-label="Ẩn thông báo đồng bộ"
            onClick={() => void clearDeviceNotice(state.notice!.id)}
          >
            Ẩn
          </button>
        ) : null}
      </div>
    ) : null

  let currentStatus = null
  if (state.connection && state.sync.resyncRequired) {
    currentStatus = (
      <div
        role="status"
        aria-live="polite"
        className="bg-warn-tint px-4 py-2.5 text-[13px] font-semibold text-warn"
      >
        Dữ liệu trên máy vừa khác sổ chung. App đang kéo lại toàn bộ sổ…
      </div>
    )
  } else if (state.connection && !online) {
    currentStatus = (
      <div
        role="status"
        aria-live="polite"
        className="bg-warn-tint px-4 py-2.5 text-[13px] font-semibold text-warn"
      >
        Chưa có mạng.{' '}
        {state.pending > 0
          ? `${state.pending} thay đổi đang nằm trên máy này và sẽ tự đồng bộ khi có mạng.`
          : 'Thay đổi mới sẽ tự đồng bộ khi có mạng.'}
      </div>
    )
  } else if (state.connection && state.pending > 0) {
    currentStatus = (
      <div
        role="status"
        aria-live="polite"
        className="bg-warn-tint px-4 py-2.5 text-[13px] font-semibold text-warn"
      >
        Đang đưa {state.pending} thay đổi lên sổ chung…
      </div>
    )
  }

  return notice || currentStatus ? <>{notice}{currentStatus}</> : null
}
