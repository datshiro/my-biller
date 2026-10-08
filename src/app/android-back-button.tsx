import { App } from '@capacitor/app'
import { useEffect, useEffectEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { decideBack } from './back-button'
import { isNativeApp } from '@/features/printer/printer-sink'
import { dismissTopOverlay } from '@/ui/back-dismiss'

/**
 * Nhận phím Back của Android. Có listener thì plugin App không tự `goBack()` nữa, nên mọi nhánh ở đây phải
 * tự xử lý. Không dùng `canGoBack` của sự kiện: đó là lịch sử WebView, có thể lệch với router sau một
 * `navigate(..., { replace: true })` — `history.state.idx` của BrowserRouter mới là nguồn đúng.
 */
export function AndroidBackButton() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const onBack = useEffectEvent(() => {
    if (dismissTopOverlay()) return
    const action = decideBack({
      overlayOpen: false,
      pathname,
      historyIdx: (window.history.state as { idx?: number } | null)?.idx ?? 0,
    })
    if (action === 'navigate-back') void navigate(-1)
    else if (action === 'go-home') void navigate('/', { replace: true })
    else if (action === 'minimize') void App.minimizeApp()
  })

  useEffect(() => {
    if (!isNativeApp()) return
    let unmounted = false
    let remove: (() => Promise<void>) | undefined
    App.addListener('backButton', () => onBack())
      .then((handle) => {
        if (unmounted) void handle.remove()
        else remove = handle.remove
      })
      .catch((error: unknown) => console.error('Không đăng ký được phím Back:', error))
    return () => {
      unmounted = true
      void remove?.()
    }
  }, [])

  return null
}
