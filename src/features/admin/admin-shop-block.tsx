import { Link } from 'react-router'
import type { DeviceOverview, ShopOverview } from '@shared/admin-contract'
import { shortId } from '@/domain/short-id'
import { MoneyText } from '@/ui/money-text'
import { formatAt } from './admin-format'

export type ShopEntry = ShopOverview | { shopId: string; error: string }

function DeviceProgress({ device, latestSeq }: { device: DeviceOverview; latestSeq: number }) {
  return (
    <span className="text-[13px] text-muted">
      {device.pulledSeq === null
        ? 'chưa kéo lần nào'
        : `đã áp tới #${device.pulledSeq}, báo lúc ${formatAt(device.lastSeenAt)} · tụt ${Math.max(0, latestSeq - device.pulledSeq)}`}
      {device.rewoundAt !== null ? ` · kéo lại từ đầu lần gần nhất lúc ${formatAt(device.rewoundAt)}` : null}
    </span>
  )
}

function Count({ label, field, value }: { label: string; field: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[13px] text-muted">{label}</span>
      <span data-field={field} className="money font-semibold">
        {value}
      </span>
    </div>
  )
}

function Money({ label, field, value }: { label: string; field: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[13px] text-muted">{label}</span>
      <span data-field={field}>
        <MoneyText value={value} />
      </span>
    </div>
  )
}

/** Khối của một sổ. Robot và test chỉ đọc số bên trong `data-shop-id`, nên mọi số của sổ phải nằm trong khối này. */
export function ShopBlock({ shop }: { shop: ShopEntry }) {
  return (
    <section data-shop-id={shop.shopId} className="border-t border-line px-4 py-4">
      <Link to={`/admin/so/${shop.shopId}`} className="font-semibold text-brand">
        {`Sổ: ${shortId(shop.shopId)}`}
      </Link>
      {'error' in shop ? (
        <p className="mt-1 text-[13px] text-danger">{`Không đọc được sổ này (${shop.error})`}</p>
      ) : (
        <>
          <p className="mt-1 text-[15px]">{shop.shopName || '(chưa đặt tên quán)'}</p>
          <p className="text-[13px] text-muted">{`Tạo lúc ${formatAt(shop.createdAt)} · thay đổi mới nhất #${shop.latestSeq}`}</p>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
            <Count label="Đơn" field="orderCount" value={shop.summary.orderCount} />
            <Count label="Khách" field="customerCount" value={shop.summary.customerCount} />
            <Money label="Còn nợ" field="debtTotal" value={shop.summary.debtTotal} />
            <Money label="Doanh thu" field="revenue" value={shop.summary.revenue} />
          </div>
          <ul className="mt-2 divide-y divide-line">
            {shop.devices.map((device) => (
              <li key={device.id} data-device-letter={device.letter} className="flex flex-col py-1.5">
                <span className="text-[15px]">
                  {`Máy ${device.letter} · ${device.label} · ghép ${formatAt(device.createdAt)}`}
                  {device.revokedAt !== null ? ' · đã thu hồi' : null}
                </span>
                <DeviceProgress device={device} latestSeq={shop.latestSeq} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
