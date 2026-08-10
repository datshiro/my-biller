import { Component, type ErrorInfo, type ReactNode } from 'react'
import { isDbUnavailableError } from '@/db/db-block'
import { exportBackup } from '@/features/settings/backup'
import { Button } from '@/ui/button'

type State = { error: Error | null; rescue: string | null; rescuing: boolean }

/**
 * Chắn cuối. App không có backend nên khi cây React sập, đường duy nhất để cứu dữ liệu
 * (Thêm → Cài đặt → SAO LƯU RA FILE) cũng sập theo. Màn này gọi thẳng `exportBackup`,
 * không đi qua router hay state của app, nên vẫn tải được file kể cả lúc mọi màn đã trắng.
 *
 * Trừ một trường hợp: chính Dexie là chỗ hỏng. `exportBackup` đi qua `db.transaction`, nên lúc đó nút
 * cứu chắc chắn thất bại. Hứa một lối thoát bất khả thi tệ hơn là nói thẳng không có — người bán bấm,
 * thấy im, rồi tưởng dữ liệu đã mất.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, rescue: null, rescuing: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('my-biller sập:', error, info.componentStack)
  }

  private rescue = async (): Promise<void> => {
    this.setState({ rescuing: true, rescue: null })
    try {
      const { filename, importable, problem } = await exportBackup(Date.now())
      this.setState({
        rescuing: false,
        rescue: importable
          ? `Đã gửi yêu cầu tải bản sao với tên đề xuất "${filename}". Kiểm tra thư mục Tải về; thiết bị có thể đổi tên nếu bị trùng.`
          : `Đã gửi yêu cầu tải bản sao với tên đề xuất "${filename}", nhưng file này KHÔNG nhập lại được: ${problem} Giữ file lại và sửa tay chỗ đó. Hãy kiểm tra thư mục Tải về; thiết bị có thể đổi tên nếu bị trùng.`,
      })
    } catch (caught) {
      this.setState({
        rescuing: false,
        rescue: `Không xuất được file: ${caught instanceof Error ? caught.message : 'lỗi không rõ'}`,
      })
    }
  }

  render(): ReactNode {
    const { error, rescue, rescuing } = this.state
    if (!error) return this.props.children

    const dbDown = isDbUnavailableError(error)

    return (
      <div className="flex min-h-dvh flex-col justify-center gap-4 p-6">
        <h1 className="text-[24px] font-bold">App đang gặp lỗi</h1>
        {dbDown ? (
          <p className="text-[17px]">
            Kho dữ liệu trong máy đang không mở được, nên lúc này app không tải file sao lưu ra được.
            Dữ liệu vẫn nằm nguyên trong máy, chưa mất. Cập nhật app lên bản mới nhất rồi mở lại.
          </p>
        ) : (
          <p className="text-[17px]">
            Dữ liệu bán hàng vẫn nằm trong máy, chưa mất. Hãy tải file sao lưu về trước, rồi mở lại
            app.
          </p>
        )}

        {dbDown ? null : (
          <>
            <Button size="cta" disabled={rescuing} onClick={() => void this.rescue()}>
              {rescuing ? 'Đang xuất…' : '⬇ TẢI FILE SAO LƯU'}
            </Button>
            {rescue ? <p className="text-[15px] font-semibold">{rescue}</p> : null}
          </>
        )}

        <Button size="cta" variant="secondary" onClick={() => window.location.reload()}>
          MỞ LẠI APP
        </Button>

        <details className="text-[13px] text-muted">
          <summary>Chi tiết lỗi (khi cần nhờ người khác xem giúp)</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{error.message}</pre>
        </details>
      </div>
    )
  }
}
