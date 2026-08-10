import { useEffect, useEffectEvent, useRef, type RefObject } from 'react'
import { Button } from './button'

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  returnFocusRef,
  pending = false,
}: {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
  pending?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const cancelFromEscape = useEffectEvent(() => {
    if (!pending) onCancel()
  })

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const returnTarget = returnFocusRef?.current ?? previousFocus
    cancelRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelFromEscape()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return

      const stops = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      const first = stops[0]
      const last = stops[stops.length - 1]
      if (!first || !last) return

      const active = document.activeElement
      const outside = !panelRef.current.contains(active)
      if (event.shiftKey && (active === first || active === panelRef.current || outside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || active === panelRef.current || outside)) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (returnTarget?.isConnected) returnTarget.focus()
    }
  }, [returnFocusRef])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/40"
      onClick={() => {
        if (!pending) onCancel()
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        aria-busy={pending || undefined}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="safe-bottom w-full rounded-t-sheet bg-white px-4 pt-5"
      >
        <h2 className="text-[20px] font-bold">{title}</h2>
        <p className="mt-2 text-muted">{message}</p>
        <div className="mt-5 flex gap-3">
          <Button
            ref={cancelRef}
            variant="secondary"
            className="flex-1"
            aria-disabled={pending || undefined}
            onClick={() => {
              if (!pending) onCancel()
            }}
          >
            Huỷ
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            aria-disabled={pending || undefined}
            onClick={() => {
              if (!pending) onConfirm()
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
