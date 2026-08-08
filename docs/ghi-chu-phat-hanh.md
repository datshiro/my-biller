# Ghi chú phát hành

## 8/8/2026 — đợt sửa lỗi sau review

### ⚠️ Việc phải làm sau khi cập nhật: soát lại các đơn bán nợ cũ

Bản trước có lỗi ở đường bán nợ. Bấm **Bán nợ** trong sheet thu tiền thì app bảo đi chọn khách, mà
đúng lúc đó sheet bị gỡ khỏi màn hình — chọn khách xong quay lại, hình thức trả đã âm thầm về mặc
định "tiền mặt, đưa đủ". Đơn nợ vì vậy được chốt thành **đã thu đủ**, kèm một phiếu thu tiền mặt
bằng đúng tổng đơn. Khách còn nợ mà sổ báo đã trả xong, và khoản nợ đó không hiện ở màn Công nợ.

**App không tự phát hiện và không tự sửa được.** Phiếu thu là nguồn sự thật của số đã thu: đơn sai
kia có phiếu thu khớp với tổng đơn nên nó *hợp lệ* với mọi phép kiểm. `recalcAll()` — chạy mỗi lần
nhập file sao lưu — cũng dựng lại đúng con số đang có. Không có dấu hiệu nào để phân biệt nó với một
đơn khách trả tiền mặt thật, nên không viết được migration cho việc này. Chỉ người bán biết ai đã
trả tiền.

Cách soát:

1. Mở **Đơn hàng**, xem lại các đơn **có tên khách** trước ngày cập nhật mà đang báo "Đã thu đủ".
2. Đối chiếu với **Công nợ**: khoản nợ nào đáng ra phải có mà không thấy thì đơn tương ứng là đơn bị
   ghi sai.

Cách sửa từng đơn — không có đường xoá riêng phiếu thu, nên phải lên lại đơn:

1. Mở đơn → **Huỷ đơn**. Bước này xoá luôn phiếu thu sai (hộp xác nhận sẽ nói rõ số tiền sắp mất
   khỏi sổ — ở đây là số tiền chưa từng thu, cứ xác nhận).
2. Lên lại đơn đó, lần này chọn **Bán nợ** và chọn khách. Nếu khách đã trả một phần thì ghi phiếu
   thu đúng số đó ở màn Công nợ.

Chỉ những đơn lên bằng đường "Bán nợ" trước bản này bị ảnh hưởng. Đơn trả tiền mặt bình thường không
việc gì.

### Đã sửa

- Bán nợ không còn bị ghi thành đã thu đủ tiền mặt.
- Số liệu "hôm nay" ở màn Báo cáo và màn Đơn không còn đứng lại ở ngày hôm qua khi để app mở qua nửa
  đêm; hai màn giờ dùng cùng một đồng hồ.
- Xoá sạch dữ liệu và ghi đè khi nhập file đều phải qua hai cửa xác nhận, và bản sao an toàn phải
  nhập lại được thì mới cho đi tiếp.
- Sao lưu ra file: file vẫn tải về kể cả khi có bản ghi lạ, nhưng lúc đó **không** tính là đã sao lưu
  và app nói thẳng file đó không nhập lại được — thay vì tắt banner nhắc rồi để người bán phát hiện
  ra đúng lúc cần phục hồi.
- Huỷ đơn đã thu tiền nói rõ số tiền sắp biến khỏi sổ; huỷ đơn thì phiếu thu của đơn cũng xoá theo,
  kể cả với đơn nhập từ file sao lưu.
- Chặn phiếu thu bằng 0 hoặc số âm.
- Con trỏ ô nhập tiền không nhảy về cuối khi sửa số ở giữa.
- Phiếu vuốt ngang được trên máy 320px.
- Số món ở màn Mặt hàng đếm đúng.
- Các màn nhập liệu có chốt chống bấm lưu hai lần.
- File sao lưu giữ `id` của bản ghi và bị chặn ngay khi ràng buộc gãy.

### Cập nhật có cần làm gì thêm không

Không. Schema IndexedDB không đổi nên không có migration; `BACKUP_VERSION` vẫn là 1 nên file sao lưu
của bản cũ nhập lại được bình thường.
