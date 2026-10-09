# Open issues

### ISSUE-001 — `applier-pusher.test.ts` "cuộn ngược cả hai thao tác làm sau" chập chờn
- State: resolved (27/09/2026, nhánh `feature/sua-open-issues-va-staging-ci`, đóng #28 qua PR)
- Nguyên nhân đã chứng (27/09): lỗi ở **app**, không ở test. Hai lần đổi giá rơi cùng một mili giây nên
  `updatedAt` hai bản như nhau; `restoreRow` `put` lại bản chụp, Dexie chỉ đưa phần khác nhau cho hook
  `updating` của `stampTimestamps` (`src/db/db.ts`), hook thấy thiếu `updatedAt` nên đóng dấu giờ mới, bản
  dán lại không còn khớp `after` của thao tác bị từ chối → coi là xung đột → giá kẹt ở 55.000. Sửa: tập
  `verbatimWrites` cho transaction cuộn ngược bỏ qua đóng dấu. Ca Vitest cố định đồng hồ đỏ 10/10 trên mã
  cũ; cả file chạy riêng 20/20 xanh (trước: đỏ 6/10). Review fresh-context: GO. Không có ca Robot: giao
  diện không dựng được hai lần sửa cùng mili giây kèm máy chủ từ chối.
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
- Rà 27/09/2026: giữ deferred — quyết định của người dùng ngày 01/09, chưa có phàn nàn hao giấy nào.
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
- State: resolved (27/09/2026)
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
- Resolved 27/09/2026: `artifact-server.mjs` kiểm ba thư mục lúc khởi động, thiếu thì thoát mã 1 kèm tên
  thư mục và lệnh build cần chạy.

### ISSUE-005 — Gateway Worker rơi `?since`, máy kẹt ở seq 500 và đồng bộ quay vòng nóng
- State: resolved (rà 27/09/2026: issue #31 đóng 06/09, bản sửa ship trong v2.3.1 qua PR #32)
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
- State: resolved (rà 27/09/2026: issue #33 đóng 06/09 qua PR #35)
- Severity: low
- Raised by: Claude (ak:vibe, hotfix PR #32 CI)
- Date: 2026-09-05
- Related task: plan 260904-2300-doi-soat-tong-the, PR #32
- Description: Phép kiểm cuối ca (không bọc retry) đọc `orders` của B trong khoảng trống giữa `resetReadReplica` và `pullAll` sau khi `rollbackRejectedTail` ghi `resyncRequired` (restore conflict). Cơ chế có từ trước, không do #32 hay plan này.
- Mitigation: Promoted → GitHub issue #33 (bọc hai phép kiểm cuối bằng Wait Until Keyword Succeeds; cách tất định hơn là chờ `resyncRequired == false` VÀ `lastSeq_B == lastSeq_A`, vì riêng phép so lastSeq đúng cả ở trạng thái trước reset). CI job đã chạy lại và xanh. Đáng làm sớm: `main` đỏ thì không có artifact để tag bản phát hành.

### ISSUE-007 — Đường PWA + RawBT chưa nghiệm trên SPR02 thật (đường dùng hằng ngày)
- State: deferred
- Rà 27/09/2026: giữ deferred — chỉ máy in thật trả lời được, chờ chuyến quán.
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
- Rà 27/09/2026: giữ deferred — chỉ máy in thật trả lời được, chờ chuyến quán.
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
- State: deferred (phần lớn đã nghiệm 26/9; mục d có mã 27/09, chờ máy thật)
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
- (d) có mã 27/09/2026: `SocketWriter.write` đóng socket bằng RST (bỏ byte còn trong bộ đệm máy gửi) khi quá hạn ghi (`writeTimeoutMs` = 20 s + 1 s/10 KB
  từ TS) → mã `EWRITETIMEOUT` → câu "Máy in ngừng nhận giữa chừng…"; hàng in TS có hạn riêng dài hơn 2 s.
  JUnit với server không đọc chứng lệnh ghi ném sau hạn, và ghi xong trước hạn thì không bị RST (chạy trong job
  `APK debug`). Giới hạn: write() trả về khi byte vào bộ đệm nhân, nên job nhỏ lọt hết bộ đệm thì hạn không bao
  giờ chạm dù máy in kẹt ngay sau đó — hạn này chỉ che job lớn (tem nhiều phần). **Staging/Robot không
  chạy mã Java này**: vẫn cần cài APK mới và thử job sai khe hở trên XP-365B.

### ISSUE-010 — In phiếu và in nhận qua Bluetooth không xếp hàng chung trên máy in TCP
- State: resolved (27/09/2026, mã; vẫn nên thử trên SPR02 ở chuyến quán)
- Severity: medium
- Raised by / Date: review độc lập PR #39 / 26/9/2026
- Related task: 2.6.0 nhận in qua Bluetooth (`src/features/printer/bt-receiver.ts`)
- Description: Hàng đợi của `bt-receiver` chỉ xếp các job Bluetooth với nhau; nút in phiếu và IN THỬ gọi
  `nativeSink` trực tiếp. Job Bluetooth đang đổ vào cổng 9100 mà người bán bấm in phiếu thì mở nối TCP
  thứ hai — tuỳ firmware SPR02, một trong hai báo "In hỏng" (phải in lại) hoặc chờ rồi in sau. Không có
  đường in trùng hay sai sổ.
- Mitigation: Gom chuỗi promise vào `printer-sink.ts` (một `serialSink` dùng chung cho cả ba nơi gọi).
  Thử trên SPR02: job Bluetooth và phiếu cùng lúc để biết máy từ chối hay giữ nối thứ hai.
- Resolved 27/09/2026: `nativeSink` giờ là `serialSink(sendRaw)` nên mọi job tới cùng một máy in (`host:port`)
  — in phiếu, IN THỬ, in tem, job Bluetooth — xếp một hàng; máy in phiếu và máy in tem khác địa chỉ thì chạy song song. Mỗi job có hạn riêng để một job treo không làm kẹt cả hàng. Chỉ Vitest:
  Robot không mở đường in TCP và không giả được nguồn Bluetooth.

### ISSUE-011 — Lệnh bị cắt giữa chừng trên nối Bluetooth giữ mở làm kẹt im lặng các job sau
- State: resolved (27/09/2026)
- Severity: medium
- Raised by / Date: review độc lập PR #39 (đã dựng lại bằng probe) / 26/9/2026
- Related task: 2.6.0 nhận in qua Bluetooth (`bt-receiver.ts` `onIdle`, `job-framer.ts`)
- Description: Khi framer đang ở giữa một lệnh (`midCommand`), `onIdle` không hẹn giờ lại. Ảnh `GS v 0`
  khai 100 hàng mà chỉ tới 10 hàng, hay một `ESC` lẻ ở cuối, làm job kế tiếp bị nuốt làm dữ liệu ảnh:
  0 job ra, không log, không lỗi, cho tới khi máy gửi ngắt nối.
- Mitigation: Giới hạn thời gian chờ giữa lệnh (vd ~10 s tổng) rồi `flushNow()` để job dở báo lỗi
  "Job dừng giữa chừng một lệnh" thay vì biến mất. Hỏi xem app gửi ở quán có giữ nối SPP mở không.
- Resolved 27/09/2026: dở một lệnh mà im quá `MID_COMMAND_MAX_MS` (10 s) thì bỏ phần dở, nhật ký ghi
  "Job dừng giữa chừng một lệnh"; job sau in bình thường. Chỉ Vitest (nguồn byte là plugin SPP native).
  Còn hỏi chủ quán: app gửi có giữ nối SPP mở không.

### ISSUE-012 — Áp sự kiện từ sổ chung đóng dấu lại `updatedAt`, bản sao lệch mốc giờ với máy chủ
- State: deferred (chờ người dùng chốt có gộp vào lượt này không)
- Severity: medium
- Raised by / Date: review fresh-context của bản sửa #28 / 27/09/2026
- Related task: cùng nguyên nhân với ISSUE-001 (`stampTimestamps` trong `src/db/db.ts`)
- Description: `src/db/sync/applier.ts:57-59` `put` sự kiện từ máy chủ. Sự kiện máy chủ tự dựng (ví dụ
  `refreshOrderFromPayments` trong `worker/src/shop-do.ts`) giữ nguyên `updatedAt` mà đổi `paidAmount`/`status`,
  nên hook đóng dấu `Date.now()` lên bản cục bộ — lần nào cũng xảy ra, không cần trùng mili giây. Tổng tiền và
  Đối soát không so `updatedAt`, máy chủ không kiểm `before`, nên hiện chưa sai tiền; nhưng `before` của các
  thao tác sau mang mốc đã lệch. `src/db/recalc.ts:23-34` đang lách cùng hành vi bằng hai lần `update`.
- Mitigation: đề xuất `verbatimWrites.add(transaction)` trong `applyEvents`, kèm ca Vitest và review riêng;
  gộp cách lách ở `recalc.ts` về cùng cơ chế. Chưa làm — ngoài phạm vi lượt sửa 27/09.

### ISSUE-013 — Hình chìm logo trên tem chưa nghiệm trên XP-365B thật và chưa có trong APK
- State: deferred
- Severity: medium
- Raised by / Date: kongming (tư vấn thiết kế #51) / 03/10/2026
- Related task: #51 cài logo quán và in logo làm hình chìm trên tem
- Description: Nút IN TEM chỉ có trên APK, mà APK đóng gói sẵn bản web (không `server.url`), nên phải dựng lại
  APK (nhớ tăng `versionCode`) thì máy in tem mới có tính năng. Độ phủ chấm thưa (Nhạt 3/16, Vừa 5/16, Đậm 8/16
  Bayer 4×4) và viền chữ 2 chấm mới thử trên ảnh mô phỏng tem 50×30, chưa lên giấy; nhiệt độ in có thể làm mỗi
  mức đậm hơn mô phỏng. Robot chỉ chứng được byte TSPL (APK giả).
- Mitigation: Chuyến quán cùng ISSUE-007/008/009: in đơn 3 phần ở cả ba mức, chế độ bên phải và chế độ góc trên tem 50×30, kiểm
  tên món, ghi chú, mã đơn và `i/n` đọc rõ. Máy rơi chấm lẻ → đổi tra Bayer sang `BAYER[y & 3][(x >> 1) & 3]`
  (ô rộng 2 chấm, cùng độ phủ) trong `src/domain/watermark.ts`. In đậm hơn mong đợi → hạ `STRENGTH_CELLS`
  3/5/8 → 2/4/6.

### ISSUE-014 — Lưu file vào Tải về trong APK chưa nghiệm trên máy thật; nhánh API 24–28 chưa nghiệm
- State: deferred
- Severity: medium
- Raised by / Date: lượt thi công #48 (cửa ra file `saveToDownloads`) / 04/10/2026
- Related task: #48 sao lưu & khôi phục — plugin `DownloadFile` (`android/app/src/main/java/dev/datshiro/mybiller/DownloadFilePlugin.java`)
- Description: Plugin mới chỉ được chứng là biên dịch (`./gradlew assembleDebug`) và lái bằng cầu nối Capacitor giả
  trong Robot (`robot/libraries/gia-lap-apk.cjs`). Chưa nghiệm trên máy thật: (a) API 29+ ghi qua `MediaStore.Downloads`
  (`IS_PENDING`, đọc lại `DISPLAY_NAME` khi trùng tên — One UI trên S25), cả `application/json` lẫn
  `text/csv;charset=utf-8`; (b) **chưa nghiệm API 24–28**: nhánh ghi thẳng `Download/` với quyền
  `WRITE_EXTERNAL_STORAGE` (`maxSdkVersion="28"`), hộp xin quyền và câu "Chưa cho phép ghi vào bộ nhớ, nên chưa lưu
  được file." khi người bán từ chối — không có máy hay emulator API ≤ 28 trong tay.
- Mitigation: Phase nghiệm thu của #48: S25 sao lưu hai lần ⇒ hai file trong Files › Tải xuống, lần hai bị đổi tên và
  app hiện đúng tên đó. API 24–28: emulator API 28 nếu dựng được; không thì ghi "chưa nghiệm" trong báo cáo nghiệm
  thu và giữ issue này.

### ISSUE-015 — Gộp file sao lưu: ba điểm review để sau (mã đổi hai lần, chi phí xem trước, phạm vi cảnh báo Thêm riêng)
- State: deferred
- Severity: low
- Raised by / Date: review độc lập đường Gộp của #48 (APPROVE-WITH-FIXES) / 04/10/2026
- Related task: #48 sao lưu & khôi phục — `src/domain/backup-merge.ts`, `src/features/settings/merge-preview-sheet.tsx`
- Description:
  (a) Một đơn đã được cấp mã mới ở lần gộp trước, nếu file sau mang bản mới hơn của chính đơn đó (hai máy chưa
  ghép cùng chữ) thì bị cấp mã lần nữa; mã mới có thể khác lần trước và `originalCode` không giữ mã trung gian.
  (b) `previewMerge` gộp lại 1 + 3×số xung đột lần mỗi khi đổi một lựa chọn; đo trên Mac: 80 ms với 4.000 đơn và
  20 xung đột — chưa đo trên S25.
  (c) Câu "phần dư mất khỏi công nợ" dưới *Thêm riêng* hiện mỗi khi dòng file đã trừ vào một đơn, kể cả khi đơn đó
  trên máy đã huỷ (khi ấy `recalcAll` đưa khoản thêm về chưa trừ, phần dư không mất) — cảnh báo rộng hơn thực tế.
- Mitigation: (b) đo trên S25 ở phase nghiệm thu; chậm thì chỉ tính hiệu ứng của một thẻ khi mở thẻ. (a), (c) chờ có
  ca thật; số tiền không sai trong cả ba trường hợp, báo cáo đối chiếu sau ghi vẫn bắt lệch.

### ISSUE-016 — Màn Sao lưu & khôi phục: bốn điểm giao diện từ lượt Reality Check trên emulator, để sau
- State: deferred
- Severity: low
- Raised by / Date: Reality Check nhánh `feature/sao-luu-khoi-phuc` trên emulator Android / 04/10/2026
- Related task: #48 sao lưu & khôi phục
- Description:
  (D9) Ghi đè xong, banner nhắc nói "Chưa sao lưu lần nào" vì `lastBackupAt` nằm trong bảng `settings` và đi theo
  file (file cũ chưa có mốc). (D6) Xem trước Gộp ở màn ngang bị chật. (D8) Chưa giới hạn cỡ file khi chọn file
  khôi phục. (D10) Chip lọc báo cáo nằm sát mép màn (theo ghi chú review, chưa xác định màn).
- Mitigation: chưa đụng — không sai tiền, không mất dữ liệu. Xét lại cùng lượt nghiệm thu máy thật (ISSUE-014);
  D9 cần chốt ý muốn: giữ mốc của máy khi Ghi đè hay mốc trong file.

### ISSUE-017 — Worker không ép duy nhất (customerId, itemId) của bảng giá riêng
- State: deferred
- Severity: medium
- Raised by / Date: review Codex vòng 3 (arbiter3 L-9 — báo cáo cục bộ dưới `plans/`, không commit nên không
  có link cố định) / 03/10/2026
- Related task: #50 Nhập CSV (phase 4), phát hiện khi lên plan — lỗi có sẵn, không do #50 gây ra
- Description: IndexedDB có chỉ mục duy nhất `&[customerId+itemId]` (`src/db/db.ts:139`), nhưng Worker không
  kiểm cặp này khi nhận sự kiện `customerPrices` (`worker/src/shop-do.ts`, `acceptEvent` không có luật nào cho
  cặp này). Hai máy đặt giá riêng cho cùng khách + món lúc mất mạng sẽ tạo hai dòng trên sổ chung với hai gid
  khác nhau; máy nào kéo về sau sẽ vấp chỉ mục duy nhất khi `applyEvents` ghi dòng thứ hai. Nhánh nối món của
  #50 (phase 4 bước A4) né được trường hợp của chính nó ("giá của món có sẵn thắng") nhưng không sửa lỗi gốc.
- Mitigation: ngoài phạm vi #50. Hướng sửa có thể dùng cùng khuôn với `item-name-taken`: mã từ chối riêng kèm
  gid dòng đang giữ cặp, máy nối hoặc bỏ dòng của mình.

### ISSUE-018 — Xung đột khách trong file CSV phụ thuộc thứ tự dòng (không khớp SĐT ngược với tên)
- State: deferred
- Severity: low
- Raised by / Date: kongming (review phase 1-3, ak:vibe #50) / 06/10/2026
- Related task: #50 phase 2, `src/domain/nhap-file.ts` `planCustomerImport`
- Description: Nhánh "có SĐT" chỉ tìm đích mới theo `digitsOf` (đúng như plan đã chốt, không tìm theo tên);
  nhánh "không SĐT" tìm đích mới theo tên (kể cả đích có SĐT). Vì vậy, file có dòng A "Chị Lan" (không SĐT)
  rồi dòng B "Chị Lan" kèm SĐT → sinh **hai khách** (B không khớp ngược lại đích tên của A). Đảo thứ tự (B
  trước A) thì lại đúng ra lỗi "cùng một khách" (A khớp tên của đích B). Kết quả phụ thuộc thứ tự dòng.
- Mitigation: đây là hệ quả trực tiếp của luật đã chốt sau 3 vòng review (chỉ khớp theo digitsOf khi có SĐT,
  không mở rộng sang tên) — không tự ý đổi thuật toán phân loại mà không hỏi lại người dùng, vì sẽ lật một
  quyết định đã duyệt. Nếu muốn sửa: mở rộng nhánh "có SĐT" để cũng tìm đích mới theo tên khi không khớp SĐT,
  thêm ca test đối xứng cho cả hai thứ tự dòng. Ngoài phạm vi #50 cho tới khi người dùng xác nhận.

### ISSUE-019 — resolveItemNameTaken không tự kiểm existingGid khác entityKey của chính sự kiện bị từ chối
- State: resolved
- Severity: low
- Raised by / Date: kongming (review phase 4, ak:vibe #50) / 06/10/2026
- Related task: #50 phase 4, `src/db/sync/item-name-taken.ts` (hàm `resolveItemNameTaken`)
- Description: Hiện tại SQL phía Worker (`worker/src/shop-do.ts`, `itemNameTaken`) luôn loại trừ chính entityKey
  đang xét (`entityKey != ?`), nên `existingGid` trả về không bao giờ trùng `rejected.entityKey`. Nhưng phía
  client không tự kiểm lại điều này — nếu một thay đổi SQL sau này ở Worker vô tình làm `existingGid` trùng
  `rejected.entityKey`, `resolveCreate` sẽ xoá D cục bộ rồi trỏ `orderLines`/`customerPrices` sang `existing.id`
  = id vừa xoá, tạo dòng đơn mồ côi.
- Mitigation: ngoài phạm vi #50 vì điều kiện hiện không xảy ra được. Nếu muốn phòng thủ: thêm guard
  `if (existingGid === rejected.entityKey) return 'deferred'` đầu `resolveItemNameTaken`, kèm ca test.
- Resolution (08/10/2026): `resolveItemNameTaken` trả `'deferred'` ngay khi `existingGid === rejected.entityKey`
  hoặc bảng bị từ chối không phải `items`, trước khi mở giao dịch.

### ISSUE-020 — Một dòng item-name-taken bị 'deferred' vĩnh viễn thì máy kẹt ghi mãi, không có lối thoát UI
- State: resolved
- Severity: medium
- Raised by / Date: kongming (review phase 4, ak:vibe #50) / 06/10/2026
- Related task: #50 phase 4, `src/db/sync/item-name-taken.ts` + `src/db/sync/pusher.ts` (`pushNext`)
- Description: Nếu phản hồi `item-name-taken` của Worker thiếu `existingGid`/`existingName` (lệch phiên bản
  Worker/app) hoặc `existing` không bao giờ về máy, `pushNext` trả `'deferred'` vĩnh viễn cho dòng đó — không
  sai dữ liệu, chỉ là máy không bao giờ đẩy tiếp được dòng này hay các dòng outbox phía sau (head-of-line,
  ISSUE đã ghi ở red-team phase 4). Thứ tự deploy Worker-trước-Pages ở plan loại trừ chiều lệch phiên bản này,
  nên hiện không xảy ra được qua đường deploy bình thường; nhưng không có nút nào trên UI để người bán tự thoát
  khỏi trạng thái "1 thao tác chờ" treo mãi nếu nó vẫn xảy ra do lý do khác (ví dụ Worker có bug khác).
- Mitigation: ngoài phạm vi #50. Nếu cần: thêm giới hạn số lần thử `'deferred'` trước khi đổi sang báo lỗi rõ
  ràng + cho người bán chọn "bỏ qua dòng này" (mất đồng bộ của riêng dòng đó, không mất đơn hàng).
- Cập nhật (08/10/2026, review độc lập trước merge PR #68): mô tả "không xảy ra qua đường bình thường" là sai. Người
  bán tự gây ra được: máy kéo về món E của máy khác trước khi kịp đẩy `create D` trùng tên, rồi xoá E (E chưa bán
  trên máy này nên được xoá). Sổ chung vẫn từ chối D vì E còn đang bán ở đó, E không còn trên máy, lượt kéo không gửi
  lại E → hoãn mãi. Ngoài ra nhánh `put` (đổi tên / bán lại bị chặn) từng đòi E có trên máy dù không dùng tới.
- Resolution (08/10/2026): nhánh `create` thấy E vắng mà outbox còn lần xoá E chưa đẩy thì hoàn lại trọn giao dịch
  xoá đó (chỉ khi nó chỉ gồm xoá E và giá riêng của E) bằng `restoreRow`, rồi nối D vào E như thường; câu báo nói E
  được khôi phục. `restoreRow` gặp xung đột thì huỷ cả giao dịch và hoãn như cũ. Nhánh `put` không còn đòi E. Ca
  Vitest trong `src/db/sync/__tests__/item-name-taken.test.ts`. Phần "không có nút thoát trên UI" cho các nguyên nhân
  hoãn khác (Worker lệch phiên bản, bug) vẫn chưa có.

### ISSUE-021 — syncTransaction để lại promise outbox mồ côi khi callback ném sau vài write thành công
- State: deferred
- Severity: low
- Raised by / Date: kongming (checkpoint sau phase 5, ak:vibe #50) / 06/10/2026
- Related task: #50 phase 5, `src/db/sync/outbox.ts` (`syncTransaction`/`capture`)
- Description: `capture()` đẩy promise `refsFor(...).then(outbox.add)` vào `context.pending` (`outbox.ts:126-144`).
  Nếu callback của `syncTransaction` ném SAU khi vài write đã thành công (vd `ItemSchema.parse` hỏng ở dòng
  giữa một vòng lặp ghi nhiều món), `syncTransaction` không bao giờ chạy tới `await Promise.all(context.pending)`
  (`outbox.ts:197-199`) — các promise capture đang dở trở thành mồ côi, reject không ai bắt khi transaction
  abort. Dữ liệu vẫn abort trọn vẹn (IndexedDB tự rollback), không sai tiền hay mất dữ liệu; hậu quả chỉ là
  `unhandledrejection` (Node/test: có thể đổi exit code; trình duyệt thật: chỉ là console noise). #50 né được
  bằng cách validate-trước (soát ItemSchema.parse cho mọi dòng trước khi ghi byte đầu), nhưng đây là lỗ hổng
  chung của `syncTransaction`, không riêng #50 — bất kỳ chỗ gọi nào ghi nhiều dòng trong một transaction rồi
  ném giữa chừng (vd nhập 500 dòng vấp quota đầy) đều có thể lộ lại.
- Mitigation: ngoài phạm vi #50 (sửa `outbox.ts` kéo theo delta re-review phase 3+4 đã duyệt). Hướng sửa gợi ý:
  trong nhánh `catch` của `syncTransaction`, `await Promise.allSettled(context.pending)` trước khi `throw` lại.

### ISSUE-022 — Kế hoạch ghi lúc bấm NHẬP tính lại theo sổ mới nhất, có thể khác bản xem trước đã duyệt
- State: deferred (người dùng chốt 06/10/2026: giữ hành vi hiện tại, chỉ ghi chú)
- Severity: medium
- Raised by / Date: review độc lập (code-reviewer, ak:vibe #50 phase 5/6/8) / 06/10/2026
- Related task: #50 phase 5, `src/db/repositories/nhap-file.ts` (`applyItemImport`/`applyCustomerImport`)
- Description: `apply*` tính lại `planItemImport`/`planCustomerImport` bên trong `syncTransaction` dựa trên
  dữ liệu đọc **lúc đó**, không phải bản xem trước người dùng đã thấy trên màn hình. Chỉ ném
  `ImportChangedError` khi kế hoạch mới có lỗi (vd thành mơ hồ vì 2 bản trùng) — mọi chênh lệch khác (một
  dòng từ "tạo mới" chuyển thành "trùng, cập nhật" vì giữa lúc xem trước và lúc bấm NHẬP có máy khác vừa
  thêm/đồng bộ kéo về một món cùng tên) đều lặng lẽ áp theo chính sách đã chọn (`'skip'`/`'update'`) mà
  không báo. Ca `src/db/__tests__/nhap-file.test.ts` ("thêm 'Trà đá' vào DB sau lúc dựng rows: update thì
  cập nhật, không tạo bản thứ hai") đã khoá chính hành vi này có chủ đích, để giữ đúng luật "không bao giờ
  tạo món trùng tên". Cửa sổ đua chỉ hẹp (giữa lúc mở xem trước và lúc bấm NHẬP trên một máy) và không làm
  mất dữ liệu — chỉ có thể ghi đè giá/thông tin của một món mà người bán chưa từng thấy là trùng.
- Mitigation: người dùng đã xác nhận giữ nguyên, ưu tiên đúng luật "không tạo món trùng tên" hơn là chặn
  chặt thêm. Nếu sau này muốn chặn chặt hơn: truyền phân loại lúc xem trước (`line → create | existing.id`)
  vào `apply*`, ném `ImportChangedError` khi một dòng đổi phân loại dù không phải lỗi — cần sửa lớp ghi đã
  qua review độc lập, nên sẽ cần review lại phần sửa.

### ISSUE-023 — Xem trước khách trùng không liệt kê dòng và thay đổi, "Cập nhật tất cả" có thể đổi tên khách không ai thấy trước
- State: deferred
- Severity: medium
- Raised by / Date: review độc lập (code-reviewer, ak:vibe #50 phase 6) / 06/10/2026
- Related task: #50 phase 6, `src/features/settings/nhap-file-page.tsx` (`CustomerPreview`)
- Description: `ItemPreview` liệt kê từng dòng trùng kèm thay đổi cụ thể, nhưng `CustomerPreview` chỉ hiện ba
  con số đếm (tạo/cập nhật/bỏ qua), không có danh sách "tên cũ → tên mới". Khớp theo SĐT thì `changes.name`
  ghi đè tên khách trong sổ (`src/domain/nhap-file.ts:267`) — người bán bấm "Cập nhật tất cả khách trùng"
  là đổi tên hàng loạt khách mà không xem được trước dòng nào đổi thành gì.
- Mitigation: ngoài phạm vi phase 6 đã review GO. Nếu muốn sửa: thêm danh sách dòng trùng kèm tên cũ → tên
  mới vào `CustomerPreview`, theo đúng khuôn `ItemPreview` đã có.

### ISSUE-024 — Nhập món trùng tên khi sổ có đúng 1 bản đang bán + 1 bản ngừng bán vẫn báo lỗi oan "Sổ đang có 2 món"
- State: deferred
- Severity: low
- Raised by / Date: review độc lập (code-reviewer, ak:vibe #50 phase 5) / 06/10/2026
- Related task: #50 phase 5, `src/domain/nhap-file.ts:208-212` (`planItemImport`)
- Description: Luật mới (phase 3/8) cho phép sổ có một món đang bán và một món ngừng bán cùng tên. Nhưng
  `planItemImport` khi thấy 2 bản khớp tên luôn báo lỗi "Sổ đang có 2 món tên X, sửa trong app trước" và
  khoá cả file (Q4 đã chốt: còn lỗi thì chặn cả lần nhập), kể cả khi chỉ có đúng một bản đang `isActive`.
- Mitigation: ngoài phạm vi #50. Nếu muốn sửa: khi `matches.length > 1` nhưng chỉ đúng một bản `isActive`,
  ưu tiên khớp dòng CSV vào bản đang bán đó thay vì báo lỗi.

### ISSUE-025 — Chặn "Bán lại" trùng tên dựa trên snapshot, có khe hở đua nhau trên máy chưa ghép mở nhiều tab
- State: deferred
- Severity: low
- Raised by / Date: review độc lập (code-reviewer, ak:vibe #50 phase 8) / 06/10/2026
- Related task: #50 phase 8, `src/features/items/item-form-page.tsx` (`toggleActive`)
- Description: Guard đọc `useLiveQuery`/`useItems() ?? []` rồi mới `updateItem`, không kiểm lại trong cùng
  transaction Dexie lúc ghi. Chú thích nói "Worker là chốt cuối" — đúng với máy **đã ghép**, nhưng máy
  **chưa ghép** (chỉ có sổ cục bộ, không có Worker) mở hai tab cùng bấm "Bán lại" gần nhau có thể tạo hai
  món cùng tên đang bán mà không ai chặn.
- Mitigation: ngoài phạm vi #50. Nếu muốn sửa: thêm `reactivateItem(id)` ở repository, kiểm lại điều kiện
  trùng tên bên trong `syncTransaction` (các transaction rw của Dexie chạy nối tiếp, không chạy chồng).

### ISSUE-026 — Lỗi Zod hiện nguyên văn kỹ thuật ra giao diện khi bản ghi cũ không còn hợp schema
- State: deferred
- Severity: low
- Raised by / Date: review độc lập (code-reviewer, ak:vibe #50 phase 8) / 06/10/2026
- Related task: #50 phase 8, `src/features/items/item-form-page.tsx` (`toggleActive` qua `useSubmitOnce`)
- Description: Nếu `ItemSchema.parse`/`CustomerSchema.parse` ném (vd bản ghi cũ không còn hợp schema mới),
  `useSubmitOnce` hiện thẳng `caught.message` của `ZodError` — là JSON kỹ thuật, không lộ PII hay bí mật
  nhưng khó đọc với người bán.
- Mitigation: ngoài phạm vi #50. Nếu muốn sửa: bọc lỗi Zod thành câu tiếng Việt chung ở lớp gọi.

### ISSUE-027 — Danh sách thay đổi món trong xem trước không ghi tên trường, không phân biệt giá bán/giá vốn
- State: deferred
- Severity: low
- Raised by / Date: review độc lập (code-reviewer, ak:vibe #50 phase 6) / 06/10/2026
- Related task: #50 phase 6, `src/features/settings/nhap-file-page.tsx:70-74` (`ItemPreview`)
- Description: Dòng thay đổi in giá trị liền nhau (vd "4.000 đ, 3.000 đ") không ghi tên trường, nên không
  phân biệt được đâu là giá bán, đâu là giá vốn khi cả hai cùng đổi.
- Mitigation: ngoài phạm vi #50. Nếu muốn sửa: thêm nhãn trường trước mỗi giá trị trong danh sách thay đổi.

### ISSUE-028 — Đổi chip Món/Khách hoặc chọn file thứ hai trước khi file trước đọc xong có thể hiện nhầm xem trước cũ
- State: deferred
- Severity: low
- Raised by / Date: review độc lập (code-reviewer, ak:vibe #50 phase 6) / 06/10/2026
- Related task: #50 phase 6, `src/features/settings/nhap-file-page.tsx:228-252` (`pickFile`)
- Description: `pickFile` giữ `kind` trong closure và không huỷ lượt đọc cũ. Đổi chip Món/Khách, hoặc chọn
  file thứ hai, trong lúc file đầu chưa đọc xong, có thể khiến xem trước của lượt cũ hiện đè lên sau khi nó
  đọc xong trễ. Lúc ghi vẫn đúng loại theo file vì `applyItemImport`/`applyCustomerImport` được chọn theo
  `itemPlan`/`customerPlan` đang có, không theo `kind` — chỉ giao diện xem trước bị lệch, không ghi sai.
- Mitigation: ngoài phạm vi #50. Nếu muốn sửa: huỷ lượt đọc cũ (token/`AbortController`) khi `kind` đổi
  hoặc chọn file mới trước khi lượt cũ xong.

### ISSUE-029 — Máy ngừng bán món E (chưa đẩy) rồi bị nối món trùng tên vào E: sổ chung mất món đang bán
- State: deferred
- Severity: medium
- Raised by / Date: kongming (tư vấn sửa ISSUE-020, ak:vibe #50) / 08/10/2026
- Related task: #50, `src/db/sync/item-name-taken.ts` (`resolveCreate`)
- Description: Cùng kịch bản ISSUE-020 nhưng người bán bấm "Ngừng bán" E thay vì xoá. E còn trên máy (`isActive: 0`)
  nên `resolveCreate` nối D vào E, rồi sự kiện `put E isActive 0` đang chờ được đẩy lên: mọi máy mất món "Trà" đang
  bán, đơn của D treo vào món ngừng bán. Không mất đơn, không kẹt hàng đợi, nhưng sổ chung ra kết quả trái ý người bán.
- Mitigation: ngoài phạm vi #50. Hướng sửa cùng khuôn ISSUE-020: trước khi nối, hoàn lại giao dịch `put` đang chờ
  của E có `before.isActive === 1 && after.isActive === 0`, kèm câu báo.

### ISSUE-030 — `itemGroups.get` / `orderLines.get` với id không còn thì ném TypeError thay vì trả `undefined`
- State: deferred
- Severity: low
- Raised by / Date: phát hiện khi viết ca Vitest cho nhánh khôi phục món (ak:vibe #50) / 09/10/2026
- Related task: `src/db/db.ts` (`defaultArrayFields`), `src/db/repositories/items.ts` (`getGroup`, `updateGroup`)
- Description: hook `reading` của `defaultArrayFields` đọc `row[field]` mà không kiểm `obj` rỗng. Dexie gọi hook này cả
  khi `get` không tìm thấy, nên `db.itemGroups.get(idĐãXoá)` ném "Cannot read properties of undefined". Ví dụ:
  `item-group-menu-sheet.tsx` đang mở `getGroup(groupId)` mà máy khác xoá nhóm đó.
- Mitigation: ngoài phạm vi #50. Sửa một dòng trong hook (`if (!obj) return obj`) kèm ca Vitest; `item-name-taken.ts`
  dùng `where('id').count()` nên không vấp lỗi này.

### ISSUE-031 — Hai lần xoá cùng một món có sẵn nằm trong hàng đợi khi món trùng tên được nối
- State: deferred
- Severity: low
- Raised by / Date: kongming (review trước merge PR #68, ak:vibe #50) / 09/10/2026
- Related task: #50, `src/db/sync/item-name-taken.ts` (`restoreLocallyDeleted`)
- Description: Khi `create D` còn kẹt, người bán xoá món có sẵn E, máy khác sửa E (máy kéo về, E xuất hiện lại), rồi
  người bán xoá E lần nữa. Nhánh khôi phục lấy lần xoá mới nhất; lần xoá cũ vẫn chờ đẩy, lên sổ chung sau khi dòng đơn
  của D đã trỏ sang E thì bị từ chối vì còn được dùng, và `rollbackRejectedTail` cuộn các thay đổi phía sau.
- Mitigation: ngoài phạm vi #50, rất khó xảy ra. Sửa: hoãn khi outbox có hơn một lần xoá E, kèm ca Vitest.

### ISSUE-032 — Phím Back trên APK đóng sheet thu tiền/thu nợ đang lưu
- State: resolved
- Severity: low
- Raised by / Date: code-reviewer (review trước PR #70, #65) / 09/10/2026
- Related task: #65, `src/ui/sheet.tsx` (`useBackDismiss(onClose)`)
- Description: `Sheet` đăng ký Back như nút ✕, kể cả khi `collect-debt-sheet` / `payment-sheet` đang ghi. Lệnh ghi vẫn
  chạy xong nên không mất dữ liệu, nhưng người bán không thấy kết quả. Trên điện thoại Back dễ bấm nhầm hơn ✕.
- Mitigation: hành vi giống nút ✕ hiện nay; chắn Back ở form đã chốt là ngoài phạm vi #65. Nếu làm: cho `Sheet` nhận cờ
  đang lưu và nuốt Back như `ConfirmDialog` khi `pending`, kèm ca Vitest và Robot APK giả.
- Resolution (09/10/2026, #72): làm đúng như trên. `Sheet` có cờ `busy`; khi bận, Back bị nuốt (lớp vẫn trên ngăn xếp,
  không đóng, không lùi màn, không thu app). Sheet Thu tiền và Thu nợ bật cờ trong lúc lưu. ✕, lớp phủ và Escape
  không đổi. Có ca Vitest cho mỗi sheet và ca Robot APK giả (`ban-hang.robot`, `cong-no.robot`) đối chiếu `payments`.

### ISSUE-033 — Hộp thoại mount cùng commit với Sheet cha thì Back đóng nhầm Sheet
- State: deferred
- Severity: low
- Raised by / Date: kongming / code-reviewer (PR #70, #65) / 09/10/2026
- Related task: #65, `src/ui/back-dismiss.ts`
- Description: React chạy effect của con trước cha, nên lớp của Sheet được đẩy sau và nằm trên hộp thoại con. Hiện
  không có chỗ nào mount hai lớp trong cùng một commit (mọi hộp mở bằng một cú chạm sau); ca "giới hạn" trong
  `src/ui/__tests__/back-dismiss.test.tsx` báo khi điều này đổi.
- Mitigation: nếu cần, xếp lớp theo thứ tự mount trong DOM thay vì thứ tự effect.


### ISSUE-034 — Máy hoạt động cuối cùng tự huỷ ghép thì sổ chung không còn máy nào mở được
- State: resolved (9/10/2026, 2.18.0 qua #78 — quyết định: cảnh báo trong hộp xác nhận, không chặn; máy ghép dở vẫn
  tính là máy khác, ghi trong ghi chú phát hành 2.18.0)
- Severity: medium
- Raised by / Date: code-reviewer (#53) / 09/10/2026
- Related task: #53, `src/db/sync/unpair.ts`
- Description: "Huỷ ghép máy này" không xét máy đang huỷ có phải máy hoạt động duy nhất của quán không. Nếu phải, sau
  khi thu hồi không còn token nào mở được sổ chung trên Durable Object. Không mất dữ liệu: bản sao cục bộ đã đuổi kịp
  `latestSeq` trước khi thu hồi, và sổ chung vẫn nằm nguyên trên Worker. Hộp xác nhận hiện không cảnh báo trường hợp này.
- Mitigation: chủ app chọn chỉ cảnh báo (9/10/2026). Hộp xác nhận đếm máy có `revokedAt === null` trong `/devices`,
  tải lại khi mở hộp; còn mỗi máy này thì mở đầu bằng câu cảnh báo máy cuối cùng, nút Huỷ ghép vẫn chạy.

### ISSUE-035 — "Dùng máy này như máy chưa ghép" có thể giữ bản sao chưa tải xong
- State: deferred
- Severity: medium
- Raised by / Date: code-reviewer (#53) / 09/10/2026
- Related task: #53, `src/db/repositories/device-state.ts` (`leaveSharedLedger` nhánh `revoked`), `src/features/settings/ghep-may-page.tsx`
- Description: máy bị thu hồi giữa lúc đang tải lại sổ chung thì bản sao cục bộ thiếu thay đổi của máy khác. Nhánh này
  không còn token để hỏi Worker nên không kiểm được độ tươi; hộp xác nhận không nói bản sao có thể thiếu.
- Mitigation: cần quyết định câu chữ — thêm một câu vào hộp xác nhận rằng sổ cục bộ có thể thiếu thay đổi của máy khác
  và nên nhờ máy còn ghép xuất sao lưu nếu cần.

### ISSUE-036 — Bấm ✕ giữa lúc thu nợ rồi mở lại sheet thì thu được lần hai
- State: deferred
- Severity: medium
- Raised by / Date: code-reviewer (review #72) / 09/10/2026
- Related task: #72, `src/features/debts/collect-debt-sheet.tsx` (`useSubmitOnce` nằm trong sheet)
- Description: cờ đang lưu của sheet Thu nợ là state trong chính sheet. Bấm ✕ trong lúc "Đang lưu…" làm sheet bị gỡ;
  mở lại thì sheet mới có `saving=false`, nên bấm THU lần nữa sẽ gửi `collectDebt` thứ hai. Sheet Thu tiền không bị,
  vì cờ của nó nằm ở màn bán hàng. Back đã bị chặn (#72); ✕ cố ý chưa đổi. `expense-sheet.tsx` cũng ghi tiền mà chưa có
  `busy`.
- Mitigation: chưa làm. Hướng sửa: nâng cờ đang lưu lên màn mở sheet (như sheet Thu tiền), hoặc khoá cả ✕ và lớp phủ
  khi `busy`. Cả hai đều đổi hành vi của ✕, nên cần chủ app quyết định.

### ISSUE-037 — Máy có thể từng hiện "đã ghép sổ chung" dù APK chưa bao giờ ghép được
- State: open
- Severity: low
- Raised by / Date: planner (#49) / 09/10/2026
- Related task: #49, `src/db/sync/client.ts` (`resolveDefaultSyncUrl`), `src/features/settings/ghep-may-page.tsx`
- Description: trước #49, APK coi WebView `https://localhost` là máy dev và trỏ sync về `http://127.0.0.1:8787`, nên theo
  mã thì chưa APK nào ghép được. Chưa xác nhận trên S25 hay APK nào khác rằng Cài đặt › Máy bán hàng chưa từng hiện
  "đã ghép sổ chung".
- Mitigation: nếu có máy như vậy, thu hồi máy đó từ máy khác rồi ghép lại bằng APK mới. Chờ chủ app kiểm trên máy thật.

### ISSUE-038 — Ghi chú riêng tư về nhịp báo chỉ có trong tài liệu, chưa có trong app
- State: deferred
- Severity: low
- Raised by / Date: planner (#49) / 09/10/2026
- Related task: #49, `src/app/unpaired-heartbeat.ts`, `docs/dong-bo.md#ranh-giới-dữ-liệu`
- Description: máy chưa ghép gửi tên quán, phiên bản, số đơn, số khách và tổng nợ lên Worker mà app không nói với người
  bán, cũng không có nút tắt. Ghi chú hiện chỉ nằm ở `docs/dong-bo.md` và `README.md`.
- Mitigation: mặc định chỉ ghi trong docs (quyết định của #49). Nếu chủ app muốn, thêm một dòng ở Cài đặt hoặc một nút
  tắt nhịp báo; cả hai là quyết định sản phẩm.
