# Kiểm thử live bằng Robot Framework

Bộ này lái **app thật trên Chrome thật**: bấm nút thật, tải file thật, đọc thẳng IndexedDB thật.
Nó không thay Vitest hay Playwright mà bổ sung một lớp đọc được cho người không đọc code —
mỗi ca là một câu tiếng Việt mô tả hành vi, và kết quả ra file HTML xem được ngoài trình duyệt.

| Lớp | Chạy bằng | Trả lời câu hỏi |
| --- | --- | --- |
| `npm test` | Vitest + jsdom + fake-indexeddb | Hàm và component có đúng không |
| `npm run test:e2e` | Playwright, cổng 5174 | Luồng chính có chạy trên Chrome không |
| `npm run test:live` | Robot Framework, cổng 5175 | Từng tính năng có làm đúng việc của nó không |

## Chạy

```bash
npm run test:live                              # cả 113 ca
./robot/run.sh robot/tests/ban-hang.robot      # một màn
./robot/run.sh -i regression robot/tests       # chỉ các ca chốt chặn hồi quy
./robot/run.sh --variable HEADLESS:False robot/tests/ban-hang.robot   # xem tận mắt
```

`run.sh` tự dựng dev server ở cổng 5175 rồi tự tắt khi xong. Cổng 5173 để dành cho người đang
code, 5174 cho Playwright — ba thứ chạy song song không giẫm chân nhau. Nếu cổng 5175 đã có
server đang phục vụ, script dùng lại và **không** tắt nó khi xong.

Kết quả nằm ở `robot/results/report.html` (tóm tắt) và `robot/results/log.html` (từng bước, kèm
ảnh chụp lúc lỗi).

## Cài lần đầu

```bash
python3 -m venv .venv-robot
.venv-robot/bin/pip install robotframework robotframework-browser
.venv-robot/bin/rfbrowser init
npx playwright install chrome
```

## Vì sao phải chạy trên bản `vite` dev, không phải bản build

Mọi test lấy dữ liệu ban đầu từ nút **"Nạp dữ liệu mẫu"** ở màn Thêm — nút đó chỉ hiện ở chế độ
dev. Bộ mẫu là điểm xuất phát cố định của mọi ca:

- 4 mặt hàng: Phở bò đặc biệt 55.000 · Cơm tấm sườn 45.000 · Trà đá 3.000 · Cà phê sữa 20.000
- 1 khách: Anh Hùng
- 2 đơn: hôm qua 116.000 (thu đủ) · hôm nay 150.000 (thu trước 50.000, còn nợ 100.000)
- 1 khoản chi hôm qua: 1.200.000

## Cách bộ test tự cô lập

Mỗi ca chạy trong một `New Context` riêng của Playwright — đó là một hồ sơ trình duyệt trắng,
nên IndexedDB rỗng và không ca nào ăn dữ liệu của ca khác. Không cần dọn dẹp thủ công, và các
ca chạy được theo bất kỳ thứ tự nào.

## Cấu trúc

```
robot/
├── run.sh                    dựng dev server, chạy, dọn
├── resources/
│   ├── app.resource          vòng đời trình duyệt, phiên sạch, nạp mẫu, đọc IndexedDB
│   └── sales.resource        thao tác màn Bán hàng, dùng lại ở nhiều suite
└── tests/
    ├── ban-hang.robot        18 ca · giỏ hàng, thu tiền, bán nợ, nháp giỏ
    ├── don-hang.robot        12 ca · danh sách đơn, ghi chú, huỷ đơn
    ├── mat-hang.robot        13 ca · danh mục, ngừng bán, chặn xoá món đã bán
    ├── khach-hang.robot      13 ca · khách, công nợ có chủ, thêm khách lúc bán
    ├── chi-phi.robot         11 ca · ghi/sửa/xoá khoản chi, hai ô tổng
    ├── cong-no.robot         10 ca · thu nợ, chặn thu dư, phiếu thu ra đúng dòng
    ├── bao-cao.robot         12 ca · lãi/lỗ, các kỳ, khoảng ngày tự chọn
    ├── phieu.robot           12 ca · nội dung phiếu, chia trang, dựng ảnh PNG
    └── sao-luu.robot         12 ca · sao lưu, nhập lại, xoá sạch (tải file thật)
```

## Viết thêm ca mới

Bám nhãn, đừng bám id. `TextField`/`MoneyInput` sinh id bằng `useId()` nên id đổi mỗi lần render —
`Điền Ô` và `Đọc Ô` trong `app.resource` đã tìm ô theo nhãn hiển thị.

Dùng `Chờ Thấy Chữ` thay vì `:has-text`. Bộ chọn `:has-text` khớp cả tổ tiên lên tới `<html>` nên
Playwright báo vi phạm strict mode; `Chờ Thấy Chữ` dùng bộ `text=` vốn khớp phần tử nhỏ nhất.

Nút trong hộp xác nhận thường trùng chữ với nút đã mở ra chính nó ("Huỷ đơn", "Xoá") — luôn dùng
`Xác Nhận Trong Hộp` / `Bỏ Qua Hộp Xác Nhận` để thu vào trong `[role=alertdialog]` rồi mới bấm.

Giao diện hiện đúng mà sổ ghi sai là kiểu hỏng tệ nhất, nên ca nào dính tới tiền thì đối chiếu
thêm bằng `Đọc Bảng` (đọc thẳng IndexedDB) chứ đừng chỉ tin con số trên màn hình.

### Ba cái bẫy đã cắn, đừng dẫm lại

**Chờ theo DOM sau khi app tự điều hướng là chờ hụt.** React tháo component ngay khi router đổi
state, nhưng trình duyệt commit cú lùi lịch sử chậm hơn — đi tiếp lúc đó sẽ cắt ngang và lệnh
điều hướng kế tiếp chết với `ERR_ABORTED`. Chờ theo URL: `Wait For Condition Url == ...`.

**`window.location.reload()` cũng vậy, mà còn khó thấy hơn** vì nút của trang cũ vẫn đang hiện.
Cách chắc chắn: đặt một dấu mốc lên `window` trước khi bấm rồi chờ dấu đó biến mất — xem
`Chờ Nạp Lại Xong` trong `sao-luu.robot`.

**Màn Phiếu nằm ngoài `AppLayout` nên không có bottom nav.** Bán xong là đang đứng ở phiếu; muốn
bấm tab thì phải về một màn có nav trước.
