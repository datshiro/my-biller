/**
 * Hai cảnh báo làm cho con số lãi đọc được đúng. App **không** tự sửa số của người bán — chỉ nói ra
 * chỗ số đang không đáng tin, còn sửa thế nào là quyền của họ.
 */
export function CogsWarning({
  maybeDoubleCounted,
  costCoverage,
}: {
  maybeDoubleCounted: boolean
  /** 0..1 */
  costCoverage: number
}) {
  const missing = Math.round((1 - costCoverage) * 100)

  if (!maybeDoubleCounted && missing === 0) return null

  return (
    <div className="mx-4 mb-3 rounded-card border border-warn/25 bg-warn-tint px-3 py-2.5">
      {maybeDoubleCounted ? (
        <p className="text-[13px] text-warn">
          <span className="font-bold">Tiền hàng có thể bị trừ hai lần.</span> Kỳ này vừa có giá nhập ở
          mặt hàng, vừa có khoản chi loại “Nguyên liệu”. Chọn một cách thôi: hoặc để trống giá nhập,
          hoặc đừng ghi khoản chi mua hàng — không thì số lãi thấp hơn thực tế.
        </p>
      ) : null}

      {missing > 0 ? (
        <p className={`text-[13px] text-warn ${maybeDoubleCounted ? 'mt-2' : ''}`}>
          <span className="font-bold">{missing}% tiền hàng chưa có giá nhập.</span> Số lãi bên trên
          chỉ mang tính tham khảo cho tới khi điền đủ.
        </p>
      ) : null}
    </div>
  )
}
