import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { format } from 'date-fns'
import { useLedgerOverview, useSyncAnchor } from './use-settings'
import type { CountedTable, SyncAnchor } from '@/db/doi-soat-snapshot'
import { listShopDevices, SyncApiError } from '@/db/sync/client'
import { SYNC_WAKE_EVENT } from '@/db/sync/runner'
import type { DeviceConnection } from '@/domain/schema'
import { Button } from '@/ui/button'
import { ListSkeleton } from '@/ui/empty-state'
import { MoneyText } from '@/ui/money-text'
import { ScreenHeader } from '@/ui/screen-header'

const REQUEST_TIMEOUT_MS = 8_000
const RECHECK_DEBOUNCE_MS = 2_000

/**
 * `seq` mới nhất của sổ chung là state React, không phải liveQuery: nó đến từ mạng, đọc lúc mount và
 * khi bấm "Kiểm tra lại". `unsupported` là phản hồi 200 nhưng thiếu `latestSeq` (Worker cũ) — tách
 * riêng khỏi `failed` và tuyệt đối không coi là `0`, vì `0` sẽ trượt thẳng vào nhánh "khớp".
 */
type ServerState =
  | { kind: 'idle' }
  | { kind: 'ok'; latestSeq: number; checkedAt: number }
  | { kind: 'unsupported'; checkedAt: number }
  | { kind: 'failed'; reason: 'network' | 'unauthorized' | 'other'; checkedAt: number }

function failureReason(caught: unknown): 'network' | 'unauthorized' | 'other' {
  // Không phải SyncApiError = hết 8 giây (AbortError của chính mình) hoặc lỗi lạ: không phải mất mạng, không phải thu hồi.
  if (!(caught instanceof SyncApiError)) return 'other'
  if (caught.code === 'network') return 'network'
  return caught.status === 401 ? 'unauthorized' : 'other'
}

const REVOKED_LINE =
  'Máy này đã bị thu hồi khỏi sổ chung. Số dưới đây là bản đóng băng lúc bị thu hồi.'

type AnchorView = { line: string; showTotals: boolean; button: 'hidden' | 'disabled' | 'enabled' }

/**
 * Mười hai nhánh, xét từ trên xuống và dừng ở nhánh đầu tiên đúng. Thứ tự là hợp đồng với test:
 * thu hồi đứng trên "chưa ghép" vì `markDeviceRevoked` xoá `connection` sau khi ghi `writeBlock`;
 * kéo lại sổ đứng trên mọi con số vì lúc đó mọi số đều dở dang; hàng đợi đứng trên phép so `seq`
 * vì khi còn hàng đợi bốn tổng đang lạc quan hơn sổ chung.
 */
function describeAnchor(anchor: SyncAnchor, server: ServerState, checking: boolean): AnchorView {
  const shown = (line: string, button: AnchorView['button'] = 'enabled'): AnchorView => ({
    line,
    showTotals: true,
    button,
  })
  if (anchor.revoked) return shown(REVOKED_LINE, 'hidden')
  if (anchor.resyncRequired) {
    return {
      line: 'App đang kéo lại toàn bộ sổ — chưa so được. Đợi băng trên đầu màn tắt rồi mở lại.',
      showTotals: false,
      button: 'hidden',
    }
  }
  if (!anchor.connection) {
    return shown('Máy này chưa ghép sổ chung. Số dưới đây là sổ của riêng máy này.', 'hidden')
  }
  if (anchor.pairingSaved) return shown('Đang hoàn tất ghép máy — chưa đối soát được.', 'hidden')
  if (server.kind === 'idle') return shown('Đang kiểm tra sổ chung…', 'disabled')
  if (server.kind === 'failed' && server.reason === 'network') {
    return shown('Chưa có mạng — số dưới đây là bản trên máy này.')
  }
  if (server.kind === 'unsupported') {
    return shown('Sổ chung chưa hỗ trợ đối soát — cần cập nhật máy chủ.')
  }
  if (server.kind === 'failed') {
    return shown(
      server.reason === 'unauthorized'
        ? REVOKED_LINE
        : 'Chưa đọc được sổ chung — số dưới đây là bản trên máy này.',
    )
  }
  if (anchor.pending > 0) return shown(`${anchor.pending} thay đổi trên máy này chưa lên sổ chung.`)
  if (server.latestSeq > anchor.lastSeq) {
    return shown(`Còn ${server.latestSeq - anchor.lastSeq} thay đổi chưa về máy này.`)
  }
  if (anchor.lastSeq > server.latestSeq) {
    // Không kẹp về 0: số máy chủ đã cũ nghĩa là máy khác vừa bán. Tự hỏi lại một lần rồi mới nhờ tay.
    return checking
      ? shown('Đang kiểm tra sổ chung…', 'disabled')
      : shown('Sổ chung vừa có thay đổi mới — bấm Kiểm tra lại.')
  }
  return shown(`✓ Khớp sổ chung — máy này ở thay đổi #${anchor.lastSeq}`)
}

const TABLE_LABELS: Record<CountedTable, string> = {
  itemGroups: 'Nhóm hàng',
  items: 'Mặt hàng',
  customers: 'Khách hàng',
  customerPrices: 'Giá theo khách',
  orders: 'Đơn',
  orderLines: 'Dòng đơn',
  payments: 'Khoản thu',
  expenseCategories: 'Nhóm chi phí',
  expenses: 'Chi phí',
}

function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-4">
      <h2 className="label-xs text-muted">{title}</h2>
      <p className="mt-0.5 text-[13px] text-muted">{note}</p>
      <div className="mt-2 divide-y divide-line">{children}</div>
    </section>
  )
}

/** Nhãn là một <span>, số là <span> liền sau trong cùng thẻ cha — keyword Robot `Đọc Ô Số` đọc theo đúng cặp này. */
function TotalRow({ label, value, tone }: { label: string; value: number; tone: 'brand' | 'danger' | 'warn' }) {
  return (
    <div className="flex items-baseline justify-between py-2.5">
      <span className="label-xs text-muted">{label}</span>
      <MoneyText value={value} size="lg" tone={tone} />
    </div>
  )
}

function CountRow({ table, count }: { table: CountedTable; count: number }) {
  return (
    <div className="flex items-baseline justify-between py-2.5">
      <span className="text-[15px]">
        {TABLE_LABELS[table]}
        {table === 'orders' ? <span className="text-[13px] text-muted"> (gồm đơn đã hủy)</span> : null}
      </span>
      <span className="money font-semibold">{count}</span>
    </div>
  )
}

export function DoiSoatPage() {
  const anchor = useSyncAnchor()
  const overview = useLedgerOverview()
  const [server, setServer] = useState<ServerState>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(false)
  const [recheckPending, setRecheckPending] = useState(false)
  const requestId = useRef(0)
  const inflight = useRef<{ controller: AbortController; timer: number } | null>(null)
  const recheckedFor = useRef<number | null>(null)

  // Neo tự tính lại mỗi khi outbox đổi và mỗi object trả về là một tham chiếu mới, nên effect fetch
  // neo theo nội dung connection (bốn trường nguyên thuỷ) chứ không theo tham chiếu — đổi tham chiếu
  // mà không đổi nội dung thì không được hỏi lại máy chủ.
  const connectionKey = anchor?.connection ? JSON.stringify(anchor.connection) : null
  const connection = useMemo<DeviceConnection | null>(
    () => (connectionKey ? (JSON.parse(connectionKey) as DeviceConnection) : null),
    [connectionKey],
  )
  const canAsk =
    anchor !== undefined &&
    !anchor.revoked &&
    !anchor.resyncRequired &&
    connection !== null &&
    !anchor.pairingSaved

  const check = useCallback((target: DeviceConnection) => {
    inflight.current?.controller.abort()
    if (inflight.current) window.clearTimeout(inflight.current.timer)
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    inflight.current = { controller, timer }
    // Chỉ phản hồi của request mới nhất được ghi vào state; hai lần bấm về ngược thứ tự thì lần cũ im.
    const id = ++requestId.current
    const settle = (next: ServerState) => {
      window.clearTimeout(timer)
      if (id !== requestId.current) return
      inflight.current = null
      setServer(next)
      setBusy(false)
    }
    void listShopDevices(target, { signal: controller.signal }).then(
      (result) =>
        settle(
          typeof result.latestSeq === 'number'
            ? { kind: 'ok', latestSeq: result.latestSeq, checkedAt: Date.now() }
            : { kind: 'unsupported', checkedAt: Date.now() },
        ),
      (caught: unknown) => settle({ kind: 'failed', reason: failureReason(caught), checkedAt: Date.now() }),
    )
  }, [])

  useEffect(() => {
    if (!canAsk || !connection) return
    window.dispatchEvent(new Event(SYNC_WAKE_EVENT))
    void check(connection)
    return () => {
      requestId.current += 1
      inflight.current?.controller.abort()
      if (inflight.current) window.clearTimeout(inflight.current.timer)
      inflight.current = null
    }
  }, [canAsk, connection, check])

  // Số máy chủ đã cũ hơn máy này: hỏi lại đúng một lần cho mỗi `lastSeq` mới, gom trong 2 giây.
  const lastSeq = anchor?.lastSeq
  const serverStale = server.kind === 'ok' && lastSeq !== undefined && lastSeq > server.latestSeq
  useEffect(() => {
    if (!serverStale || !canAsk || !connection || lastSeq === undefined) return
    if (recheckedFor.current === lastSeq) return
    recheckedFor.current = lastSeq
    setRecheckPending(true)
    const timer = window.setTimeout(() => {
      setRecheckPending(false)
      setBusy(true)
      void check(connection)
    }, RECHECK_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      setRecheckPending(false)
    }
  }, [serverStale, canAsk, connection, lastSeq, check])

  useEffect(() => {
    if (!cooldown) return
    const timer = window.setTimeout(() => setCooldown(false), RECHECK_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  const recheck = () => {
    if (!connection) return
    window.dispatchEvent(new Event(SYNC_WAKE_EVENT))
    setCooldown(true)
    setBusy(true)
    void check(connection)
  }

  if (anchor === undefined) {
    return (
      <div className="min-h-full">
        <ScreenHeader title="Đối soát" back="back" />
        <div className="p-4">
          <ListSkeleton rows={4} />
        </div>
      </div>
    )
  }

  const view = describeAnchor(anchor, server, busy || recheckPending)
  const checkedAt = server.kind === 'idle' ? null : server.checkedAt

  return (
    <div className="min-h-full pb-6">
      <ScreenHeader title="Đối soát" back="back" />

      <section className="px-4 py-4">
        <h2 className="label-xs text-muted">SỔ CHUNG</h2>
        <p role="status" aria-live="polite" aria-label="Neo đồng bộ" className="mt-2 text-[15px] font-semibold">
          {view.line}
        </p>
        {/* Mốc giờ nằm ngoài phần tử role=status: hai máy so nguyên câu neo, mà hai máy không đọc cùng một phút. */}
        {checkedAt !== null ? (
          <span className="mt-1 block text-[13px] text-muted">đối chiếu lúc {format(checkedAt, 'HH:mm')}</span>
        ) : null}
        {view.button !== 'hidden' ? (
          <div className="mt-3">
            <Button
              variant="secondary"
              disabled={view.button === 'disabled' || busy || cooldown}
              onClick={recheck}
            >
              Kiểm tra lại
            </Button>
          </div>
        ) : null}
      </section>

      {view.showTotals ? (
        overview === undefined ? (
          <ListSkeleton rows={4} />
        ) : (
          <>
            <Section title="TỔNG TOÀN SỔ" note="Tính trên toàn bộ lịch sử, không theo ngày.">
              <TotalRow label="DOANH THU" value={overview.totals.revenue} tone="brand" />
              <TotalRow label="ĐÃ THU" value={overview.totals.collected} tone="brand" />
              <TotalRow label="CHI PHÍ" value={overview.totals.expenses} tone="danger" />
              <TotalRow label="CÒN NỢ" value={overview.totals.debtTotal} tone="warn" />
            </Section>
            <Section title="SỐ DÒNG TỪNG BẢNG" note="Dùng để so nhanh với máy khác.">
              {overview.counts.map(({ table, count }) => (
                <CountRow key={table} table={table} count={count} />
              ))}
            </Section>
          </>
        )
      ) : null}

      <p className="px-4 pt-3 text-[13px] text-muted">
        Để so 2 máy: mở màn này trên cả hai máy lúc đều có mạng, đợi cả hai hiện "✓ Khớp sổ chung" với
        cùng số #. Khác số thì bấm Kiểm tra lại ở máy có số nhỏ hơn. Cùng số # mà bốn tổng vẫn lệch mới
        là lỗi phần mềm — báo ngay.
      </p>
    </div>
  )
}
