# Kiểm thử live bằng Robot Framework

Bộ này lái **app thật trên Chrome thật**: bấm nút thật, tải file thật, đọc thẳng IndexedDB thật.
Nó không thay Vitest hay Playwright mà bổ sung một lớp đọc được cho người không đọc code —
mỗi ca là một câu tiếng Việt mô tả hành vi, và kết quả ra file HTML xem được ngoài trình duyệt.
Hiện bộ live có 9 suite, tổng cộng 130 ca.

| Lớp | Chạy bằng | Trả lời câu hỏi |
| --- | --- | --- |
| `npm test` | Vitest + jsdom + fake-indexeddb | Hàm và component có đúng không |
| `npm run test:e2e` | Playwright, cổng 5174 | Luồng chính có chạy trên Chrome không |
| `npm run test:live` | Robot Framework, cổng 5175 | Từng tính năng có làm đúng việc của nó không |

## Cài lần đầu

Sau khi cài dependency JavaScript, dùng installer của repo:

```bash
npm ci
./robot/install.sh
```

[`robot/install.sh`](../robot/install.sh) tạo môi trường Python riêng, cài các dependency trực tiếp đã
pin trong [`robot/requirements.txt`](../robot/requirements.txt), khởi tạo Robot Framework Browser và
cài Chrome. Trên Ubuntu CI, workflow dùng `./robot/install.sh --with-deps` để cài thêm dependency hệ
điều hành; đó là biến thể dành cho runner Ubuntu, không phải lệnh setup local trên macOS.

## Chạy

```bash
npm run test:live                              # cả 130 ca
npm run test:regression                        # chỉ các ca chốt chặn hồi quy — vòng nhanh lúc đang sửa
./robot/run.sh robot/tests/ban-hang.robot      # một màn
./robot/run.sh --variable HEADLESS:False robot/tests/ban-hang.robot   # xem tận mắt
```

`run.sh` tự dựng dev server ở cổng 5175. Cổng 5173 để dành cho người đang code, 5174 cho
Playwright — ba thứ chạy song song không giẫm chân nhau.

Runner chỉ dùng lại listener có thư mục làm việc là đúng worktree vật lý hiện tại **và** trả về đúng
thẻ title của app `my-biller — Bán hàng`. Listener lạ, cũ hoặc thuộc worktree khác làm runner dừng
ngay (fail-closed) với thông báo quyền sở hữu rõ ràng; script không bao giờ tự dừng listener đó, chủ
tiến trình phải xử lý. Nếu runner tự dựng Vite, lúc kết thúc nó chỉ dừng đúng PID Vite trực tiếp do
lượt chạy đó tạo.

Kết quả nằm ở `robot/results/report.html` (tóm tắt) và `robot/results/log.html` (từng bước, kèm
ảnh chụp lúc lỗi). Nếu dev server không lên, xem `robot/results/vite.log`.

## Trên GitHub Actions

Workflow [`kiem-thu.yml`](../.github/workflows/kiem-thu.yml) chạy hai job độc lập trên mọi pull request
và mọi push vào `main`. Gate code hiện có vẫn nằm riêng trong `Code quality and Playwright`; job
`Robot live` chạy toàn bộ `npm run test:live` không lọc suite/tag và có timeout 15 phút.

Khi cùng một pull request hoặc ref có lượt mới, lượt cũ đang chạy bị huỷ. Nếu `Robot live` thất bại,
workflow tải `robot/results/` lên artifact `robot-live-results` và giữ 7 ngày. Branch protection của
`main` hiện yêu cầu cả `Code quality and Playwright` lẫn `Robot live`; check pending hoặc fail đều chặn
merge, kể cả với owner/admin. Workflow tạo ra các check, còn branch protection mới là lớp enforce.

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
├── requirements.txt          dependency Python trực tiếp đã pin
├── install.sh                setup local và biến thể Ubuntu CI
├── run.sh                    xác minh cổng, dựng Vite, chạy, dọn đúng PID
├── resources/
│   ├── app.resource          vòng đời trình duyệt, phiên sạch, nạp mẫu, đọc IndexedDB
│   └── sales.resource        thao tác màn Bán hàng, dùng lại ở nhiều suite
├── tests/
│   ├── ban-hang.robot        29 ca · giỏ hàng, thu tiền, bán nợ, nháp giỏ, công tắc Lẻ/SỈ
│   ├── don-hang.robot        12 ca · danh sách đơn, ghi chú, huỷ đơn
│   ├── mat-hang.robot        13 ca · danh mục, ngừng bán, chặn xoá món đã bán
│   ├── khach-hang.robot      19 ca · khách, công nợ có chủ, thêm khách lúc bán, bảng giá sỉ
│   ├── chi-phi.robot         11 ca · ghi/sửa/xoá khoản chi, hai ô tổng
│   ├── cong-no.robot         10 ca · thu nợ, chặn thu dư, phiếu thu ra đúng dòng
│   ├── bao-cao.robot         12 ca · lãi/lỗ, các kỳ, khoảng ngày tự chọn
│   ├── phieu.robot           12 ca · nội dung phiếu, chia trang, dựng ảnh PNG
│   └── sao-luu.robot         12 ca · sao lưu, nhập lại, xoá sạch (tải file thật)
└── results/
    ├── output.xml            kết quả máy đọc
    ├── report.html           tóm tắt
    ├── log.html              từng bước và ảnh lỗi
    └── vite.log              log dev server do runner dựng
```

## Viết thêm ca mới

> **Quy ước bắt buộc của repo:** thêm hoặc sửa một tính năng / một hàm là **phải** có ca ở đây ngay
> trong lần làm đó, rồi chạy lại hồi quy. Điều kiện đầy đủ ở [`CLAUDE.md`](../CLAUDE.md).

### Mẫu ca mới

Ca mới nằm trong suite của **màn mà người bán chạm vào**, không mở file mới cho mỗi thay đổi. Nếu tính
năng thật sự sinh ra một màn mới thì mới thêm file, và cập nhật cây thư mục ở mục [Cấu trúc](#cấu-trúc).

Suite mới bắt đầu bằng đúng khối này — `Test Setup` là chỗ mọi ca lấy bộ mẫu làm điểm xuất phát:

```robotframework
*** Settings ***
Documentation       <Màn gì> — <làm đúng việc gì>. <Hỏng thì người bán mất gì.>
Resource            ../resources/app.resource
Suite Setup         Mở Trình Duyệt Cho Suite
Suite Teardown      Đóng Trình Duyệt Cuối Suite
Test Setup          Mở Phiên Có Dữ Liệu Mẫu
Test Teardown       Đóng Phiên
Test Tags           <ten-man>
```

Một ca thường:

```robotframework
Câu tiếng Việt tả hành vi, đọc lên là hiểu, không nhắc tên hàm
    [Documentation]    Chỉ viết khi có cái người sau không tự suy ra được: vì sao con số này,
    ...    hoặc lỗi cũ nào đang bị khoá lại ở đây.
    Mở Màn    /duong-dan
    ${trước}=    Đọc Ô Tổng    <NHÃN>

    <hành động>

    Chờ Thấy Chữ    <thứ hiện ra>
    ${sau}=    Đọc Ô Tổng    <NHÃN>
    Should Be Equal    ${sau}    <mong đợi>    <câu báo lỗi nói ra cái gì sai>

    # Ca dính tới tiền: đối chiếu thêm với sổ thật, đừng chỉ tin màn hình.
    ${dòng}=    Đọc Bảng    orders
    Should Be Equal As Integers    ${dòng}[0][total]    <số>
```

Bốn chỗ hay bị làm ẩu:

- **Tên ca là câu tả hành vi**, không phải tên hàm. Người không đọc code phải hiểu được ca vừa hỏng.
- **Câu báo lỗi ở `Should Be Equal`** phải nói ra cái gì sai. `report.html` chỉ hiện đúng câu đó.
- **`[Documentation]` chỉ khi cần** — đừng chép lại tên ca.
- **Thẻ `regression`** dành cho ca khoá một lỗi đã từng cắn, không phải cho mọi ca mới.

### Cách viết bên trong ca

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
