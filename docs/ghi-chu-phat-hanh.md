# Ghi chú phát hành

## 2.0.1 — CI/smoke (23/8/2026)

> Thay đổi so với 2.0.0 chỉ nằm ở đường CI/vận hành, không đụng frontend hay
> schema; người bán không thấy khác biệt so với 2.0.0.

### Thay đổi vận hành

- Thêm script `npm run worker:smoke:state` để operator dò xem quán smoke đã
  provisioned chưa trước khi chạy smoke Worker production chính.
- Không có ca Robot vì thay đổi nằm ở helper CLI, không chạm giao diện; cũng
  không có ca Vitest vì script chỉ gọi `fetch` Worker production live.

## 2.0.0 — chưa phát hành (11/8/2026)

> Mục này là phần chênh của release candidate 2.0.0 so với production đang chạy commit `978f766`
> (bản 1.0.3). Production chưa bị thay đổi; mục này không phải bằng chứng đã deploy release.

### ⚠️ Việc phải làm khi cập nhật

1. **Sao lưu từng kho đang có dữ liệu trước khi cập nhật.** Trên iPhone, Safari và app mở từ biểu
   tượng Màn hình chính có thể là hai kho khác nhau; phải sao lưu ở đúng nơi đang nhìn thấy sổ.
2. **Đặt tên và một chữ cái A–Z riêng cho từng máy.** App sẽ chặn bán hàng cho tới khi máy có danh
   tính; chữ cái được đưa vào mã phiếu để hai quầy không tạo mã trùng nhau.
3. **Chọn đúng sổ nguồn trước khi ghép nhiều máy.** Máy đầu tiên đưa sổ cục bộ lên sổ chung. Nếu cả
   máy đang ghép và sổ chung đều đã có dữ liệu, app dừng với yêu cầu đối soát; không tự gộp và không
   ghi đè một bên. Xem ranh giới và quy trình tại [`dong-bo.md`](./dong-bo.md).
4. **Máy đã ghép không nhập file hoặc xoá sổ từ Cài đặt.** Khi bản sao cục bộ có vấn đề, dùng
   **Kéo lại từ đầu** để dựng lại từ sổ chung. File sao lưu vẫn phải được giữ như lớp phục hồi độc lập.
5. **Không quay lại app 1.x (bao gồm 1.0.3) sau khi đã mở 2.0.0.** Schema v5 là nâng cấp một chiều. Nếu app chính
   không mở được, operator dùng recovery artifact 2.0.0 trên đúng production origin để tải bản sao,
   rồi sửa bằng một bản 2.x mới hơn; không deploy lại frontend 1.x.

Nâng schema IndexedDB từ production hiện tại lên schema mới là tự động. Dữ liệu sổ cũ được cấp danh
tính đồng bộ và phiếu thu cũ được bổ sung trạng thái phân bổ; không có bước sửa file bằng tay. Nếu
app hiện khoản thu “chưa gắn vào đơn”, người bán cần vào lịch sử khách để gắn vào đơn còn nợ, xác
nhận đã trả lại khách hoặc bỏ có ghi vết. Việc nâng schema không xoá dữ liệu, nhưng app 1.x không
hiểu schema v5 và không phải đường rollback hợp lệ.

### Người bán sẽ thấy

- **Nhiều máy dùng chung một sổ.** Mỗi máy giữ bản sao IndexedDB và hàng đợi riêng, vẫn ghi được khi
  mạng chập chờn rồi tự hội tụ khi có mạng. WebSocket báo thay đổi ngay; poll 30 giây chỉ là đường dự
  phòng.
- Màn **Thêm → Cài đặt → Máy bán hàng** cho phép đặt tên/chữ cái, nhập hoặc tạo mã ghép dùng một lần,
  xem các máy đang hoạt động và thu hồi máy khác. M1 chưa có tài khoản hay vai trò; mọi máy đã ghép
  có quyền ngang nhau.
- Mã phiếu mới mang chữ cái máy, ví dụ `PBH-260811-A001`, để các quầy vẫn tạo mã khác nhau khi cùng
  bán lúc mất mạng.
- Banner đồng bộ nói rõ trạng thái chờ mạng, dữ liệu chưa đẩy, yêu cầu kéo lại hoặc máy đã bị thu hồi.
- **Huỷ đơn đã thu tiền không còn xoá phiếu thu.** Với đơn có khách, khoản tiền được xử lý trong lịch
  sử khách: gắn sang đơn còn nợ phù hợp, xác nhận đã trả lại hoặc bỏ có ghi vết. Với đơn khách lẻ,
  hai thao tác hoàn tiền/bỏ có ghi vết nằm ngay trong chi tiết đơn đã huỷ. Trạng thái đã xử lý là
  cuối cùng; một thiết bị cũ không thể phân bổ hoặc đổi quyết định đó trên sổ chung.
- Thông báo “Đã khôi phục đơn đang lên dở” chỉ hiện khi nháp thật sự đến từ phiên trước, không hiện
  chỉ vì người bán đi sang màn khác rồi quay lại.

### Sao lưu an toàn hơn

- Trước khi tải một bản sao không có đơn, mặt hàng, khách, khoản chi hoặc giá riêng còn dùng được,
  app cảnh báo rõ và nhắc người dùng iPhone kiểm tra đúng kho Safari/Màn hình chính.
- Sau khi tải thành công, thiết bị hỗ trợ Web Share có thể chia sẻ đúng file JSON vừa tạo. App vẫn
  yêu cầu kiểm tra thư mục Tải về vì trình duyệt có thể đổi tên file khi bị trùng.
- File mới dùng định dạng backup version 4. Máy chưa ghép vẫn nhập được file version 1–4; file không
  chứa token, mã máy, hàng đợi hay trạng thái đồng bộ.
- Dấu “lần cuối sao lưu” chỉ được cập nhật khi file có thể nhập lại; cảnh báo, chia sẻ và tải file
  được chặn bấm lặp để không đóng dấu hoặc chia sẻ nhầm bản.
- File backup version 4 không nhập ngược vào production 1.0.3 hoặc bất kỳ app 1.x nào. Giữ file đó để phục hồi bằng app 2.x;
  không dùng việc đổi trường `version` bằng tay làm đường downgrade.

### Phục hồi schema v5

- Release có thêm `dist-recovery/`, một artifact riêng chỉ hiển thị số bản ghi và tải file sao lưu.
  Nó không có bán hàng, nhập file, ghép máy, kéo lại từ đầu hay runner đồng bộ; tải recovery không
  ghi `lastBackupAt` hoặc tạo outbox.
- IndexedDB thuộc về origin. Preview URL hoặc localhost không thể đọc dữ liệu của production; khi có
  sự cố thật, operator phải kích hoạt recovery trên đúng production origin, sau khi đóng mọi tab
  Safari/PWA cũ. Trước khi đọc dữ liệu phải xác minh title/tab và banner đỏ của recovery sau khi
  service worker recovery đã tự giành quyền và trang được tải lại. Đây là thao tác production riêng,
  không tự xảy ra trong release candidate này.
- Thoát recovery bằng cách roll-forward artifact app 2.x đã sửa và yêu cầu người dùng cập nhật service
  worker/tải lại. Runbook đầy đủ ở [`deploy.md`](./deploy.md#phục-hồi-schema-v5-cùng-origin).

### Vận hành và độ tin cậy

- Thêm Cloudflare Worker và một Durable Object SQLite riêng cho mỗi quán. Staging dùng Worker và
  namespace tách khỏi production; hướng dẫn deploy/rollback nằm tại [`deploy.md`](./deploy.md).
- WebSocket upgrade được giữ nguyên qua Worker gateway; outbox, sự kiện online, lúc app hiện lại và
  WebSocket vẫn kích hoạt đồng bộ ngay, còn lease tab được duy trì cục bộ mà không dùng quota
  Cloudflare.
- Bộ kiểm thử thêm đường hai máy thật, quyết định khoản tiền terminal, mất mạng/hội tụ, thu hồi,
  rollback, kéo lại toàn bộ sổ, backup không lộ danh tính máy, recovery artifact và regression trực
  tiếp trên staging. Cổng chạy được sở hữu bởi
  [`robot/run.sh`](../robot/run.sh) và workflow [`.github/workflows/kiem-thu.yml`](../.github/workflows/kiem-thu.yml).

## 1.0.3 — 9/8/2026

### Đã thay đổi

- Mọi pull request vào `main` phải qua đủ hai cổng `Code quality and Playwright` và `Robot live`.
- Môi trường Robot Framework và Google Chrome được cài bằng một script có phiên bản cố định; runner
  chỉ quản lý Vite do chính nó tạo và không dừng process lạ đang giữ cổng 5175.
- Khi bộ live test thất bại trên GitHub Actions, report, log và ảnh chụp được giữ trong artifact
  `robot-live-results` để chẩn đoán.

### Cập nhật có cần làm gì thêm không

Không. Bản này chỉ siết quy trình kiểm thử và merge; hành vi app, dữ liệu IndexedDB và định dạng file
sao lưu không đổi.

## 1.0.2 — 8/8/2026

### Đã sửa

- **Mở app buổi sáng vẫn thấy "HÔM NAY" kèm doanh thu hôm qua.** App chỉ hẹn giờ đúng nửa đêm để đổi
  ngày, mà điện thoại thì bóp giờ hẹn của trang đang chạy nền — đóng cửa lúc 22h, sáng mở lại thì giờ
  hẹn đó chưa chắc đã nổ. Giờ mỗi lần app hiện lại màn hình là nó đối chiếu ngày ngay.
- **Báo cáo kỳ rộng nhanh hơn.** "7 ngày qua" và "Tháng" của quán đông khách trước đây bị đẩy sang
  đường đọc chậm gấp ba. Chỉ là tốc độ — số liệu không đổi.

### Cập nhật có cần làm gì thêm không

Không. Bản này không đụng tới dữ liệu đã lưu và không có gì phải soát lại.

Nếu chưa cập nhật lên 1.0.1 thì đọc tiếp mục dưới — **1.0.1 có việc phải làm bằng tay**.

## 1.0.1 — 8/8/2026

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
- Bản sao an toàn có chỗ hỏng thì không còn khoá cứng cả hai đường. Trước đây gặp cảnh đó là kẹt:
  không nhập được file mới mà cũng không xoá sạch được để bắt đầu lại. Giờ file vẫn tải về và app mở
  thêm một cửa xác nhận thứ ba nói rõ file đó không dựng lại sổ được, xoá là mất hẳn.
- Câu lỗi sao lưu không còn hiện trong khe lỗi của ô "Gõ XOA" — đọc như thể gõ sai chữ xác nhận.

### Đáng biết

Nhập file sao lưu sẽ **xoá phiếu thu của các đơn đã huỷ** có trong file đó. Đây là chủ ý: `paidAmount`
của đơn phải bằng tổng phiếu thu của nó, và phiếu thu nằm lại trên đơn huỷ vẫn cộng vào "Đã thu" của
kỳ trong khi màn chi tiết đơn không thấy nó. Cảnh này chỉ đến từ file của bản build cũ hoặc file sửa
tay — app hiện tại không cho thu tiền trên đơn đã huỷ.

### Cập nhật có cần làm gì thêm không

Không. Schema IndexedDB không đổi nên không có migration; `BACKUP_VERSION` vẫn là 1 nên file sao lưu
của bản cũ nhập lại được bình thường.
