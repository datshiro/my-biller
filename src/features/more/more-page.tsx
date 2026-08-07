import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useItems } from '@/features/items/use-items'
import { useCustomers } from '@/features/customers/use-customers'
import { useDebts } from '@/features/debts/use-debts'
import { seedDemoData } from '@/db/seed'
import { formatAmount } from '@/domain/money'
import { ListRow } from '@/ui/list-row'
import { ScreenHeader } from '@/ui/screen-header'

export function MorePage() {
  const navigate = useNavigate()
  const items = useItems()
  const customers = useCustomers()
  const debt = useDebts()
  const [seeding, setSeeding] = useState(false)

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Thêm" />

      <ul className="border-t border-line">
        <li>
          <ListRow
            title="Mặt hàng"
            subtitle="Tên, giá bán, giá nhập, đơn vị"
            right={<span className="text-[13px] text-muted">{items ? `${items.length} món` : '…'}</span>}
            onClick={() => void navigate('/them/mat-hang')}
          />
        </li>
        <li>
          <ListRow
            title="Khách hàng"
            subtitle="Lưu khách quen để ghi nợ và xem lịch sử mua"
            right={<span className="text-[13px] text-muted">{customers ? `${customers.length} khách` : '…'}</span>}
            onClick={() => void navigate('/them/khach-hang')}
          />
        </li>
        <li>
          <ListRow
            title="Công nợ"
            subtitle="Khách còn nợ và thu nợ"
            right={
              <span className={`money text-[13px] font-semibold ${debt?.total ? 'text-warn' : 'text-muted'}`}>
                {debt ? formatAmount(debt.total) : '…'}
              </span>
            }
            onClick={() => void navigate('/cong-no')}
          />
        </li>
        <li>
          <ListRow
            title="Cài đặt"
            subtitle="Sao lưu, thông tin cửa hàng, nhóm và loại"
            right={<span className="text-[20px] text-muted">›</span>}
            onClick={() => void navigate('/them/cai-dat')}
          />
        </li>
      </ul>

      {import.meta.env.DEV ? (
        <div className="mt-auto border-t border-line px-4 py-4">
          <button
            type="button"
            disabled={seeding}
            onClick={() => {
              setSeeding(true)
              void seedDemoData().finally(() => setSeeding(false))
            }}
            className="h-12 w-full rounded-btn border border-dashed border-line text-[13px] text-muted"
          >
            {seeding ? 'Đang nạp…' : 'Nạp dữ liệu mẫu (chỉ hiện khi dev)'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
