import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './app/error-boundary'
import { AppRoutes } from './app/routes'
import './styles/index.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Không tìm thấy #root')

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <AppRoutes />
    </ErrorBoundary>
  </StrictMode>,
)
