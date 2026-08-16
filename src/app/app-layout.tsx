import { useEffect } from 'react'
import { Outlet } from 'react-router'
import { BottomNav } from './bottom-nav'
import { PwaUpdatePrompt } from './pwa-update-prompt'
import { requestPersistentStorageOnFirstGesture } from './storage-persist'
import { SyncBanner } from '@/features/sync/sync-banner'

export function AppLayout() {
  useEffect(requestPersistentStorageOnFirstGesture, [])

  return (
    <div className="flex h-dvh flex-col bg-white">
      <main className="min-h-0 flex-1 overflow-y-auto">
        <SyncBanner />
        <Outlet />
      </main>
      <PwaUpdatePrompt />
      <BottomNav />
    </div>
  )
}
