import { useLiveQuery } from 'dexie-react-hooks'
import { getAppState, getShop } from '@/db/repositories/settings'
import type { AppState, ShopSettings } from '@/domain/schema'

/** `now` đọc cùng lúc với DB để component không phải xem đồng hồ trong lúc render. */
export function useAppState(): (AppState & { now: number }) | undefined {
  return useLiveQuery(async () => ({ ...(await getAppState()), now: Date.now() }))
}

export function useShop(): ShopSettings | undefined {
  return useLiveQuery(() => getShop())
}
