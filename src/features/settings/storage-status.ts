import { useCallback, useEffect, useState } from 'react'
import { countAllRecords } from '@/db/backup'
import { requestPersistentStorage } from '@/app/storage-persist'

export type StorageStatus = {
  /** Trình duyệt đã hứa không tự xoá dữ liệu. Đọc từ chính trình duyệt, không từ cờ đã lưu. */
  persisted: boolean
  usedBytes: number | null
  records: number
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const mb = bytes / (1024 * 1024)
  return mb < 1 ? `${Math.round(bytes / 1024)} KB` : `${mb.toFixed(1)} MB`
}

async function readStorageStatus(): Promise<StorageStatus> {
  const [persisted, estimate, records] = await Promise.all([
    navigator.storage?.persisted?.() ?? Promise.resolve(false),
    navigator.storage?.estimate?.() ?? Promise.resolve(undefined),
    countAllRecords(),
  ])
  return { persisted, usedBytes: estimate?.usage ?? null, records }
}

export function useStorageStatus(): {
  status: StorageStatus | undefined
  pinning: boolean
  pin: () => void
} {
  const [status, setStatus] = useState<StorageStatus>()
  const [pinning, setPinning] = useState(false)

  const refresh = useCallback(() => {
    let alive = true
    void readStorageStatus().then((next) => {
      if (alive) setStatus(next)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(refresh, [refresh])

  const pin = useCallback(() => {
    setPinning(true)
    void requestPersistentStorage()
      .then(() => void readStorageStatus().then(setStatus))
      .finally(() => setPinning(false))
  }, [])

  return { status, pinning, pin }
}
