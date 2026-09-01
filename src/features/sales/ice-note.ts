import { hasNoteToken, toggleNoteToken } from '@/domain/cart'

export const ICE = ['Đá chung', 'Đá riêng'] as const
type IceToken = (typeof ICE)[number]

/**
 * Hai nhãn đá LOẠI TRỪ NHAU: một ly không thể vừa đá chung vừa đá riêng, muốn cả hai kiểu thì đó là
 * HAI DÒNG. Luật này là nghiệp vụ bán hàng nên nó ở tầng feature, không nhét vào `toggleNoteToken` —
 * hàm đó phải giữ nguyên nghĩa toggle thuần và không biết gì về đá.
 *
 * Nhánh `hasNoteToken` là bắt buộc: gọi thẳng `toggleNoteToken(note, other)` khi `other` chưa có sẽ
 * THÊM nó vào, đúng ngược ý định.
 */
export function toggleIceToken(note: string, token: IceToken): string {
  const other: IceToken = token === 'Đá chung' ? 'Đá riêng' : 'Đá chung'
  const stripped = hasNoteToken(note, other) ? toggleNoteToken(note, other) : note
  return toggleNoteToken(stripped, token)
}
