import { useLiveQuery } from 'dexie-react-hooks'
import { getDeviceSyncState } from '@/db/repositories/device-state'

export function useSyncRevision(): number {
  return useLiveQuery(async () => (await getDeviceSyncState()).revision, [], 0)
}
