import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DbBlockGate } from './app/db-block-gate'
import { ErrorBoundary } from './app/error-boundary'
import { AppRoutes } from './app/routes'
import './styles/index.css'
import { startSyncRunner } from './db/sync/runner'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Không tìm thấy #root')

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <DbBlockGate>
        <AppRoutes />
      </DbBlockGate>
    </ErrorBoundary>
  </StrictMode>,
)

startSyncRunner()
