import { format } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { getRestoreBlock } from '@/db/backup'
import { getLedgerOverview, getSyncAnchor } from '@/db/doi-soat-snapshot'
import { getAppState, getShop } from '@/db/repositories/settings'
import {
  getDeviceConnection,
  getDeviceConnectionSnapshot,
  getDeviceIdentity,
  getDeviceNotice,
  getInstallId,
} from '@/db/repositories/device-state'
import type { AppState, DeviceConnection, DeviceIdentity, DeviceNotice, ShopSettings } from '@/domain/schema'

/** `now` đọc cùng lúc với DB để component không phải xem đồng hồ trong lúc render. */
export function useAppState(): (AppState & { now: number }) | undefined {
  return useLiveQuery(async () => ({ ...(await getAppState()), now: Date.now() }))
}

export function useShop(): ShopSettings | undefined {
  return useLiveQuery(() => getShop())
}

/** `undefined` = đang đọc; `null` = máy chưa được cài danh tính. */
export function useDeviceIdentity(): DeviceIdentity | null | undefined {
  return useLiveQuery(async () => (await getDeviceIdentity()) ?? null)
}

/** `undefined` = đang đọc; `null` = máy chưa ghép vào sổ chung. */
export function useDeviceConnection(): DeviceConnection | null | undefined {
  return useLiveQuery(async () => (await getDeviceConnection()) ?? null)
}

/** `undefined` = đang đọc; `null` = chưa có mã cài đặt. Chỉ đọc, không tạo. */
export function useInstallId(): string | null | undefined {
  return useLiveQuery(async () => (await getInstallId()) ?? null)
}

/** Connection và pairing phải đến từ cùng một snapshot để không mount UI active bằng token pending. */
export function useDeviceConnectionSnapshot() {
  return useLiveQuery(() => getDeviceConnectionSnapshot())
}

export function useDeviceNotice(): DeviceNotice | null | undefined {
  return useLiveQuery(async () => (await getDeviceNotice()) ?? null)
}

/** Neo đồng bộ cho màn Đối soát — rẻ, tách khỏi phần tổng để bão drain outbox không kéo theo 9 bảng. */
export function useSyncAnchor() {
  return useLiveQuery(() => getSyncAnchor())
}

export function useLedgerOverview() {
  return useLiveQuery(() => getLedgerOverview())
}

/** Dòng "lần sao lưu cuối" — dùng chung cho màn Sao lưu & khôi phục và dòng dẫn tới nó ở Cài đặt. */
export function useLastBackupLine(): string {
  const state = useAppState()
  if (state === undefined) return '…'
  if (state.lastBackupAt === null) return 'Chưa sao lưu lần nào'
  return `Lần cuối: ${format(state.lastBackupAt, "HH:mm 'ngày' d/M/yyyy")}`
}

/** Vì sao máy này không khôi phục từ file được; `undefined` khi chưa đọc xong, `null` khi không bị chặn. */
export function useRestoreBlock() {
  return useLiveQuery(() => getRestoreBlock())
}
