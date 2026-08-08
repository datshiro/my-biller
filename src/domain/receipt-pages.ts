/**
 * Số dòng hàng tối đa trên một trang phiếu. Chọn theo số đo thật, không phải cho đẹp: mỗi trang phải
 * chụp được ở 2× mà vẫn dưới 300KB — quá mức đó thì `renderReceiptPng` phải hạ độ phân giải, và cả
 * lý do tách trang cũng mất luôn.
 */
export const LINES_PER_PAGE = 10

/**
 * Chia dòng hàng thành các trang **đều nhau**, không phải nhồi đầy trang trước rồi bỏ mẩu thừa sang
 * trang sau: 11 dòng ra `[6, 5]` chứ không phải `[10, 1]` — không ai muốn nhận tờ thứ hai có mỗi 1 món.
 *
 * Luôn trả về ít nhất một trang, kể cả khi không có dòng nào.
 */
export function paginateLines<T>(lines: readonly T[], perPage = LINES_PER_PAGE): T[][] {
  // `perPage = 0` làm bước nhảy của vòng lặp thành 0 → chạy mãi cho tới khi hết bộ nhớ.
  const limit = Math.max(1, Math.floor(perPage))
  if (lines.length <= limit) return [[...lines]]

  const pageCount = Math.ceil(lines.length / limit)
  const size = Math.ceil(lines.length / pageCount)
  const pages: T[][] = []
  for (let start = 0; start < lines.length; start += size) {
    pages.push(lines.slice(start, start + size))
  }
  return pages
}
