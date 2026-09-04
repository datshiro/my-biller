import { useState } from 'react'
import { Button } from '@/ui/button'

const LỖI_MẠNG = 'Không kiểm tra được. Xem lại mạng rồi thử lại.'
const LỖI_TẢI = 'Không tải được bản mới. Thử lại sau.'

type Phase =
  | { kind: 'idle' | 'checking' | 'downloading' | 'latest' | 'unavailable' | 'reloading' }
  | { kind: 'ready'; registration: ServiceWorkerRegistration }
  | { kind: 'failed'; message: string }

const LABEL: Record<Phase['kind'], string> = {
  idle: 'KIỂM TRA BẢN MỚI',
  checking: 'Đang kiểm tra…',
  downloading: 'Đang tải bản mới…',
  ready: 'TẢI LẠI NGAY',
  reloading: 'Đang tải lại…',
  latest: 'KIỂM TRA BẢN MỚI',
  unavailable: 'KIỂM TRA BẢN MỚI',
  failed: 'KIỂM TRA BẢN MỚI',
}

const NOTE: Partial<Record<Phase['kind'], string>> = {
  idle: 'App tự kiểm tra bản mới mỗi lần mở. Bấm đây khi được báo có bản mới mà chưa thấy thanh Tải lại.',
  ready: 'Đã tải xong bản mới. Bấm xong mà vẫn thấy màn này thì đóng hẳn app rồi mở lại.',
  reloading: 'Đã tải xong bản mới. Bấm xong mà vẫn thấy màn này thì đóng hẳn app rồi mở lại.',
  latest: 'Đang dùng bản mới nhất.',
  unavailable: 'Chưa có chế độ offline trên bản này, nên không có gì để cập nhật.',
}

/** Chờ worker mới cài xong. `false` nếu nó chết giữa đường (`redundant`). */
function waitUntilInstalled(worker: ServiceWorker): Promise<boolean> {
  return new Promise((resolve) => {
    const settle = () => {
      if (worker.state === 'parsed' || worker.state === 'installing') return
      worker.removeEventListener('statechange', settle)
      resolve(worker.state !== 'redundant')
    }
    worker.addEventListener('statechange', settle)
    settle()
  })
}

/**
 * Trình duyệt chỉ tự kiểm `sw.js` lúc app được mở mới, nên app để chạy nền không bao giờ thấy thanh
 * "Có bản mới". Nút này gọi thẳng `registration.update()` rồi để người bán tự bấm Tải lại — không tự
 * reload, cùng nguyên tắc với `PwaUpdatePrompt`.
 *
 * Dùng API service worker trần thay vì `useRegisterSW` lần hai: mỗi lần gọi hook đó là thêm một
 * `Workbox` đăng ký lại, `db-block-gate.tsx` đã cố ý tránh chuyện này.
 */
export function AppUpdateSection({ reload = () => window.location.reload() }: { reload?: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  const check = async () => {
    setPhase({ kind: 'checking' })
    const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
    if (!registration) {
      setPhase({ kind: 'unavailable' })
      return
    }
    try {
      await registration.update()
    } catch {
      setPhase({ kind: 'failed', message: LỖI_MẠNG })
      return
    }
    // `waiting` có sẵn khi bản mới đã được phát hiện lúc mở app mà người bán bấm "Để sau".
    // Chưa có `active` là lần cài đầu tiên còn đang precache: worker đó sẽ activate thẳng, không qua
    // `waiting`, và trang này vốn đã là bản mới nhất — không phải "bản mới" để tải.
    const fresh = registration.active ? (registration.installing ?? registration.waiting) : null
    if (!fresh) {
      setPhase({ kind: 'latest' })
      return
    }
    setPhase({ kind: 'downloading' })
    if (!(await waitUntilInstalled(fresh))) {
      setPhase({ kind: 'failed', message: LỖI_TẢI })
      return
    }
    setPhase({ kind: 'ready', registration })
  }

  const apply = (registration: ServiceWorkerRegistration) => {
    const waiting = registration.waiting
    if (!waiting) {
      setPhase({ kind: 'failed', message: LỖI_TẢI })
      return
    }
    setPhase({ kind: 'reloading' })
    // `SKIP_WAITING` là message mà SW do Workbox sinh (skipWaiting: false) lắng nghe — cũng là thứ
    // `updateServiceWorker(true)` của plugin gửi. Thanh PwaUpdatePrompt cũng reload ở
    // `controllerchange`; hai cú reload trong cùng tick là vô hại, không cần chặn.
    navigator.serviceWorker.addEventListener('controllerchange', () => reload(), { once: true })
    waiting.postMessage({ type: 'SKIP_WAITING' })
  }

  const busy = phase.kind === 'checking' || phase.kind === 'downloading' || phase.kind === 'reloading'
  const ready = phase.kind === 'ready' || phase.kind === 'reloading'
  const note = NOTE[phase.kind]

  return (
    <>
      <Button
        variant={ready ? 'primary' : 'secondary'}
        disabled={busy}
        onClick={() => (phase.kind === 'ready' ? apply(phase.registration) : void check())}
      >
        {LABEL[phase.kind]}
      </Button>
      {note ? (
        <p className={`mt-2 text-[13px] ${phase.kind === 'latest' ? 'font-semibold text-brand' : 'text-muted'}`}>
          {note}
        </p>
      ) : null}
      {phase.kind === 'failed' ? (
        <p role="alert" className="mt-3 rounded-btn bg-danger-tint px-3 py-2 text-[13px] font-semibold text-danger">
          {phase.message}
        </p>
      ) : null}
    </>
  )
}
