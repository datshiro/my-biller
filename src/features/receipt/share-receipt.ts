import { toBlob } from 'html-to-image'

/** Rộng cố định để ảnh phiếu giống nhau trên mọi máy, không phụ thuộc bề ngang màn hình. */
export const RECEIPT_WIDTH = 360

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled'

/**
 * Ngân sách điểm ảnh cho MỘT trang phiếu — lưới an toàn, không phải cơ chế chính.
 *
 * Thứ giữ cho ảnh nhẹ là `LINES_PER_PAGE`: phiếu dài được chia thành nhiều tấm, mỗi tấm đủ ngắn để
 * chụp ở 2×. Ngân sách này chỉ để đỡ những trang bất thường — tên món quá dài xuống dòng nhiều lần
 * làm trang cao gấp đôi bình thường.
 *
 * Đặt ở mốc 300KB đo trên chính app (~0,21 KB mỗi 1000 điểm ảnh ở 2×), chứ không siết hơn: siết hơn
 * thì trang bình thường cũng bị hạ độ phân giải, mất luôn cái lợi của việc chia trang.
 */
const PIXEL_BUDGET = 1_250_000

/**
 * Dưới mức này thì chữ bắt đầu rỗ trên màn hình điện thoại. Trang bất thường thà nặng hơn 300KB
 * còn hơn gửi cho khách một tấm ảnh không đọc nổi.
 */
const MIN_RATIO = 1.5
const MAX_RATIO = 2

/**
 * Chụp DOM phiếu thành PNG. **Phải chờ `document.fonts.ready`** — html-to-image vẽ bằng canvas,
 * font chưa nạp xong thì dấu tiếng Việt rơi về font hệ thống hoặc mất hẳn.
 *
 * Độ phân giải hạ dần theo chiều dài phiếu: phiếu 2 món chụp ở 2×, phiếu vài chục món tự lùi xuống
 * để ảnh không phình lên hàng trăm KB khi gửi qua mạng di động.
 */
export async function renderReceiptPng(node: HTMLElement): Promise<Blob> {
  await document.fonts.ready

  const area = node.offsetWidth * node.offsetHeight
  const fitted = area > 0 ? Math.sqrt(PIXEL_BUDGET / area) : MAX_RATIO
  const pixelRatio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, fitted))

  const blob = await toBlob(node, { pixelRatio, backgroundColor: '#ffffff' })
  if (!blob) throw new Error('Không tạo được ảnh phiếu.')
  return blob
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  // Gắn vào DOM rồi mới bấm, và hoãn thu hồi URL: thu hồi ngay thì Safari huỷ luôn cú tải vừa bắt
  // đầu. Giống hệt `settings/backup.ts` — đây là đường cứu phiếu khi Zalo không nhận share.
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Phiếu một trang giữ đúng tên số phiếu; nhiều trang thì đánh số để khách xếp lại đúng thứ tự. */
export function receiptFilenames(baseName: string, count: number): string[] {
  if (count <= 1) return [`${baseName}.png`]
  return Array.from({ length: count }, (_, index) => `${baseName}-${index + 1}.png`)
}

const toFiles = (blobs: readonly Blob[], baseName: string) =>
  receiptFilenames(baseName, blobs.length).map(
    (filename, index) => new File([blobs[index] as Blob], filename, { type: 'image/png' }),
  )

const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError'

/**
 * Gọi thẳng trong `onClick` với các blob đã chụp sẵn — iOS Safari từ chối `navigator.share` nếu trước
 * đó có bất kỳ `await` nào, vì user gesture đã hết hiệu lực. Đây là lý do trang phải chụp ảnh trước.
 */
export async function shareReceipt(
  blobs: readonly Blob[],
  baseName: string,
  title: string,
): Promise<ShareOutcome> {
  const files = toFiles(blobs, baseName)

  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, title })
      return 'shared'
    } catch (error) {
      // Người dùng bấm back giữa chừng là chuyện bình thường, không phải lỗi để báo.
      if (isAbort(error)) return 'cancelled'
      downloadReceipt(blobs, baseName)
      return 'downloaded'
    }
  }

  downloadReceipt(blobs, baseName)
  return 'downloaded'
}

export function downloadReceipt(blobs: readonly Blob[], baseName: string): void {
  const names = receiptFilenames(baseName, blobs.length)
  blobs.forEach((blob, index) => download(blob, names[index] as string))
}

/** Máy có gửi được cả bộ ảnh này qua Web Share không — hỏi với đúng số file sẽ gửi, không phải một file. */
export function canShareReceipt(blobs: readonly Blob[], baseName: string): boolean {
  return navigator.canShare?.({ files: toFiles(blobs, baseName) }) === true
}
