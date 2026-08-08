import { Component, type ErrorInfo, type ReactNode } from 'react'
import { exportBackup } from '@/features/settings/backup'
import { Button } from '@/ui/button'

type State = { error: Error | null; rescue: string | null; rescuing: boolean }

/**
 * Chắn cuối. App không có backend nên khi cây React sập, đường duy nhất để cứu dữ liệu
 * (Thêm → Cài đặt → SAO LƯU RA FILE) cũng sập theo. Màn này gọi thẳng `exportBackup`,
 * không đi qua router hay state của app, nên vẫn tải được file kể cả lúc mọi màn đã trắng.
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
      const filename = await exportBackup(Date.now())
      this.setState({ rescuing: false, rescue: `Đã tải ${filename}. Kiểm lại trong thư mục Tải về.` })
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

    return (
      <div className="flex min-h-dvh flex-col justify-center gap-4 p-6">
        <h1 className="text-[24px] font-bold">App đang gặp lỗi</h1>
        <p className="text-[17px]">
          Dữ liệu bán hàng vẫn nằm trong máy, chưa mất. Hãy tải file sao lưu về trước, rồi mở lại app.
        </p>

        <Button size="cta" disabled={rescuing} onClick={() => void this.rescue()}>
          {rescuing ? 'Đang xuất…' : '⬇ TẢI FILE SAO LƯU'}
        </Button>
        {rescue ? <p className="text-[15px] font-semibold">{rescue}</p> : null}

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
