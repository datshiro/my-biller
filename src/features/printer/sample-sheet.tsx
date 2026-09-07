import { format } from 'date-fns'
import { RECEIPT_WIDTH } from '../receipt/share-receipt'

/**
 * Phần chữ của tờ IN THỬ (D14): tên app, nhãn, ngày giờ, một dòng tiếng Việt đủ dấu để soi font/dấu.
 * `buildSampleJob` ghép nó trên thước `sampleBitmap()` thuần. Bề ngang cố định `RECEIPT_WIDTH` để chụp
 * ra đúng 576 chấm. Nhãn là "TỜ IN THỬ" chứ không "IN THỬ" — không trùng nhãn nút IN THỬ khi chọn theo chữ.
 */
export function SampleSheet({ innerRef }: { innerRef?: React.Ref<HTMLDivElement> }) {
  return (
    <div
      ref={innerRef}
      data-sample-sheet=""
      className="receipt-thermal receipt-page mx-auto bg-white px-4 py-5 text-ink"
      style={{ width: RECEIPT_WIDTH }}
    >
      <p className="text-center text-[17px] font-bold uppercase">my-biller</p>
      <p className="mt-1 text-center text-[16px] font-bold tracking-wide">TỜ IN THỬ</p>
      <p className="mt-2 text-center text-[11px]">{format(new Date(), 'dd/MM/yyyy HH:mm')}</p>
      <p className="mt-3 text-[11px]">Tiếng Việt có dấu: ắ ầ ẫ ộ ữ đ</p>
    </div>
  )
}
