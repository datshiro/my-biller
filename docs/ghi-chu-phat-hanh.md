# Ghi chú phát hành

## 2.10.0 — logo cửa hàng và logo chìm trên tem (3/10/2026)

> **Deploy Worker TRƯỚC Pages/APK; chỉ cài APK 2.10.0 sau khi tag đã deploy xong.** Bản ghi Thông tin cửa hàng có
> thêm hai trường (`logo`, `labelWatermark`; không đổi schema IndexedDB, không bump version Dexie, không đổi phiên
> bản file sao lưu). Worker còn chạy bản cũ thì mỗi lần máy mới lưu Thông tin cửa hàng, logo bị cắt khỏi sổ chung.
> Máy còn ở 2.9.0 thì **không** phá gì: Worker mới giữ logo khi máy cũ lưu thông tin quán — không cần cập nhật mọi
> máy trong cùng ngày. APK tăng versionCode (7) để cài đè được.

### Người bán thấy gì

- **Cài đặt › Thông tin cửa hàng › Logo cửa hàng:** chọn ảnh PNG/JPG → thấy ngay bản **đen trắng đúng như khi in**
  (cắt sát nét). Có "Chọn ảnh khác" và "Gỡ logo". File ảnh trên 5 MB bị từ chối — chọn file logo, đừng chọn ảnh
  chụp từ camera.
- **Hình chìm trên tem** (chỉ hiện khi đã có logo): bật "In logo chìm trên tem", chọn **Giữa tem** hoặc **Góc trên
  phải**, và mức **Nhạt / Vừa / Đậm** (chỉ ở giữa tem). Cài một lần cho **mọi máy đã ghép**.
- **Tem in ra (APK):** giữa tem có logo chấm thưa nằm dưới chữ, chừa viền trắng quanh nét chữ để tên món và ghi
  chú vẫn đọc được; số `i/n` không bị logo lấn. Góc trên phải là logo nhỏ in đặc (~6 mm ở tem 50×30), dòng tên
  quán và mã đơn chừa chỗ cho logo. Tắt hình chìm thì tem y hệt bản trước.
- Logo trong sổ bị hỏng thì tem vẫn in (không có logo) và báo "Logo không đọc được…" để chọn lại ảnh.

### Thay đổi vận hành và giới hạn đã biết

- Logo lưu thành PNG đen trắng nhỏ (cạnh dài 400 chấm, trần 40 000 ký tự) vì sổ chung giữ mọi lần lưu thông tin
  quán mãi mãi. Logo nhiều chi tiết quá trần thì app báo chọn ảnh đơn giản hơn.
- Cả bản ghi Thông tin cửa hàng là "ai lưu sau thắng": hai máy cùng sửa thì lần lưu sau đè lần trước. Gộp sổ lấy
  thông tin quán (kể cả logo) của sổ A.
- File sao lưu 2.10.0 mở bằng app 2.9.0 vẫn khôi phục được, chỉ mất logo.
- **Chưa in thử trên XP-365B thật** (ISSUE-013): độ đậm chấm thưa mới đo trên ảnh mô phỏng. Sau khi cài APK, in một
  đơn 3 phần ở cả ba mức và chế độ góc; máy rơi chấm hoặc in quá đậm thì có hướng chỉnh sẵn trong ISSUE-013.

## 2.9.0 — màn bán làm lại: chạm món có thực đơn là chọn ngay, đơn gom vào sheet, chip ghi chú; ô tiền có trần, đổi được tên máy, chặn tên món trùng (3/10/2026)

> Không đổi Worker, schema IndexedDB hay định dạng sao lưu: deploy theo thứ tự thường, máy chưa cập nhật vẫn đồng
> bộ bình thường với máy đã cập nhật. APK tăng versionCode để cài đè được.

### Người bán thấy gì

- **Đầu màn Bán:** khách và công tắc **Lẻ / SỈ** chung một hàng. Doanh thu "Hôm nay" không còn ở màn Bán — xem ở
  tab Đơn. Lưới món lên cao hơn.
- **Món có thực đơn riêng** (nhóm có tuỳ chọn hoặc topping cài ở Cài đặt › Nhóm mặt hàng): chạm là mở sheet chọn
  tuỳ chọn, topping, ghi chú, số lượng rồi bấm **THÊM · số tiền**. Đóng sheet mà không bấm THÊM thì món không vào
  đơn. Món của nhóm không có thực đơn riêng vẫn một chạm là vào đơn; ô món có thực đơn mang icon nhỏ. Cài thực đơn
  cho nhóm Đồ uống thì **mọi món trong nhóm** (kể cả Trà đá) đều mở sheet.
- **Đơn đang lên** gom vào sheet **Xem đơn** mở từ thanh đáy (số món, tổng, THU TIỀN). Sửa số lượng, Giảm giá /
  phụ thu nằm trong sheet này.
- **Sửa dòng:** cùng sheet với lúc thêm; số lượng ở trên cùng, đơn giá riêng nằm sau nút **Đổi giá**. Nút **Bỏ món**
  giờ có **Hoàn lại** như gõ 0.
- **Chip ghi chú:** các cụm ghi chú hay dùng gần đây (ngăn bằng dấu phẩy + khoảng trắng) hiện thành chip; chạm để
  thêm hoặc gỡ đúng cụm đó. Cụm trùng chữ một tuỳ chọn (như "Đá riêng" ghi ở bản cũ) và cụm dài hơn 24 ký tự không
  lên chip.
- **Ô tiền dừng ở 999.999.999 đ:** giá bán, phụ thu, tiền khách đưa gõ thừa số 0 thì ô giữ số cũ và báo "Tối đa
  999.999.999 đ." thay vì làm sập màn Bán.
- **Đổi được tên và chữ cái máy:** màn Máy bán hàng (chưa ghép) có nút "Đổi tên hoặc chữ cái" — dùng khi ghép báo
  trùng chữ cái. Trang đổi tên điền sẵn giá trị đang dùng.
- **Chặn tên món trùng** (không phân biệt hoa thường, tính cả món ngừng bán); sổ cũ đã có hai món cùng tên vẫn sửa
  được giá khi không đổi tên.

### Thay đổi vận hành và giới hạn đã biết

- Chip ghi chú đọc 300 dòng gần nhất của sổ máy đó, gồm cả dòng đồng bộ từ máy khác và dòng của đơn đã huỷ.
- Ghi chú gõ liền không khoảng trắng ("ít hành,mang về") được tính là một cụm — giá của việc giữ dấu phẩy thập
  phân ("thêm 1,5 lạng").
- Món đã lưu giá vượt trần từ trước vẫn giữ giá cũ; trần chỉ chặn ô nhập.
- Đã QA tay trên điện thoại thật (Galaxy S25 Ultra, Android 16, Chrome, 3/10): màn bán mới chạy đúng như mô tả.
  Lượt đó chạy trên sổ trống; trường hợp sổ có ghi chú từ trước 2.8.0 ("Đá riêng" trong ghi chú) mới kiểm trên
  Chrome giả lập điện thoại và Robot (gồm Robot hai máy trên staging).

## 2.8.0 — tem ghi chú dài in tiếp, lề trái rộng hơn; tuỳ chọn và topping có giá theo nhóm món (1/10/2026)

> **Deploy Worker TRƯỚC Pages/APK, và cập nhật mọi máy đã ghép trong cùng ngày.** Dòng đơn và nhóm món có
> thêm trường mới (không đổi schema IndexedDB, không di trú, không bump version Dexie). Zod bỏ khoá lạ
> trong im lặng: Worker còn chạy schema cũ mà máy mới đẩy `toppings` lên thì topping bị cắt khỏi sổ chung
> **vĩnh viễn**, kể cả khi máy gốc kéo lại từ đầu. APK tăng versionCode để cài đè được.

### Người bán thấy gì

- **Tem mới:** tên quán, mã đơn + giờ, một vạch kẻ ngang, tên món, rồi tuỳ chọn → topping (đậm, có dấu +) →
  ghi chú khách (nghiêng). Lề trái tem rộng thêm 2 mm (tổng 3,2 mm trên tem 50×30) cho khỏi sát mép giấy. Tên khách ở góc dưới trái đã bỏ; số thứ tự `i/n` góc dưới phải nhỏ hơn (font
  16×24 chấm, không còn phóng đôi trên tem cao từ 40 mm).
- **Ghi chú dài không còn bị cắt:** phần thừa sang tem kế, mỗi tem lặp đầu tem và tên món, có dấu phụ trang
  `tr 1/2`, `tr 2/2` ở góc dưới trái. Các tem của một ly đi liền nhau; số `i/n` đếm theo **ly**, nên các tem
  của một ly mang chung số. Nút và hộp xác nhận vẫn ghi "n tem" theo số ly; thông báo sau khi gửi nói rõ khi
  số tờ giấy nhiều hơn.
- **Tuỳ chọn và topping:** Cài đặt › Nhóm mặt hàng › mở một nhóm › **Tuỳ chọn & topping**. Nhóm tuỳ chọn
  (Đường: Ít đường, Không đường…) miễn phí, trong một nhóm chỉ chọn một; nhóm **Đá** (Đá chung / Đá riêng) có
  sẵn cho mọi món. Topping có giá (cộng thêm cho mỗi phần). Ở màn Bán hàng, sửa dòng món sẽ hiện các chip và
  nút −/+ topping của nhóm món đó. Chip đá trước đây ghi vào ô ghi chú, nay ghi vào tuỳ chọn.
- **Tiền:** thành tiền dòng = (giá ly + Σ giá topping × số phần) × số ly. `Giá ly` vẫn là giá danh mục, giá
  riêng, giá sỉ hoặc giá gõ tay; topping luôn cộng thêm. Topping mang giá **lúc bán** trên dòng, đổi giá
  thực đơn không đổi đơn cũ. Hai ly cùng món khác tuỳ chọn hoặc topping là hai dòng riêng. Số lượng lẻ (0,5)
  không thêm được topping mới; topping đã có trên dòng vẫn hiện và bớt được, tiền tính theo cùng công thức.
- Phiếu và chi tiết đơn liệt kê từng topping kèm giá một ly dưới tên món; Đ.GIÁ đã gồm topping nên
  SL × Đ.GIÁ ra T.tiền.

### Thay đổi vận hành và giới hạn đã biết

- Worker giữ lại thực đơn của nhóm khi một máy cũ đổi tên nhóm (bản ghi của máy cũ không có hai trường đó);
  máy mới cố ý xoá hết thực đơn vẫn được tôn trọng.
- Dòng đơn và nhóm món ghi trước bản này đọc ra mảng rỗng (hook đọc của Dexie), không cần di trú.
- File sao lưu cũ nhập vào bản này được; file sao lưu mới nhập vào app cũ sẽ rụng tuỳ chọn và topping (thành
  tiền vẫn đúng). `BACKUP_VERSION` giữ nguyên 4.
- Máy chưa cập nhật nhận đơn có topping sẽ không thấy phần topping (thành tiền vẫn đúng, nên dòng hiện như
  "2 × 20.000 = 66.000"). **Chỉ dẫn đá cũng mất trên máy đó:** chip đá giờ nằm ở tuỳ chọn chứ không còn trong
  ghi chú, nên phiếu và tem ở quầy pha chạy bản cũ sẽ không còn "Đá riêng" — cập nhật quầy pha trước.
  Máy cũ nhận đơn có topping trong lúc chưa cập nhật lưu dòng đó thiếu tuỳ chọn và topping **vĩnh viễn trên
  máy đó**, kể cả sau khi cập nhật; muốn phiếu và tem in lại đúng thì bấm Cài đặt › **Kéo lại từ đầu** một
  lần sau khi cập nhật; không làm thì không lệch tiền, chỉ phiếu và tem của các đơn nhận lúc còn bản cũ thiếu phần
  topping.
- **Thực đơn nhóm món:** đổi tên nhóm trên máy mà hàng nhóm chưa có thực đơn (ghi từ bản cũ) không còn ghi `[]` đè
  lên thực đơn của sổ chung — chỉ khi bạn mở "Tuỳ chọn & topping" và lưu thì hai trường mới được ghi. Thực đơn
  vẫn là last-write-wins: máy đang chậm (chưa kéo về thực đơn mới) mà bạn lưu lại thực đơn trên máy đó sẽ đè lên
  thực đơn vừa đặt ở máy khác. Nên cài thực đơn sau khi các máy đã cập nhật và đồng bộ.
- Báo cáo lãi tính giá vốn trên ly, không có giá vốn topping: lãi các đơn có topping **cao hơn thật**.
- Đã in thử trên XP-365B thật (1/10): tem in được, lề trái 3,2 mm hết sát mép giấy. Chưa ghi nhận lần thử riêng cho ca ghi chú rất dài ra nhiều tem trên máy thật; phép chia trang đo trên Chrome.

## 2.7.1 — rollback trả đúng đơn giá, hàng in chung theo máy in, job in treo không kẹt cả hàng (1/10/2026)

> Không đổi schema IndexedDB, không di trú, không đổi Worker. APK tăng versionCode 3 → 4 để cài đè được;
> sửa ở plugin in TCP chỉ tới máy khi cài APK mới.

### Người bán thấy gì

- **Sửa lỗi sổ (#28):** thao tác bị máy chủ từ chối được hoàn lại đúng giá cũ cả khi hai lần sửa giá sát
  nhau; trước đây giá có thể kẹt ở giá bị từ chối.
- **In phiếu, IN THỬ, in tem và job nhận qua Bluetooth tới cùng một máy in giờ xếp hàng,** không còn mở hai
  nối cùng lúc làm một bản báo "In hỏng". Máy in phiếu và máy in tem vẫn in song song.
- **Máy in ngừng nhận giữa job** (hết tem, sai khe hở) thì sau một lúc app báo "Máy in ngừng nhận giữa chừng
  — kiểm tra giấy/tem, khe hở rồi in lại" thay vì nút kẹt mãi; job cũ bị cắt hẳn nên in lại không ra thêm
  phần thừa (cần APK 2.7.1).
- **Job Bluetooth dừng giữa một lệnh quá 10 giây** thì nhật ký báo "Job dừng giữa chừng một lệnh", job sau
  in bình thường.

### Chưa nghiệm trên máy thật

- Hạn ghi của plugin (máy tem kẹt giữa job dài) mới chứng bằng JUnit; cần thử trên XP-365B (ISSUE-009 d).

## 2.7.0 — in tem theo số lượng, mỗi tem ghi tên món (máy in tem XPrinter XP-365B qua LAN) (26/9/2026)

> Chỉ frontend. Không đổi schema IndexedDB, không di trú, không đụng Worker hay đồng bộ: cấu hình máy
> tem nằm ở localStorage của từng máy như máy in phiếu. APK tăng versionCode 2 → 3 để cài đè được.

### Người bán thấy gì

- **Màn phiếu (trong APK) có thêm nút 🏷 IN TEM (n tem).** n là tổng số lượng của đơn, số lượng lẻ làm
  tròn lên từng dòng. Bấm mở hộp xác nhận ghi rõ số tem, khổ tem và IP máy tem. Đơn huỷ không có nút.
- **Cài đặt có thêm mục MÁY IN TEM:** IP, cổng, rộng × cao tem và khe hở (mm), mặc định 50×30 khe 2 (khổ cuộn tem của quán).
  Máy tem là máy riêng, khác máy in phiếu.
- Mỗi tem là một phần của một món: in **tên món** (to nhất), ghi chú của món nếu có, tên quán, mã đơn,
  giờ bán, tên khách và số thứ tự `i/n` của cả đơn ở góc dưới phải. Đơn Choco Mint ×3 + Matcha ×4 ra 3 tem
  Choco Mint rồi 4 tem Matcha.

### Đã in thật

- 26/9 in đúng trên XP-365B (tem 50×30 khe 2, đúng chiều, có tên món và ghi chú) ở điện thoại chủ quán
  và máy nhân viên. Chưa thử máy kẹt giữa một job dài — lệnh ghi socket trong plugin không có timeout
  (ISSUE-009).

## 2.6.0 — APK nhận in qua Bluetooth, in lại ra máy in nhiệt (26/9/2026)

> Không đổi schema IndexedDB (vẫn v5), không di trú, không đụng Worker. Tính năng chỉ có trong APK; bản
> web/PWA chỉ thêm một mục Cài đặt bị khoá kèm ghi chú. APK tăng versionCode 1 → 2 để cài đè được.

### Người bán thấy gì

- **Cài đặt có thêm mục NHẬN IN QUA BLUETOOTH.** Trong APK: nút BẬT/TẮT NHẬN IN, dòng trạng thái (tên
  Bluetooth của máy, máy gửi đang nối), danh sách 20 phiếu đã nhận gần nhất kèm ảnh xem trước, trạng thái
  (Đã in / In hỏng + lý do) và nút IN LẠI (hỏi xác nhận). Trên web nút khoá.
- **Phiếu nhận qua Bluetooth tự in ngay** ra máy in nhiệt đã cài IP ở mục MÁY IN, dù đang ở màn nào.
  Không ghi gì vào sổ.

### Vì sao cần

- Để máy/script khác của quán gửi phiếu như gửi tới một máy in Bluetooth, mà phiếu vẫn ra máy in nhiệt
  LAN với chữ tiếng Việt đúng (chữ được dựng lại thành ảnh, như phiếu của app). Giao thức người gửi ở
  [`huong-dan-noi-may-in-nhiet.html`](huong-dan-noi-may-in-nhiet.html) mục 8.

## 2.5.1 — phóng to dòng tổng tiền trên phiếu (15/9/2026)

> Chỉ đổi cỡ chữ trên phiếu, không đổi schema (vẫn v5), không di trú, không đụng Worker. Con số tiền và
> mọi hành vi khác giữ nguyên.

### Người bán thấy gì

- **Dòng tổng tiền trên phiếu to hơn.** Tổng cộng, Còn nợ — và trên phiếu có nợ cũ là TỔNG PHẢI TRẢ,
  NỢ CŨ CÒN LẠI — đổi từ 13px lên 15px cho dễ đọc, theo yêu cầu của chủ quán sau khi xem phiếu in thật.

### Vì sao cần

- Chủ quán gửi ảnh phiếu, kêu dòng tổng tiền nhỏ khó đọc. Phần "in ra nhạt" là mật độ in của máy SPR02
  (chỉnh trên máy), không sửa ở app — chữ trên phiếu vốn đã in full mực.

## 2.5.0 — in máy in nhiệt: PWA qua RawBT, APK Android nối thẳng IP:9100 (9/9/2026)

> Không đổi schema IndexedDB (vẫn v5), không có bước di trú, không cần deploy Worker: thay đổi chỉ nằm
> ở frontend và ở một hình thái cài đặt mới (APK). Hành vi bán hàng/đồng bộ hiện có giữ nguyên.

### Người bán thấy gì

- **Màn phiếu có thêm nút 🖨 IN MÁY IN NHIỆT.** Bấm mở hộp xác nhận (In/Huỷ) trước khi gửi, tránh in
  nhầm tốn giấy. 📤 CHIA SẺ QUA ZALO vẫn còn nguyên như cũ.
- **Cài đặt có thêm mục MÁY IN.** Trên web/PWA Android là khối IN QUA RAWBT (cài app RawBT, IP máy in
  cấu hình trong RawBT, IN THỬ QUA RAWBT). Trên APK là ô nhập Địa chỉ IP + Cổng của máy in, nút LƯU và
  IN THỬ.
- **Kênh mới: APK Android cài tay.** Đây là một hình thái cài đặt song song với web/PWA hiện có, không
  qua Play, do người quản trị dựng và gửi file — chỉ bản này mới nối thẳng TCP tới máy in mà không cần
  app trung gian. Hướng dẫn nối máy và chọn đường in ở
  [`docs/huong-dan-noi-may-in-nhiet.html`](huong-dan-noi-may-in-nhiet.html).

### Vì sao cần

- Máy in nhiệt SAPO SPR02 của quán (80mm, LAN, RAW cổng 9100, có dao cắt) trước đây chỉ nhận lệnh in từ
  app Sapo. Hai đường mới cho phép in phiếu của app tính tiền thẳng ra cùng máy đó, không cần đổi thiết
  bị hay chuyển máy in.

### Thay đổi vận hành

- Không đụng `shared/ledger-schemas.ts` hay `worker/` — toàn bộ nằm ở `src/domain/escpos`,
  `src/features/printer` và vỏ Capacitor Android (`android/`, ngoài phạm vi build web/Pages). Xem
  [`docs/tech-stack.md`](tech-stack.md) mục kiến trúc và
  [`docs/deploy.md`](deploy.md#dựng-apk-android-capacitor) để dựng/ký APK.
- **Đường APK/TCP đã nghiệm trên máy in SPR02 thật:** in tờ mẫu, in bill đúng nội dung và tiền, đường
  lỗi (máy tắt/sai IP) báo trong vài giây, giấy tự cắt sau khi in.
- **Đường RawBT mới verify phần mềm, chưa gửi tới máy in thật lần nào** — Robot/e2e xác nhận URL
  `rawbt:` dựng đúng, giải mã ra đúng ảnh 576 chấm, và chốt giới hạn kích thước URL cho phiếu dài; còn
  RawBT có tự cắt giấy, có resample ảnh, phiếu rất dài có gửi trọn được không, và tốn thêm mấy chạm ở
  bản miễn phí thì chưa đo được trên phần cứng. Rủi ro đã được chấp nhận có ý thức; tài liệu nối máy in
  sẽ cập nhật lại sau khi đo tại quán.
- Robot: `phieu.robot` chỉ đọc href của anchor `a[data-rawbt]` bằng `Get Attribute`, không bao giờ
  `Click` (CI không có RawBT để xử lý link). Đường APK/TCP không có ca Robot vì Robot không lái được mã
  native — cổng là biên bản đo trên máy thật, xem [`docs/kiem-thu-live.md`](kiem-thu-live.md).

## 2.4.0 — màn Đối soát xem tổng thể sổ chung (5/9/2026)

> Không đổi schema IndexedDB (vẫn v5), không có bước di trú. **Bắt buộc deploy Worker
> trước Pages**: `GET /shop/:id/devices` trả thêm `latestSeq`, màn Đối soát dựa vào số
> đó. Workflow tag `v*.*.*` đã đi đúng thứ tự Worker → smoke → Pages trong một job; chỉ
> deploy tay mới có nguy cơ sai thứ tự. Nếu Pages lên trước Worker, màn Đối soát hiện
> "Sổ chung chưa hỗ trợ đối soát — cần cập nhật máy chủ." — bán hàng và đồng bộ vẫn
> chạy bình thường, deploy Worker xong là tự hết, không phải làm gì trên máy. Nếu 2.3.1
> chưa lên production thì bản này kèm luôn sửa lỗi kẹt ở 500 sự kiện (mục 2.3.1).

### Người bán thấy gì

- **Cài đặt có mục ĐỐI SOÁT.** Dòng đầu nói máy này đứng ở đâu so với sổ chung, đúng
  một câu: "✓ Khớp sổ chung — máy này ở thay đổi #N", "Còn N thay đổi chưa về máy
  này", "N thay đổi trên máy này chưa lên sổ chung.", "Máy này chưa ghép sổ chung.",
  "Chưa đọc được sổ chung — số dưới đây là bản trên máy này."… kèm mốc "đối chiếu lúc
  HH:mm" và nút KIỂM TRA LẠI. Bên dưới là bốn tổng
  toàn sổ (Doanh thu, Đã thu, Chi phí, Còn nợ) và số dòng của 9 bảng sổ (Đơn tính cả
  đơn đã huỷ).
- **Để so hai máy:** mở màn này trên cả hai lúc đều có mạng, đợi cả hai hiện "✓ Khớp
  sổ chung" **với cùng số #**, rồi so bốn tổng. Cùng # mà lệch tổng là có chuyện.
- Máy chưa ghép vẫn xem được bốn tổng và số dòng của sổ cục bộ. Mất mạng (hoặc không đọc được
  sổ chung) thì câu neo vẫn kèm số thay đổi chưa lên sổ chung — đó là lúc hàng đợi dài nhất.

### Vì sao cần

- Hai máy dùng chung một sổ nhưng chủ quán không có cách nào biết máy này đã đuổi kịp
  sổ chung chưa, ngoài so tay Báo cáo từng kỳ trên hai máy. Một con số neo và bốn
  tổng toàn sổ trả lời câu đó trong mười giây.
- Đo màn này trên sổ 12.027 sự kiện đã lộ lỗi kẹt ở 500 sự kiện (2.3.1).

### Thay đổi vận hành

- Worker: `GET /shop/:id/devices` trả thêm `latestSeq` = `MAX(seq)` của oplog (một lần
  seek trên chỉ mục, không quét). Smoke production kiểm trường này là số trước khi
  deploy Pages, để Worker cũ + Pages mới không lọt qua cổng.
- Máy: đọc `latestSeq` lúc mở màn và khi bấm KIỂM TRA LẠI (hết hạn 8 giây, khoá nút 2
  giây); sổ chung mới hơn máy thì tự hỏi lại một lần cho mỗi `lastSeq` mới rồi mới bảo
  bấm tay. Tổng và số dòng đọc đúng 9 bảng sổ trong một transaction, không chạm
  `outbox`/`deviceState`, nên không kích lại theo nhịp lease.
- Hiệu năng đo trên Chrome + wrangler dev, sổ 2002 đơn / 4004 dòng / 2002 phiếu thu
  (12.027 sự kiện, 25 trang): một lượt tính tổng 8–16 ms (36 ms lần đầu sau tải
  trang); kéo lại toàn sổ khi đang mở màn 26 lượt tính lại, trung bình 7–8 ms, tối đa
  19 ms, tổng 3,5–3,7 giây so với 3,9–4,2 giây khi không mở màn.
- Kèm hai sửa trùng nội dung 2.3.1 (gateway giữ `?since`, chốt `pullAll`) để nhánh
  này tự chạy được trên sổ lớn; merge sau 2.3.1 thì không có gì mới.
- Robot: suite `doi-soat.robot` (bốn tổng khớp Báo cáo và Công nợ; phiếu đã trả lại
  khách không cộng vào Đã thu, đối chiếu thẳng bảng `payments`); `hai-may.robot` thêm
  ca hai máy cùng hiện "✓ Khớp" với cùng số # và cùng bốn tổng, và ca máy mất mạng vẫn thấy hàng
  đợi của mình (18 ca). `Đọc Ô Số`,
  `Mở Chi Tiết Đơn Mới Nhất` chuyển lên `app.resource` để các suite dùng chung.
- Không có ca Robot, chỉ có Vitest, cho: nhánh "Còn N thay đổi chưa về máy này" (sau
  tải trang cứng, lease cũ chặn tick tới 15 giây nên kết quả phụ thuộc thời điểm
  đọc); nhánh Worker cũ không có `latestSeq` (Robot không dựng được Worker cũ); dòng
  kiểm `latestSeq` trong smoke (chỉ chạy với secret production).

## 2.3.1 — đồng bộ không còn kẹt khi sổ chung chạm 500 sự kiện (5/9/2026)

> Không đổi schema IndexedDB (vẫn v5), không có bước di trú. **Bắt buộc deploy Worker** (workflow
> production đã làm Worker → smoke → Pages trong cùng một job). Máy đang kẹt tự hồi phục ở lượt kéo
> kế tiếp sau khi Worker mới lên; chủ quán không phải làm gì ngoài để app mở.

### Người bán thấy gì

- Máy đã ghép sổ chung từng treo băng "Đang đưa N thay đổi lên sổ chung…" mãi không tắt một khi sổ
  chung có từ 500 thay đổi trở lên — đơn bán ra không lên sổ chung nữa, máy kia không thấy. Sau bản
  này băng tắt và đơn lên sổ chung như thường.

### Vì sao cần

- Cổng Worker dựng URL nội bộ chỉ từ đường dẫn, làm rơi `?since=N` khi chuyển tiếp tới Durable
  Object. Sổ chung vì thế luôn trả trang đầu (seq 1..500) kèm "còn nữa"; máy kéo mãi cùng một trang
  (đo được ~75 lượt/giây) và không bao giờ tới bước đưa hàng đợi lên. Lỗi có từ bản đồng bộ đầu
  tiên (2.0.1); mọi test Worker chỉ hỏi `since=0` nên không thấy.
- Lộ ra khi đo màn Đối soát (đang làm) trên sổ 12.027 sự kiện: máy dừng ở #500 dù sổ chung ở #12027.

### Thay đổi vận hành

- Máy có thêm chốt phòng thủ ở `pullAll`: sổ chung báo "còn nữa" mà trang vừa nhận không làm `lastSeq`
  tiến thì dừng lượt kéo cho tick sau thử lại — lỗi máy chủ kiểu này không còn biến thành vòng lặp nóng.
  Hàng đợi cố ý đứng chờ tới khi sổ chung trả trang đúng (băng "Đang đưa N thay đổi lên sổ chung…" vẫn
  hiện), vì đẩy vào một sổ chung đang trả sai có thể bị từ chối và cuộn ngược dòng cục bộ.
- Không có ca Robot cho hai sửa này: cần sổ từ 500 sự kiện, bộ mẫu hai máy chưa tới. Ca Worker mới đi
  đúng đường qua cổng (`since=N` phải trả đúng phần sau N); ca Vitest cho `pullAll` khoá chốt phòng thủ.

## 2.3.0 — nút kiểm tra bản mới trong Cài đặt (4/9/2026)

> Không đổi schema IndexedDB (vẫn v5), không có bước di trú, không cần deploy
> Worker: chỉ frontend. Quay về 2.2.0 không có hiểm gì thêm.

### Người bán thấy gì

- **Cài đặt có mục CẬP NHẬT APP với nút KIỂM TRA BẢN MỚI.** Bấm là app đi hỏi
  server ngay. Có bản mới thì tải về nền rồi nút đổi thành TẢI LẠI NGAY, bấm lần
  nữa mới tải lại; không có gì mới thì báo "Đang dùng bản mới nhất." Mất mạng thì
  báo lỗi và cho bấm lại. Chờ quá 20 giây mà chưa xong cũng báo và mở nút lại,
  không để nút khoá. Rời màn Cài đặt là thôi chờ, không tải lại giữa lúc lên đơn.

### Vì sao cần

- Sau 2.2.0 chủ quán báo "không thấy nút Tải lại". Đo trên Chrome thật với hai
  bản build khác nhau: trình duyệt chỉ kiểm `sw.js` lúc app được **mở mới**; app
  để chạy nền rồi bật lên lại thì 60 giây sau khi server đổi bản vẫn không tải
  `sw.js` — thanh "Có bản mới" không bao giờ có cơ hội hiện. Gọi
  `registration.update()` bằng tay thì thanh hiện ngay; nút mới chính là cú gọi đó.
- Đóng hẳn app rồi mở lại vẫn là cách thứ hai, ghi ở `docs/deploy.md` mục 5.

### Thay đổi vận hành

- CI bước "Build staging" nay ghi ra `dist-next` thay vì `dist`, để làm "bản mới"
  cho ca Playwright `e2e-recovery/app-update.spec.ts` (server artifact có thêm
  mode `next`). Thời gian CI không đổi. `npm run build:staging` cho quy trình
  staging tay vẫn ghi ra `dist/` như cũ.
- Robot chỉ lái tới được trạng thái "chưa có chế độ offline" của nút, vì dev
  server không sinh service worker. Đường có bản mới thật do Playwright artifact
  chốt chặn.
- Suite Robot Báo cáo có sẵn một lỗi chờ: đọc số ngay sau khi bấm chip kỳ, trong
  khi con số còn là của kỳ mặc định "Tháng". Mùng 1 hai số trùng nhau nên CI xanh,
  từ mùng 2 thì đỏ hai ca. Sửa keyword `Mở Báo Cáo Kỳ` chờ nhãn kỳ mới trước khi
  đọc; không đụng mã app.

## 2.2.0 — phiếu đọc được trên máy in nhiệt, đá chung/đá riêng theo ly (1/9/2026)

> Không đổi schema IndexedDB (vẫn v5) và không có bước di trú. Khác 2.1.0, bản
> này **không** bắt buộc deploy Worker trước Pages: thay đổi chỉ nằm ở frontend,
> `shared/ledger-schemas.ts` và `worker/` không đụng tới dòng nào.

### Người bán thấy gì

- **Phiếu in ra đọc được trên giấy nhiệt.** Bỏ hết chữ xám và viền xám khỏi
  phiếu. Đầu in nhiệt chỉ có hai mức mực, nên nó *dither* màu xám `#5a6673`
  thành lấm tấm chấm thưa — trên màn hình là "chữ nhạt", trên giấy là chữ mờ
  không đọc nổi. Kèm theo: hạ bộ cỡ chữ, và rút đầu cột `Đơn giá` thành `Đ.GIÁ`
  để tên món dài bớt bị đẩy vỡ dòng.
- **Ghi chú từng món in ra phiếu**, đứng riêng một dòng dưới tên món, ở cả phiếu
  ảnh PNG lẫn bản chữ gửi Zalo. Trước đây ghi chú lưu xuống sổ (từ 2.1.0) nhưng
  không xuất hiện trên phiếu, nên bếp không đọc được.
- **Đánh dấu Đá chung / Đá riêng theo từng ly.** Cùng một món, cùng một giá,
  khác ghi chú thì nay là hai dòng giỏ riêng: 3 ly Đá chung và 2 ly Đá riêng
  không còn bị gộp thành một dòng 5 ly. Sửa ghi chú cho trùng nhau thì hai dòng
  gộp lại và cộng đúng số lượng.
- **Bấm In ra đúng khổ giấy.** Trước đây `window.print()` trải phiếu rộng theo
  màn hình nên chữ in ra to hơn phiếu ảnh và vỡ dòng ở chỗ khác; nay hai đường
  dùng chung một bố cục.

### Thay đổi vận hành

- `@page` khai `size: 80mm 350mm`. Con số 350mm không phải trần đoán mà là số đo:
  Chromium ngắt trang theo hộp **bố cục**, không theo phần đã `scale`, nên một
  trần ngắn hơn làm hai tấm phiếu đẻ ra ba trang PDF, tức một trang trắng chen
  vào giữa. Đổi lại, mỗi lần bấm In tốn tới 35cm giấy. Bằng chứng hiện có cho
  thấy chủ quán in qua **đường ảnh** chứ không qua `window.print()`, nên đây là
  đường phụ; nếu sau này chuyển sang in trực tiếp thì phải đo lại.
- **Nếu phải quay về 2.1.0: dặn người bán chốt hoặc xoá giỏ đang lên dở trước.**
  Từ 2.2.0 khoá dòng giỏ có thêm ghi chú ở cuối, nên hai dòng "Đá chung" và "Đá
  riêng" của cùng một món cùng một giá là hai khoá khác nhau. Bản 2.1.0 tính khoá
  **không** có ghi chú, nên khi nó nạp lại nháp do 2.2.0 ghi thì hai dòng đó đụng
  chung một khoá, và từ đó `+`/`−` hay xoá dòng sẽ tác động **cả hai cùng lúc**.
  Nháp rỗng thì không có chuyện này. Đây là hiểm của đường quay ngược, không phải
  của đường cập nhật: chiều 2.1.0 → 2.2.0 an toàn vì khoá được tính lại lúc nạp và
  hai dòng vốn khác khoá thì sau khi thêm ghi chú vẫn khác khoá.

- **Chưa có xác nhận trên giấy nhiệt thật.** Máy in không có ở chỗ dev. Mọi tiêu
  chí đều đo được bằng máy — bề ngang bản in đo sau `transform`, khổ giấy đo bằng
  cách parse `/MediaBox` từ PDF thật, số dòng vỡ đo bằng `Range.getClientRects()`
  — nhưng độ đậm mực trên giấy thì chỉ mắt người trước tờ giấy mới kết luận được.
  Chủ quán in thử và xác nhận sau khi bản này lên.

## 2.1.0 — số lượng, nợ luỹ kế trên phiếu, ghi chú từng món (1/9/2026)

> Không đổi schema IndexedDB (vẫn v5) và không có bước di trú. Người bán cập nhật
> xong dùng ngay, sổ cũ giữ nguyên.

### Người bán thấy gì

- **Gõ thẳng số lượng vào giỏ.** Trước chỉ bấm `+`/`−` từng nấc; giờ nhập được
  số vào ô số lượng của từng dòng.
- **Phiếu gộp nợ cũ thành một bill** có dòng `TỔNG PHẢI TRẢ`. Khi đơn này khách
  đã trả đủ mà vẫn còn nợ cũ, phiếu in **một dòng** `NỢ CŨ CÒN LẠI` thay vì hai
  dòng trùng số đọc như lỗi in.
- **Ghi chú từng món được lưu xuống sổ** và đi qua sổ chung tới máy kia, thay vì
  chỉ nằm trên màn hình lúc bán.
- Sửa vài đường làm **mất dòng trong giỏ mà không báo gì**, đường bấm nhầm
  *Hoàn lại*, và đường mất dòng ở ô tìm món.

### Thay đổi vận hành

- `OrderLineSchema` trong `shared/ledger-schemas.ts` thêm trường `note` với
  `.default('')`. Cộng thêm nên file sao lưu cũ vẫn nhập lại được và event từ máy
  chưa cập nhật vẫn đi qua.
- **Worker phải deploy trước Pages.** Worker dùng chính `OrderLineSchema` để nhận
  event rồi thay payload bằng bản đã parse, nên Worker bản cũ sẽ **cắt mất ghi
  chú** trước khi ghi vào sổ chung: máy A giữ ghi chú cục bộ, máy B không bao giờ
  thấy, và không lỗi nào hiện ra. Workflow phát hành đã deploy Worker trước Pages.

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
