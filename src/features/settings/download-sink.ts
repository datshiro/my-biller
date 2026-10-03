import { registerPlugin } from '@capacitor/core'
import { isNativeApp } from '../printer/printer-sink'

export type DownloadRequest = { filename: string; mimeType: string; text: string }

/**
 * `verified=false` nghĩa là **chỉ mới yêu cầu tải**: `<a download>` không báo lại file đã lưu hay tên cuối
 * cùng. Chỉ khi `true` (plugin APK đã ghi xong và đọc lại tên) mới được nói "Đã lưu".
 */
export type SavedFile = { savedAs: string; location: string; verified: boolean }

type DownloadFilePlugin = {
  saveToDownloads(options: DownloadRequest): Promise<{ displayName: string; relativePath: string }>
}

const DownloadFile = registerPlugin<DownloadFilePlugin>('DownloadFile')

const WEB_LOCATION = 'Tải về (Download)'

function requestBrowserDownload({ filename, mimeType, text }: DownloadRequest): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  // Thu hồi ngay lập tức thì Safari huỷ luôn cú tải vừa bắt đầu — nhả sang nhịp sau.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Cửa ra file duy nhất của app. Trong APK, WebView nuốt im lặng cú `<a download>` với blob URL, nên đi
 * qua plugin `DownloadFile` (MediaStore) và nhận lại tên thật. Trên web giữ `<a download>`.
 *
 * Hợp đồng dùng chung (file mẫu CSV gọi với `text/csv;charset=utf-8`): đổi chữ ký là đổi hợp đồng.
 */
export async function saveToDownloads(request: DownloadRequest): Promise<SavedFile> {
  if (isNativeApp()) {
    const { displayName, relativePath } = await DownloadFile.saveToDownloads(request)
    return { savedAs: displayName, location: relativePath, verified: true }
  }
  requestBrowserDownload(request)
  return { savedAs: request.filename, location: WEB_LOCATION, verified: false }
}

/** Câu báo kết quả lưu file. Trên web không bao giờ khẳng định "Đã lưu" — trình duyệt không báo lại. */
export function describeSavedFile({ savedAs, location, verified }: SavedFile): string {
  if (verified) return `Đã lưu: ${location}${savedAs}.`
  return `Đã yêu cầu tải file "${savedAs}" về thư mục ${location}. Hãy mở thư mục Tải về để chắc file đã có; trình duyệt có thể đổi tên nếu trùng.`
}
