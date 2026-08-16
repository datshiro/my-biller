import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DbBlockGate } from './app/db-block-gate'
import { ErrorBoundary } from './app/error-boundary'
import { RecoveryApp } from './app/recovery-app'
import { AppRoutes } from './app/routes'
import { RECOVERY_MODE } from './app/runtime-mode'
import './styles/index.css'
import { startSyncRunner } from './db/sync/runner'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Không tìm thấy #root')

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

if (!RECOVERY_MODE) {
  startSyncRunner()
}
