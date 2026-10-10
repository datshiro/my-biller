import { useEffect, useState } from 'react'
import type { HeartbeatRecord, UnpairedPage } from '@shared/admin-contract'
import { shortId } from '@/domain/short-id'
import { Button } from '@/ui/button'
import { MoneyText } from '@/ui/money-text'
import type { AdminClient } from './admin-client'
import { errorText, formatAt } from './admin-format'

function DeviceRow({ device }: { device: HeartbeatRecord }) {
  return (
    <li data-install-id={device.installId} data-last-seen={device.lastSeenAt} className="py-2">
      <span className="font-semibold">{`Mã máy: ${shortId(device.installId)}`}</span>
      <span className="block text-[15px]">{device.shopName || '(chưa đặt tên quán)'}</span>
      <span className="block text-[13px] text-muted">
        {`Bản ${device.appVersion || '—'} · ${device.platform} · mở gần nhất ${formatAt(device.lastSeenAt)} · báo lần đầu ${formatAt(device.firstSeenAt)}`}
      </span>
      {device.pairedShopId !== null ? (
        <span className="block text-[13px] text-brand">
          {`đã ghép vào Sổ ${shortId(device.pairedShopId)} lúc ${formatAt(device.pairedAt)}`}
        </span>
      ) : null}
      <span className="mt-1 flex gap-4 text-[13px]">
        <span>
          {'Đơn '}
          <span data-field="orderCount" className="money font-semibold">
            {device.orderCount}
          </span>
        </span>
        <span>
          {'Khách '}
          <span data-field="customerCount" className="money font-semibold">
            {device.customerCount}
          </span>
        </span>
        <span>
          {'Còn nợ '}
          <span data-field="debtTotal">
            <MoneyText value={device.debtTotal} />
          </span>
        </span>
      </span>
    </li>
  )
}

export function UnpairedScreen({ client }: { client: AdminClient }) {
  const [page, setPage] = useState<UnpairedPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showPaired, setShowPaired] = useState(false)

  useEffect(() => {
    let live = true
    client.loadUnpaired().then(
      (result) => live && setPage(result),
      (caught: unknown) => live && setError(errorText(caught)),
    )
    return () => {
      live = false
    }
  }, [client])

  const unpaired = page?.devices.filter((device) => device.pairedShopId === null) ?? []
  const paired = page?.devices.filter((device) => device.pairedShopId !== null) ?? []

  return (
    <div className="px-4 py-4">
      <h1 className="text-[20px] font-bold">Máy chưa ghép</h1>
      <p className="mt-1 text-[13px] text-muted">
        Dữ liệu ở đây do máy tự báo, không xác thực, có thể bị giả. Chỉ có số lượng, không có đơn hay tên khách.
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] font-semibold text-danger">
          {error}
        </p>
      ) : null}
      {page ? (
        <>
          <p className="mt-2 text-[15px]">
            {'Tổng: '}
            <span data-total={page.total} className="font-semibold">
              {page.total}
            </span>
            {' · Mới trong 24 giờ: '}
            <span data-new24h={page.new24h} className="font-semibold">
              {page.new24h}
            </span>
          </p>

          <section data-group="unpaired" className="mt-3">
            <h2 className="label-xs text-muted">Chưa ghép</h2>
            <ul className="divide-y divide-line">
              {unpaired.map((device) => (
                <DeviceRow key={device.installId} device={device} />
              ))}
            </ul>
          </section>

          <section data-group="paired" className="mt-3">
            <Button variant="ghost" aria-expanded={showPaired} onClick={() => setShowPaired((open) => !open)}>
              Đã ghép sau đó
            </Button>
            {showPaired ? (
              <ul className="divide-y divide-line">
                {paired.map((device) => (
                  <DeviceRow key={device.installId} device={device} />
                ))}
              </ul>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  )
}
