import { describeSavedFile } from './download-sink'
import type { StoredRestoreReport } from './restore-report-store'
import { formatVnd } from '@/domain/money'

const value = (key: string, amount: number) => (key === 'debtTotal' ? formatVnd(amount) : String(amount))

/** Thẻ đối chiếu sau khôi phục: số kỳ vọng (tính từ file/sổ gộp) ⟷ số đọc lại trên máy. */
export function RestoreReportCard({ stored }: { stored: StoredRestoreReport }) {
  const { report, safety } = stored
  const mismatched = report.rows.filter((row) => !row.matches).map((row) => row.label)
  const mode = stored.mode === 'merge' ? 'Gộp' : 'Ghi đè'

  return (
    <section className="mx-4 mt-4 rounded-card border border-line p-4" aria-label="Báo cáo khôi phục">
      <h2 className="text-[15px] font-bold">
        {report.ok ? 'Khôi phục khớp' : 'Khôi phục LỆCH'}
      </h2>
      <p className="mt-1 text-[13px] text-muted">
        {mode} từ file “{stored.sourceName}”.
        {stored.codeChanges > 0 ? ` ${stored.codeChanges} đơn trong file được cấp mã mới vì trùng mã trên máy.` : ''}
      </p>
      {/* Luôn nói file an toàn đã ra đâu (D11): đó là đường về nếu kết quả khôi phục không như ý. */}
      {safety ? <p className="mt-1 text-[13px] text-muted">{describeSavedFile(safety, 'file an toàn')}</p> : null}
      {report.ok ? null : (
        <p role="alert" className="mt-2 rounded-btn bg-danger-tint px-3 py-2 text-[13px] font-semibold text-danger">
          Khôi phục LỆCH ở: {mismatched.join(', ')}.
          {safety ? ` File an toàn trước khi khôi phục: ${safety.savedAs} trong ${safety.location}.` : ''}
        </p>
      )}
      {report.overpaidOrders > 0 ? (
        <p className="mt-2 rounded-btn bg-warn-tint px-3 py-2 text-[13px] font-semibold text-warn">
          {report.overpaidOrders} đơn có tiền thu vượt tổng đơn — có thể cùng một lần trả được ghi hai lần. Mở
          các đơn đó kiểm tra lại.
        </p>
      ) : null}
      <table className="mt-3 w-full text-[13px]">
        <thead>
          <tr className="text-left text-muted">
            <th className="font-normal" />
            <th className="font-normal">Kỳ vọng</th>
            <th className="font-normal">Trên máy</th>
            <th className="font-normal" />
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td className="money">{value(row.key, row.expected)}</td>
              <td className="money">{value(row.key, row.actual)}</td>
              <td className={row.matches ? 'text-brand' : 'font-bold text-danger'}>{row.matches ? '✓' : 'LỆCH'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
