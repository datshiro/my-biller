import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  useDeviceConnection,
  useDeviceConnectionSnapshot,
  useDeviceIdentity,
  useDeviceNotice,
  useSyncAnchor,
} from './use-settings'
import {
  beginDevicePairing,
  cancelDevicePairing,
  leaveSharedLedger,
  markDeviceRevoked,
  savePairedDevice,
} from '@/db/repositories/device-state'
import {
  createPairCode,
  DEFAULT_SYNC_URL,
  listShopDevices,
  pairDevice,
  revokeShopDevice,
  SyncApiError,
  type ShopDevice,
} from '@/db/sync/client'
import { SYNC_WAKE_EVENT } from '@/db/sync/runner'
import {
  isLastActiveDevice,
  isTimeout,
  UnpairBlockedError,
  UnpairUncertainError,
  unpairThisDevice,
} from '@/db/sync/unpair'
import { Button } from '@/ui/button'
import { StatusChip } from '@/ui/chip'
import { ConfirmDialog } from '@/ui/confirm-dialog'
import { ListSkeleton } from '@/ui/empty-state'
import { ScreenHeader } from '@/ui/screen-header'
import { TextField } from '@/ui/text-field'

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Không kết nối được với sổ chung. Thử lại.'

const LEFT_NOTICE = 'Máy này đã rời sổ chung. Sổ trên máy giữ nguyên và giờ là sổ cục bộ.'

const pendingText = (pending: number) =>
  `Còn ${pending} thay đổi chưa lên sổ chung. Chờ đồng bộ xong rồi huỷ ghép.`
const RESYNC_TEXT = 'Máy đang kéo lại sổ chung. Chờ xong rồi huỷ ghép.'
const LEAVE_TEXT =
  'Máy này sẽ rời sổ chung và thành máy chưa ghép. Sổ trên máy được giữ nguyên làm sổ cục bộ, đúng như lúc huỷ ghép; máy khác sẽ không thấy thay đổi mới của máy này nữa. Muốn ghép lại vào sổ chung sau này phải sao lưu rồi xoá sổ trên máy trước, và dùng một chữ cái khác.'
const LAST_DEVICE_WARNING =
  'Đây là máy cuối cùng còn ghép vào sổ chung. Huỷ ghép xong thì sổ chung không còn máy nào dùng được nữa.'

function unpairErrorText(caught: unknown): string {
  if (caught instanceof UnpairBlockedError) {
    switch (caught.reason) {
      case 'offline':
        return 'Huỷ ghép cần mạng để các máy khác biết máy này đã rời sổ chung. Kết nối Internet rồi thử lại.'
      case 'pending':
        return pendingText(caught.pending)
      case 'resync':
        return RESYNC_TEXT
      case 'behind':
        return 'Máy chưa kéo đủ sổ chung. Chờ đồng bộ xong rồi thử lại.'
      case 'pairing':
        return 'Máy đang ghép vào sổ chung. Chờ ghép xong rồi thử lại.'
      case 'unknown-device':
        return 'Không xác định được máy này trên sổ chung. Thử lại.'
    }
  }
  if (caught instanceof UnpairUncertainError) return caught.message
  if ((caught instanceof SyncApiError && caught.code === 'network') || isTimeout(caught)) {
    return 'Chưa huỷ ghép được vì mất mạng. Kết nối Internet rồi thử lại.'
  }
  return errorMessage(caught)
}

function PairForm({
  leftNotice,
  onLeft,
  onPairStart,
}: {
  leftNotice: string | null
  onLeft: (droppedOperations: number) => void
  onPairStart: () => void
}) {
  const navigate = useNavigate()
  const identity = useDeviceIdentity()
  const deviceNotice = useDeviceNotice()
  const anchor = useSyncAnchor()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [goLocal, setGoLocal] = useState(false)

  if (identity === undefined) return <ListSkeleton rows={3} />
  if (identity === null) {
    return (
      <div className="p-4">
        <p className="text-[15px] font-semibold">Chưa đặt tên máy</p>
        <p className="mt-2 text-[13px] text-muted">
          Đặt tên và chọn một chữ cái A–Z trước khi ghép.
        </p>
        <div className="mt-4">
          <Button
            size="cta"
            onClick={() =>
              void navigate('/cai-dat-may', { state: { returnTo: '/ghep-may' } })
            }
          >
            ĐẶT TÊN MÁY
          </Button>
        </div>
      </div>
    )
  }

  const submit = async () => {
    if (!code.trim()) return
    onPairStart()
    setBusy(true)
    setError(null)
    let pairingAttemptId: string | null = null
    let pairedDevice: Awaited<ReturnType<typeof pairDevice>> | null = null
    let connectionSaved = false
    try {
      const pairing = await beginDevicePairing()
      pairingAttemptId = pairing.attemptId
      pairedDevice = await pairDevice({
        code: code.trim(),
        label: identity.label,
        letter: identity.letter,
        hasLocalLedger: pairing.hasLocalLedger,
        localLedgerRows: pairing.localLedgerRows,
      })
      await savePairedDevice({
        ...pairedDevice,
        pairingAttemptId: pairing.attemptId,
        syncUrl: DEFAULT_SYNC_URL,
      })
      connectionSaved = true
    } catch (caught) {
      if (pairedDevice && !connectionSaved) {
        try {
          await revokeShopDevice(
            {
              key: 'connection',
              shopId: pairedDevice.shopId,
              token: pairedDevice.token,
              syncUrl: DEFAULT_SYNC_URL,
            },
            pairedDevice.deviceId,
          )
        } catch {
          // Durable Object tự hết hạn và thu hồi lượt seed nếu cleanup qua mạng cũng thất bại.
        }
      }
      if (pairingAttemptId && !connectionSaved) await cancelDevicePairing(pairingAttemptId)
      if (caught instanceof SyncApiError && caught.code === 'letter-conflict') {
        setError(`${caught.message} Hãy đổi chữ cái của máy này rồi thử lại.`)
      } else {
        setError(errorMessage(caught))
      }
      setBusy(false)
    }
  }

  const confirmGoLocal = async () => {
    setBusy(true)
    setError(null)
    try {
      const { droppedOperations } = await leaveSharedLedger({ kind: 'revoked' })
      onLeft(droppedOperations)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setGoLocal(false)
      setBusy(false)
    }
  }

  const revokedPending = anchor?.pending ?? 0

  return (
    <div className="p-4">
      <p className="text-[15px] font-semibold">
        {identity.label} · chữ {identity.letter}
      </p>
      <div className="mt-3">
        <Button variant="secondary" disabled={busy} onClick={() => void navigate('/cai-dat-may')}>
          Đổi tên hoặc chữ cái
        </Button>
      </div>
      <p className="mt-4 text-[13px] text-muted">
        Dán mã từ một máy đã ghép. Mã chỉ dùng một lần và hết hạn sau 5 phút.
      </p>
      {leftNotice ? (
        <p role="status" aria-live="polite" className="mt-3 text-[13px] text-brand">
          {leftNotice}
        </p>
      ) : null}
      {deviceNotice ? (
        <p role="alert" className="mt-3 rounded-btn bg-danger-tint px-3 py-2 text-[13px] font-semibold text-danger">
          {deviceNotice.message}
        </p>
      ) : null}
      {anchor?.revoked ? (
        <div className="mt-3">
          <Button variant="secondary" disabled={busy} onClick={() => setGoLocal(true)}>
            Dùng máy này như máy chưa ghép
          </Button>
        </div>
      ) : null}
      <div className="mt-4">
        <TextField
          label="Mã ghép máy"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoCapitalize="characters"
          autoComplete="off"
          error={error ?? undefined}
        />
      </div>
      <div className="mt-4">
        <Button size="cta" disabled={busy || !code.trim()} onClick={() => void submit()}>
          {busy ? 'ĐANG GHÉP…' : 'GHÉP MÁY NÀY'}
        </Button>
      </div>
      {goLocal ? (
        <ConfirmDialog
          title="Dùng máy này như máy chưa ghép?"
          message={`Sổ trên máy được giữ nguyên làm sổ cục bộ, dừng ở lúc máy bị thu hồi, và không lên sổ chung nữa. Muốn quay lại sổ chung thì đừng bấm nút này — ghép lại ngay bằng mã mới; bấm rồi thì phải sao lưu và xoá sổ trên máy trước khi ghép lại.${
            revokedPending > 0
              ? ` Còn ${revokedPending} thay đổi chưa từng lên sổ chung; chúng chỉ còn trên máy này.`
              : ''
          }`}
          confirmLabel="Dùng như máy chưa ghép"
          pending={busy}
          onConfirm={() => void confirmGoLocal()}
          onCancel={() => setGoLocal(false)}
        />
      ) : null}
    </div>
  )
}

function PairedView({ onLeft }: { onLeft: (droppedOperations: number) => void }) {
  const connection = useDeviceConnection()
  const identity = useDeviceIdentity()
  const anchor = useSyncAnchor()
  const [leaving, setLeaving] = useState(false)
  const [devices, setDevices] = useState<ShopDevice[] | null>(null)
  const [pairCode, setPairCode] = useState<{ code: string; expiresAt: number } | null>(null)
  const [revoke, setRevoke] = useState<ShopDevice | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)

  const load = async () => {
    if (!connection) return
    try {
      setDevices((await listShopDevices(connection)).devices)
    } catch (caught) {
      if (caught instanceof SyncApiError && caught.status === 401) {
        await markDeviceRevoked(connection.token)
        return
      }
      setError(errorMessage(caught))
    }
  }

  useEffect(() => {
    if (!connection) return
    let active = true
    void listShopDevices(connection)
      .then(({ devices: rows }) => {
        if (active) setDevices(rows)
      })
      .catch(async (caught: unknown) => {
        if (!active) return
        if (caught instanceof SyncApiError && caught.status === 401) {
          await markDeviceRevoked(connection.token)
          return
        }
        setError(errorMessage(caught))
      })
    return () => {
      active = false
    }
  }, [connection])

  if (!connection || !identity) return <ListSkeleton rows={4} />

  const generate = async () => {
    setBusy(true)
    setGenerating(true)
    setError(null)
    try {
      setPairCode(await createPairCode(connection))
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
      setGenerating(false)
    }
  }

  const pending = anchor?.pending ?? 0
  const ready = anchor !== undefined && pending === 0 && !anchor.resyncRequired

  const confirmLeave = async () => {
    setBusy(true)
    setError(null)
    try {
      const { droppedOperations } = await unpairThisDevice()
      // Không setState sau dòng này: máy đã chưa ghép nên PairedView sẽ unmount.
      onLeft(droppedOperations)
    } catch (caught) {
      setLeaving(false)
      setBusy(false)
      setError(unpairErrorText(caught))
    }
  }

  const copy = async () => {
    if (!pairCode) return
    await navigator.clipboard.writeText(pairCode.code)
    setNotice('Đã sao chép mã ghép.')
  }

  const confirmRevoke = async () => {
    if (!revoke) return
    setBusy(true)
    setError(null)
    try {
      await revokeShopDevice(connection, revoke.id)
      setRevoke(null)
      await load()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <section className="px-4 py-5">
        <div className="flex items-center gap-2">
          <StatusChip tone="brand">Đã ghép</StatusChip>
          <p className="text-[15px] font-semibold">
            {identity.label} · chữ {identity.letter}
          </p>
        </div>
      </section>

      <section className="border-t border-line px-4 py-5">
        <h2 className="label-xs text-muted">GHÉP THÊM MÁY</h2>
        {pairCode ? (
          <>
            <p className="mt-3 break-all rounded-btn bg-surface-muted p-3 font-mono text-[14px]">
              {pairCode.code}
            </p>
            <p className="mt-2 text-[13px] text-muted">
              Dùng một lần · hết hạn lúc{' '}
              {new Date(pairCode.expiresAt).toLocaleTimeString('vi-VN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
              . Chỉ gửi cho máy bạn đang ghép.
            </p>
            <div className="mt-3">
              <Button variant="secondary" onClick={() => void copy()}>
                Sao chép mã
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-3">
            <Button variant="secondary" disabled={busy} onClick={() => void generate()}>
              {generating ? 'Đang tạo…' : 'TẠO MÃ GHÉP'}
            </Button>
          </div>
        )}
        {notice ? (
          <p role="status" aria-live="polite" className="mt-2 text-[13px] text-brand">
            {notice}
          </p>
        ) : null}
      </section>

      <section className="border-t border-line px-4 py-5">
        <h2 className="label-xs text-muted">CÁC MÁY ĐÃ GHÉP</h2>
        <p className="mt-2 text-[13px] text-muted">
          Mọi máy trong danh sách đều có thể tạo mã ghép và thu hồi máy khác.
        </p>
        <div className="mt-3 space-y-3">
          {devices
            ?.filter((device) => device.revokedAt === null)
            .map((device) => (
              <div
                key={device.id}
                className="flex items-center gap-3 rounded-card border border-line p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {device.label} · chữ {device.letter}
                  </p>
                </div>
                {device.current ? (
                  <StatusChip tone="brand">Máy này</StatusChip>
                ) : (
                  <Button variant="danger" disabled={busy} onClick={() => setRevoke(device)}>
                    Thu hồi
                  </Button>
                )}
              </div>
            ))}
        </div>
      </section>

      <section className="border-t border-line px-4 py-5">
        <h2 className="label-xs text-muted">RỜI SỔ CHUNG</h2>
        <p className="mt-2 text-[13px] text-muted">
          Dùng khi muốn sao lưu, khôi phục hay xoá sổ riêng trên máy này.
        </p>
        {pending > 0 ? (
          <p className="mt-2 text-[13px] text-danger">{pendingText(pending)}</p>
        ) : anchor?.resyncRequired ? (
          <p className="mt-2 text-[13px] text-danger">{RESYNC_TEXT}</p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {pending > 0 ? (
            <Button
              variant="secondary"
              onClick={() => window.dispatchEvent(new Event(SYNC_WAKE_EVENT))}
            >
              Đồng bộ ngay
            </Button>
          ) : null}
          <Button
            variant="danger"
            disabled={busy || !ready}
            onClick={() => {
              setLeaving(true)
              // Máy khác có thể vừa bị thu hồi hay ghép thêm; cảnh báo máy cuối cùng phải theo danh sách mới.
              void load()
            }}
          >
            Huỷ ghép máy này
          </Button>
        </div>
      </section>

      {error ? (
        <p
          role="alert"
          className="mx-4 rounded-btn bg-danger-tint px-3 py-2 text-[13px] font-semibold text-danger"
        >
          {error}
        </p>
      ) : null}
      {revoke ? (
        <ConfirmDialog
          title={`Thu hồi “${revoke.label}”?`}
          message="Máy này sẽ mất quyền ghi và ngừng đồng bộ ngay. Muốn dùng lại phải ghép lại bằng mã mới."
          confirmLabel="Thu hồi máy"
          onConfirm={() => void confirmRevoke()}
          onCancel={() => setRevoke(null)}
        />
      ) : null}
      {leaving ? (
        <ConfirmDialog
          title={`Huỷ ghép “${identity.label}”?`}
          message={
            devices && isLastActiveDevice(devices) ? `${LAST_DEVICE_WARNING} ${LEAVE_TEXT}` : LEAVE_TEXT
          }
          confirmLabel="Huỷ ghép"
          pending={busy}
          onConfirm={() => void confirmLeave()}
          onCancel={() => setLeaving(false)}
        />
      ) : null}
    </div>
  )
}

export function GhepMayPage() {
  const connectionSnapshot = useDeviceConnectionSnapshot()
  const [leftNotice, setLeftNotice] = useState<string | null>(null)
  const onLeft = (droppedOperations: number) =>
    setLeftNotice(
      droppedOperations > 0
        ? `${LEFT_NOTICE} ${droppedOperations} thay đổi ghi trong lúc huỷ ghép có thể chưa lên sổ chung — xem lại trên máy khác trước khi nhập lại.`
        : LEFT_NOTICE,
    )
  const connection = connectionSnapshot?.connection
  const pairing = connectionSnapshot?.pairing
  return (
    <div className="min-h-full">
      <ScreenHeader title="Máy bán hàng" back="back" />
      {connectionSnapshot === undefined ? (
        <div className="p-4">
          <ListSkeleton rows={4} />
        </div>
      ) : connection && pairing?.connectionSaved ? (
        <div className="p-4">
          <p className="text-[15px] font-semibold">Đang hoàn tất ghép máy…</p>
          <p className="mt-2 text-[13px] text-muted">
            Đang đưa ảnh sổ ban đầu lên sổ chung. Giữ màn này mở; app sẽ tự thử lại nếu mạng chập chờn.
          </p>
          <div className="mt-4">
            <ListSkeleton rows={3} />
          </div>
        </div>
      ) : connection ? (
        <PairedView onLeft={onLeft} />
      ) : (
        <PairForm
          leftNotice={leftNotice}
          onLeft={onLeft}
          onPairStart={() => setLeftNotice(null)}
        />
      )}
    </div>
  )
}
