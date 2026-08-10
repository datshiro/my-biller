import { db } from '../db'
import {
  AppStateSchema,
  DEFAULT_APP_STATE,
  DEFAULT_SHOP,
  ShopSettingsSchema,
  type AppState,
  type ShopSettings,
} from '@/domain/schema'

export async function getShop(): Promise<ShopSettings> {
  const row = await db.settings.get('shop')
  // Lần chạy đầu chưa có gì — trả mặc định để phiếu bán hàng không vỡ vì thiếu tên cửa hàng.
  return { ...DEFAULT_SHOP, ...(row?.key === 'shop' ? row.value : {}) }
}

export async function saveShop(patch: Partial<ShopSettings>): Promise<void> {
  const next = ShopSettingsSchema.parse({ ...(await getShop()), ...patch })
  await db.settings.put({ key: 'shop', value: next })
}

export async function getAppState(): Promise<AppState> {
  const row = await db.settings.get('app')
  return { ...DEFAULT_APP_STATE, ...(row?.key === 'app' ? row.value : {}) }
}

export async function saveAppState(patch: Partial<AppState>): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const row = await db.settings.get('app')
    const current = { ...DEFAULT_APP_STATE, ...(row?.key === 'app' ? row.value : {}) }
    const next = AppStateSchema.parse({ ...current, ...patch })
    await db.settings.put({ key: 'app', value: next })
  })
}

/** Hai tab có thể hoàn tất hai snapshot theo thứ tự ngược; mốc đã lưu chỉ được tiến về phía trước. */
export async function saveLastBackupAt(at: number): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const row = await db.settings.get('app')
    const current = { ...DEFAULT_APP_STATE, ...(row?.key === 'app' ? row.value : {}) }
    const lastBackupAt = Math.max(current.lastBackupAt ?? at, at)
    const next = AppStateSchema.parse({ ...current, lastBackupAt })
    await db.settings.put({ key: 'app', value: next })
  })
}
