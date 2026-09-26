# Open issues

### ISSUE-001 — `applier-pusher.test.ts` "cuộn ngược cả hai thao tác làm sau" chập chờn
- State: promoted → https://github.com/datshiro/my-biller/issues/28 (2026-09-01)
- Severity: medium
- Raised by: lượt thi công `plans/260901-1858-in-phieu-may-in-nhiet/`
- Date: 2026-09-01
- Related task: không — **có sẵn từ trước**, không phải hệ quả của kế hoạch phiếu/đá
- Description: `src/db/sync/__tests__/applier-pusher.test.ts:347` đỏ không đều.
  `AssertionError: expected { unitPrice: 55000 } to match { unitPrice: 50000 }` ở `:375`.
  Đo trên đúng cây đã `git stash` toàn bộ thay đổi của kế hoạch này: chạy riêng file đó **đỏ 5/6
  lượt**, chạy trong cả bộ thì thường xanh. Vậy nó phụ thuộc thứ tự/thời điểm, không phụ thuộc mã
  mới. `rollbackRejectedTail` cuộn ngược không tới thao tác đổi giá.
- Xác nhận độc lập: lượt code review trước khi ship PR #27 tái hiện lại, đỏ 4/6 khi chạy riêng file.
  Nghi can thu hẹp về `src/db/sync/pusher.ts:29-43` (`restoreRow`) — cuộn ngược được thao tác làm
  sau nhưng không dán lại `before` của chính thao tác bị từ chối.
- Mitigation: chưa đụng tới — ngoài phạm vi kế hoạch đang chạy, và CLAUDE.md cấm sửa mã lân cận
  không liên quan. Cần một lượt điều tra riêng: chốt chặn "đơn giá sau rollback" đang không chắc,
  mà đó là đường **tiền**.

### ISSUE-002 — `@page` cao 350mm ⇒ mỗi bill nhả 35cm giấy trên máy in cuộn
- State: deferred
- Severity: high
- Raised by: pha 2 của `plans/260901-1858-in-phieu-may-in-nhiet/`
- Date: 2026-09-01
- Related task: pha 2 (`receipt.css`), rủi ro R2-3 đã dự liệu sẵn
- Description: Chromium fragment theo hộp **bố cục**, không theo phần đã `scale`. Trang xấu nhất cao
  1110px bố cục = 293,7mm, nên `H` phải ≥ ~302mm thì một `.receipt-frame` mới ra đúng một tờ. Đo
  thật: `@page` 200mm làm 2 frame ra 3 trang PDF. Chốt 350mm để cổng đếm trang xanh.
  Hệ quả vật lý: `@page` là khổ CỐ ĐỊNH, nên bill 2 món cũng nhả đủ 350mm giấy. Tiêu chí vòng in thử
  của pha 1 đặt mốc "bill 3 món ≤ 12cm" ⇒ đường `window.print()` gần như chắc chắn trượt mốc đó.
- Mitigation: **người dùng chốt 2026-09-01: GIỮ 350mm, không làm thêm.** Lý do: bằng chứng 62,5% cho
  thấy chủ quán đang in bằng đường ẢNH, `window.print()` là đường phụ; mọi cổng tự động đã xanh. Mở
  lại chỉ khi vòng in thử cho thấy khách thực sự dùng nút In / Lưu PDF và kêu hao giấy. Ba đường
  thoát đã khảo sát, để sẵn cho lần đó:
  (a) giữ 350mm, chấp nhận hao giấy ở đường print (bằng chứng 62,5% nói khách đang in đường ẢNH,
      print là đường phụ);
  (b) bơm `<style>` `@page` với `H` tính theo TỪNG bill lúc render — giết cả hao giấy lẫn R2-2,
      nhưng là hạng mục mới ngoài phạm vi hợp đồng;
  (c) refactor px→em (đường thoát hợp đồng đã dự phòng) để hộp bố cục co theo scale — đắt nhất,
      đụng ~15 class và toàn bộ test.

### ISSUE-003 — `bao-cao.robot` đọc số ngay sau khi đổi kỳ, không chờ số tính lại
- State: resolved (2026-09-04, trên nhánh `feature/nut-cap-nhat-cai-dat`)
- Severity: low
- Raised by: lượt thi công `plans/260904-2225-nut-cap-nhat-cai-dat/`
- Date: 2026-09-04
- Related task: không — **có sẵn từ trước**, thay đổi của kế hoạch này không đụng màn Báo cáo
- Description: `Mở Báo Cáo Kỳ` (`bao-cao.robot:141`) bấm chip rồi chỉ kiểm `aria-pressed`, xong
  `Đọc Ô Số` `Get Text` ngay. Chip đổi trạng thái đồng bộ nhưng con số đi qua truy vấn bất đồng bộ,
  nên đọc được số của kỳ **mặc định** — là "Tháng" (`report-page.tsx:50`). Tháng 9 gồm cả đơn hôm
  qua nên số đó là 266.000, còn "Hôm nay" là 150.000. Ngày 1/9 (lúc CI xanh cho 2.2.0) tháng chỉ có
  đơn hôm nay nên hai số trùng nhau và race bị che; từ 2/9 trở đi nó lộ ra. Bằng chứng 4/9/2026:
  đỏ 3 lần liên tiếp (có tải nền, không tải nền, và **trên trạng thái `origin/main` sau khi stash toàn
  bộ diff của plan này** — `bao-cao.robot` 12 ca, 10 pass, 2 fail y hệt). Ca "Kỳ Hôm nay chốt đúng…"
  pass vì nó `Chờ Thấy Chữ LỢI NHUẬN` trước khi đọc. Không lệ thuộc giờ trong ngày: đơn hôm qua của
  seed là `now − 24h` (`src/db/seed.ts:50`).
- Mitigation: sửa tối thiểu ở suite (không đụng mã app) để check bắt buộc "Robot live" không đỏ vì
  lý do có sẵn. `Mở Báo Cáo Kỳ` chờ nhãn kỳ in hoa trong khối LỢI NHUẬN/LỖ (đổi cùng lượt render với
  con số) qua `&{NHÃN_KỲ}`; ca "Kỳ tự chọn" chờ nhãn `dd/MM – dd/MM/yyyy` sau khi sheet đóng. Chạy lại
  `bao-cao.robot`: 12/12 pass. Ghi rõ trong commit là sửa test có sẵn.

### ISSUE-004 — CI dựa vào thứ tự bước ngầm để có `dist-next` cho ca cập nhật
- State: deferred
- Severity: low
- Raised by: review độc lập PR #29 (S-3), `plans/reports/code-reviewer-260905-0100-pr-29-nut-cap-nhat.md`
- Date: 2026-09-05
- Related task: `plans/260904-2225-nut-cap-nhat-cai-dat/`
- Description: `kiem-thu.yml` bước "Build staging" sinh `dist-next`, còn `npm run test:e2e:recovery:built`
  chạy sau không tự build. Bỏ hay đảo bước đó thì `app-update.spec.ts` đỏ bằng timeout khó đọc
  (artifact server trả 404 cho mode `next`) chứ không phải "thiếu dist-next". Cùng kiểu phụ thuộc với
  `dist`/`dist-recovery` có sẵn từ trước, không riêng bản này.
- Mitigation: chưa làm. Khi đụng lại `artifact-server.mjs`: kiểm tồn tại các root lúc khởi động và
  báo tên thư mục thiếu.

### ISSUE-005 — Gateway Worker rơi `?since`, máy kẹt ở seq 500 và đồng bộ quay vòng nóng
- State: promoted → https://github.com/datshiro/my-biller/pull/32 (issue https://github.com/datshiro/my-biller/issues/31, 2026-09-05)
- Severity: high
- Raised by: lượt đo bước 4 của `plans/260904-2300-doi-soat-tong-the/` (Phase 2)
- Date: 2026-09-05
- Related task: không — **có sẵn từ commit đầu của đồng bộ** (`5d68797`), ngoài phạm vi plan Đối soát
- Description: `worker/src/index.ts` `forward()` dựng URL nội bộ chỉ từ pathname nên `GET /oplog?since=N`
  tới Durable Object luôn là `since=0` → mọi trang là seq 1..500 kèm `hasMore: true`. Máy có sổ chung từ
  500 sự kiện kẹt ở lastSeq 500, `pullAll` quay vòng nóng (18.806 GET /oplog trong ~4 phút trên wrangler
  dev) và vì tick gọi pullAll trước drainOutbox nên hàng đợi không lên sổ chung. Mọi test Worker chỉ hỏi
  `since=0`; bộ mẫu Robot hai máy chưa tới 500 sự kiện.
- Mitigation: nhánh hotfix riêng từ origin/main (kongming khuyên tách khỏi PR feature): giữ `url.search`
  khi chuyển tiếp; `pullAll` dừng khi trang không làm lastSeq tiến; ca Worker `since=N` + ca Vitest
  `pullAll`; bump 2.3.1 + ghi chú "bắt buộc deploy Worker". Feature Đối soát cherry-pick hai commit fix để
  đo. Production: chủ repo cần kiểm dashboard/wrangler tail theo hướng dẫn ở issue #31 — repo không có cách
  đọc oplog quán thật mà không có token máy.

### ISSUE-006 — Ca Robot hai máy "Thiết bị cũ không ghi đè khoản thu đã hoàn" đỏ ngẫu nhiên trên CI
- State: promoted
- Severity: low
- Raised by: Claude (ak:vibe, hotfix PR #32 CI)
- Date: 2026-09-05
- Related task: plan 260904-2300-doi-soat-tong-the, PR #32
- Description: Phép kiểm cuối ca (không bọc retry) đọc `orders` của B trong khoảng trống giữa `resetReadReplica` và `pullAll` sau khi `rollbackRejectedTail` ghi `resyncRequired` (restore conflict). Cơ chế có từ trước, không do #32 hay plan này.
- Mitigation: Promoted → GitHub issue #33 (bọc hai phép kiểm cuối bằng Wait Until Keyword Succeeds; cách tất định hơn là chờ `resyncRequired == false` VÀ `lastSeq_B == lastSeq_A`, vì riêng phép so lastSeq đúng cả ở trạng thái trước reset). CI job đã chạy lại và xanh. Đáng làm sớm: `main` đỏ thì không có artifact để tag bản phát hành.

### ISSUE-007 — Đường PWA + RawBT chưa nghiệm trên SPR02 thật (đường dùng hằng ngày)
- State: deferred
- Severity: medium
- Raised by: đối chiếu pha 5 với buổi test thật 08/09 (chỉ chạy đường APK/TCP), lượt 09/09
- Date: 2026-09-09
- Related task: pha 5 `plans/260905-1625-in-bill-tcp-truc-tiep-capacitor/` (T11–T14)
- Description: Buổi test thật 08/09 trên SPR02 (IP 192.168.1.86) **chỉ chạy đường APK/TCP**. Đường
  RawBT chưa từng gửi tới máy in thật một lần nào (bước 0 đo tại bàn của pha 3 cũng đã dời sang pha 5).
  Đường này mới verify trong **phần mềm**: Robot/e2e dựng `a[data-rawbt]` href đúng, giải mã ra ảnh
  576 chấm, guard `RAWBT_URL_MAX_CHARS`; e2e đo href 40 dòng = 17.416 ký tự (≪ 220.000). Người dùng
  chốt 09/09 dùng **CẢ HAI** đường hằng ngày, nên đây là đường thật sự sẽ dùng, không phải đường lùi.
  Bốn ẩn số chỉ máy in thật trả lời (plan U-a/b/c/d): RawBT có **tự cắt** không; có **resample** ảnh
  576 làm lệch/mờ không; phiếu **40 dòng** có lọt `rawbt:` qua Binder trên máy quán không; mất mấy
  **chạm** (RawBT free có hộp xác nhận/quảng cáo).
- Mitigation: Người dùng chốt 09/09 "**tạm chấp nhận, đi tiếp, sẽ quay lại test sau khi về quán**".
  Đường APK/TCP đã nghiệm thật là đường lùi đã chứng. Khi về quán chạy T11–T14 (bước có sẵn trong
  `phase-05`): RawBT "In thử" → PWA IN THỬ QUA RAWBT (đo thước 72mm?) → phiếu 25/40 dòng (cắt?
  resample? chạm?). Nếu RawBT không tự cắt / trượt phiếu dài → lối lùi `kind:'escpos'` (T14) hoặc hạ
  `RAWBT_URL_MAX_CHARS`/một `<a>`/tấm (seam đã có). **2.4.0 phát hành kèm đường web RawBT chưa nghiệm
  phần cứng — rủi ro người dùng đã chấp nhận có ý thức.**

### ISSUE-008 — Ba mục nghiệm-thu phần cứng còn lại của pha 5 (chỉ có bằng chứng phần mềm)
- State: deferred
- Severity: low
- Raised by: đối chiếu pha 5 với buổi test thật 08/09, lượt 09/09
- Date: 2026-09-09
- Related task: pha 5 (T3, T5/T6, hồi quy L4 bấm-đúp)
- Description: Buổi 08/09 chỉ in **phiếu ngắn** qua APK. Ba mục chỉ máy in thật xác nhận được, đã có
  bằng chứng phần mềm nhưng chưa lên giấy thật:
  (a) **T3 — đo thước 72mm** xác nhận đúng 576 chấm / in 1:1. Tờ mẫu đã ra giấy + cắt và "trông đúng"
      nhưng chưa cầm thước đo; khổ sai rõ thì đã thấy ngay.
  (b) **T5/T6 — phiếu 40 dòng** qua ranh khối `ROWS_PER_BAND=128` trên buffer máy thật. Golden-byte
      test chứng cấu trúc byte đúng; chỉ buffer vật lý của máy in chưa nghiệm (đứt/lệch?).
  (c) **Hồi quy bấm-đúp** SAU khi vá `useRef` (`printLock`/`testLock`) trên phần cứng. 2 ca Vitest
      chứng khoá chặn cú thứ hai (kiểm âm: bỏ khoá → test đỏ); chưa bấm-đúp lại trên máy thật để xác
      nhận ra đúng MỘT tờ.
- Mitigation: Gộp vào chuyến quán cùng ISSUE-007. T3 đo thước; T5 in `bill40.bin`; bấm-đúp nút "In"
  trong hộp xác nhận ra một tờ. Nếu lệch: T6 hạ `ROWS_PER_BAND` (64/48) hoặc đổi `DOTS_PER_LINE`/
  `THERMAL_RATIO` (số đo pha 5). Rủi ro thấp — đường tiền/nội dung đã khớp ở phiếu ngắn thật.

### ISSUE-009 — In tem TSPL chưa nghiệm trên máy XPrinter XP-365B thật
- State: deferred (phần lớn đã nghiệm 26/9, còn mục d)
- Severity: medium
- Raised by / Date: review độc lập nhánh `feature/in-tem-theo-so-luong` / 26/9/2026
- Related task: in tem theo số lượng (nút 🏷 IN TEM trên phiếu, mục MÁY IN TEM)
- Description: Byte TSPL đúng cú pháp theo sách TSPL và đã kiểm bằng Vitest + Robot (APK giả), nhưng chưa
  lên giấy. Cần xác nhận trên máy: (a) máy ở chế độ nhận TSPL/label; (b) khổ tem + khe hở thật của cuộn
  đang lắp (khổ 50×30 khe 2 đã in đúng trên máy thật 26/9, đã làm mặc định); (c) `DIRECTION 1,0` ra chữ đúng chiều;
  (d) job dài: plugin `PrinterSocket` chỉ có timeout lúc nối, lệnh ghi socket không có timeout — máy
  báo lỗi khe/cảm biến giữa job thì nút kẹt ở "Đang chuẩn bị tem…", in lại có thể ra tem gấp đôi khi máy
  hồi. Đơn trên 50 phần đã có câu nhắc trong hộp xác nhận.
- Nghiệm 26/9: (a)(b)(c) ĐẠT — XP-365B `192.168.1.9:9100` trả `MODEL:XP-365B` cho lệnh TSPL, tem 50×30
  khe 2 in đúng khổ, đúng chiều, có tên món và ghi chú, trên điện thoại của chủ quán và trên máy nhân viên
  (APK gộp tem + nhận in Bluetooth). Lỗi lần đầu là cuộn tem lắp ngược mặt, không phải code. Chưa thử (d).
- Mitigation: Chuyến quán cùng ISSUE-007/008: in đơn 3 phần, đơn 30 phần, và một job khi cố tình sai khe
  hở. Nếu (d) xảy ra thật: thêm watchdog đóng socket trong `PrinterSocketPlugin.java` (cần dựng lại APK).

### ISSUE-010 — In phiếu và in nhận qua Bluetooth không xếp hàng chung trên máy in TCP
- State: deferred
- Severity: medium
- Raised by / Date: review độc lập PR #39 / 26/9/2026
- Related task: 2.6.0 nhận in qua Bluetooth (`src/features/printer/bt-receiver.ts`)
- Description: Hàng đợi của `bt-receiver` chỉ xếp các job Bluetooth với nhau; nút in phiếu và IN THỬ gọi
  `nativeSink` trực tiếp. Job Bluetooth đang đổ vào cổng 9100 mà người bán bấm in phiếu thì mở nối TCP
  thứ hai — tuỳ firmware SPR02, một trong hai báo "In hỏng" (phải in lại) hoặc chờ rồi in sau. Không có
  đường in trùng hay sai sổ.
- Mitigation: Gom chuỗi promise vào `printer-sink.ts` (một `serialSink` dùng chung cho cả ba nơi gọi).
  Thử trên SPR02: job Bluetooth và phiếu cùng lúc để biết máy từ chối hay giữ nối thứ hai.

### ISSUE-011 — Lệnh bị cắt giữa chừng trên nối Bluetooth giữ mở làm kẹt im lặng các job sau
- State: deferred
- Severity: medium
- Raised by / Date: review độc lập PR #39 (đã dựng lại bằng probe) / 26/9/2026
- Related task: 2.6.0 nhận in qua Bluetooth (`bt-receiver.ts` `onIdle`, `job-framer.ts`)
- Description: Khi framer đang ở giữa một lệnh (`midCommand`), `onIdle` không hẹn giờ lại. Ảnh `GS v 0`
  khai 100 hàng mà chỉ tới 10 hàng, hay một `ESC` lẻ ở cuối, làm job kế tiếp bị nuốt làm dữ liệu ảnh:
  0 job ra, không log, không lỗi, cho tới khi máy gửi ngắt nối.
- Mitigation: Giới hạn thời gian chờ giữa lệnh (vd ~10 s tổng) rồi `flushNow()` để job dở báo lỗi
  "Job dừng giữa chừng một lệnh" thay vì biến mất. Hỏi xem app gửi ở quán có giữ nối SPP mở không.
