import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { isAdminPath } from './app/admin-path'
import { setAndroidBackHandler } from './app/android-back-handler'
import { DbBlockGate } from './app/db-block-gate'
import { ErrorBoundary } from './app/error-boundary'
import { RecoveryApp } from './app/recovery-app'
import { AppRoutes } from './app/routes'
import { RECOVERY_MODE } from './app/runtime-mode'
import { startUnpairedHeartbeat } from './app/unpaired-heartbeat'
import './styles/index.css'
import { startSyncRunner } from './db/sync/runner'
import { isNativeApp } from './features/printer/printer-sink'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Không tìm thấy #root')

// Cờ handler Back ở phía native sống qua một lần nạp lại trang. Tắt lúc khởi động để Back trước khi router
// mount, hoặc ở màn lỗi lúc khởi động, vẫn thuộc về Android.
if (isNativeApp()) void setAndroidBackHandler(false)

const app = RECOVERY_MODE ? (
  <DbBlockGate>
    <RecoveryApp />
  </DbBlockGate>
) : (
  <ErrorBoundary>
    <DbBlockGate>
      <AppRoutes />
    </DbBlockGate>
  </ErrorBoundary>
)

createRoot(rootEl).render(
  <StrictMode>
    {app}
  </StrictMode>,
)

if (!RECOVERY_MODE && !isAdminPath(location.pathname)) {
  startSyncRunner()
  startUnpairedHeartbeat()
}
