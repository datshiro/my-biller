/**
 * Tải luồng byte ESC/POS ra file `.bin`. Chỉ gọi dưới `import.meta.env.DEV` (D7): cho script laptop
 * gửi bill thật tới máy in trước khi có APK. Hoãn `revokeObjectURL` như `share-receipt.ts:56` — thu
 * hồi ngay thì Safari huỷ luôn cú tải vừa bắt đầu.
 */
export function downloadBytes(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
