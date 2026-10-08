import type { RestoreBlock } from '@/db/backup'

/**
 * Vì sao máy này không khôi phục từ file được và đường đang có hôm nay. Dùng cho cả khối giải thích trên
 * màn lẫn lỗi `RestoreBlockedError` mà khoá ghi ném khi hai tab đua nhau.
 */
export const RESTORE_BLOCK_TEXT: Record<RestoreBlock, string> = {
  connected:
    'Máy này đã ghép sổ chung. Sổ chung trên máy chủ đã là bản lưu của mọi máy, nên không khôi phục từ file ở đây — ghi đè sẽ đè lên dữ liệu của các máy khác. Nếu sổ trên máy này trông sai, bấm Kéo lại từ đầu. Muốn khôi phục một file sao lưu, làm trên một máy chưa ghép, hoặc huỷ ghép máy này ở Cài đặt › Máy bán hàng trước.',
  pairing:
    'Máy đang ghép vào sổ chung nên chưa khôi phục từ file được — ghi lúc này sẽ đè lên sổ đang được ghép. Chờ ghép xong. Muốn khôi phục một file sao lưu, làm trên một máy chưa ghép.',
  revoked:
    'Máy này đã bị thu hồi khỏi sổ chung nên không khôi phục từ file ở đây — sổ trên máy được giữ nguyên để không lệch với sổ chung. Ghép lại máy ở Cài đặt › Máy bán hàng; chỉ khi không định ghép lại mới bấm Dùng máy này như máy chưa ghép ở đó. Muốn khôi phục một file sao lưu, làm trên một máy chưa ghép.',
}
