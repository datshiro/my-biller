import { useEffect } from 'react'
import { Outlet } from 'react-router'
import { BottomNav } from './bottom-nav'
import { PwaUpdatePrompt } from './pwa-update-prompt'
import { requestPersistentStorageOnFirstGesture } from './storage-persist'
import { getBtReceiver, readBtEnabled } from '@/features/printer/bt-receiver'
import { isNativeApp } from '@/features/printer/printer-sink'
import { SyncBanner } from '@/features/sync/sync-banner'

export function AppLayout() {
  useEffect(requestPersistentStorageOnFirstGesture, [])
  // Đã BẬT nhận in lần trước thì mở app là nghe lại — người bán không phải vào Cài đặt mỗi sáng.
  useEffect(() => {
    if (isNativeApp() && readBtEnabled()) void getBtReceiver().start()
  }, [])

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
