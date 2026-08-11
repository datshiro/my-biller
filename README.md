# my-biller

**<https://an-quynh.pages.dev>**

PWA bán hàng cho quán nhỏ: lên đơn → xuất **phiếu bán hàng** gửi khách qua Zalo → tự ra doanh thu,
chi phí, công nợ, báo cáo. Nhiều máy trong cùng một quán dùng chung sổ qua Cloudflare Durable
Objects; mỗi máy vẫn giữ bản sao IndexedDB và hàng đợi để không mất thao tác khi mạng chập chờn.
M1 chưa có tài khoản người dùng hay phân quyền. Tiếng Việt, VND.

> **Đây là phiếu bán hàng / biên nhận, không phải hoá đơn điện tử có mã cơ quan thuế.** Không có chữ
> ký số, không phát hành theo TT78/NĐ123. Ai cần hoá đơn hợp lệ về thuế thì phải dùng dịch vụ HĐĐT
> riêng.

## Chạy local

```bash
npm ci
npm run dev          # http://localhost:5173
```

Màn **Thêm** có nút *Nạp dữ liệu mẫu* ở dev và staging để có sẵn mặt hàng, khách, đơn và chi phí;
production không có nút này.

## Lệnh

| Lệnh | Việc |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | `tsc -b` rồi `vite build` → `dist/` |
| `npm run build:staging` | Build Pages staging → `dist/` với Worker staging |
| `npm run build:recovery` | Build app phục hồi chỉ đọc → `dist-recovery/` |
| `npm run preview` | Xem thử bản build |
| `npm run typecheck` | Chỉ kiểm kiểu |
| `npm run lint` | ESLint |
| `npm test` | Vitest (unit + component) |
| `npm run test:e2e` | Playwright trên Chrome thật, cổng 5174 |
| `npm run test:e2e:recovery` | Playwright trên recovery artifact, cổng 5176 |
| `npm run test:live` | Robot Framework: từng tính năng trên app thật, cổng 5175 |
| `npm run test:live:recovery` | Robot Framework trên recovery artifact, cổng 5176 |
| `npm run test:staging -- <suite>` | Robot Framework trên Pages/Worker staging đã deploy |

`npm run test:e2e` cần Chrome của máy: `npx playwright install chrome`.
Sau `npm ci`, cài môi trường local cho `npm run test:live` bằng đúng một lệnh:
`./robot/install.sh`. Script này là nguồn cài đặt duy nhất; xem thêm
[`docs/kiem-thu-live.md`](docs/kiem-thu-live.md).

Toàn bộ bộ kiểm thử live chạy trên pull request dưới check độc lập `Robot live`. Branch protection của
`main` hiện yêu cầu cả `Code quality and Playwright` lẫn `Robot live`; check pending hoặc fail đều chặn
merge, kể cả với owner/admin. Workflow tạo ra các check, còn branch protection mới là lớp enforce.

## Kiến trúc

```
src/domain/       hàm thuần: tiền, tổng đơn, trạng thái nợ, phân bổ tiền thu, báo cáo, sao lưu
                  (không import React, không import Dexie — test bằng Vitest không cần DOM)
src/db/           Dexie: schema, repository, recalc, backup, outbox và bản sao đọc
src/features/     mỗi màn một thư mục: sales, orders, receipt, items, customers,
                  expenses, debts, reports, settings
src/ui/           nút, sheet, ô nhập, dòng danh sách… dùng chung
src/app/          router, layout, bottom nav, service worker prompt
shared/           hợp đồng sự kiện đồng bộ dùng chung giữa PWA và Worker
worker/           Cloudflare Worker + một Durable Object SQLite cho mỗi quán
```

ESLint chặn cứng hai ranh giới: ngoài `src/db/**` không ai được import `@/db/db` (phải đi qua
repository), và `src/domain/**` không được import React / Dexie / `@/db/*`.

Chi tiết lựa chọn công nghệ: [`docs/tech-stack.md`](docs/tech-stack.md) ·
đồng bộ: [`docs/dong-bo.md`](docs/dong-bo.md) ·
giao diện: [`docs/design-guidelines.md`](docs/design-guidelines.md) ·
deploy: [`docs/deploy.md`](docs/deploy.md) ·
kiểm thử live: [`docs/kiem-thu-live.md`](docs/kiem-thu-live.md) ·
ghi chú phát hành: [`docs/ghi-chu-phat-hanh.md`](docs/ghi-chu-phat-hanh.md).

Artifact phục hồi là ứng dụng riêng, chỉ đọc và tải file sao lưu; nó không có màn bán hàng, ghép máy
hay runner đồng bộ. Vì IndexedDB bị cô lập theo origin, artifact này chỉ đọc được dữ liệu sự cố khi
được kích hoạt trên đúng production origin. Quy trình vận hành và ranh giới rollback nằm trong
[`docs/deploy.md`](docs/deploy.md#phục-hồi-schema-v5-cùng-origin).

## Bất biến (vi phạm = sai số tiền)

1. **Mọi số tiền là số nguyên VND.** Chỉ `qty` được lẻ. Format chỉ xảy ra lúc render.
2. **Dòng đơn lưu ảnh chụp** `name`/`unit`/`unitPrice`/`costPrice` lúc bán. Sửa giá mặt hàng không
   bao giờ làm đổi phiếu cũ.
3. `orders.paidAmount` là số suy diễn được lưu sẵn — bằng tổng `payments.amount` có
   `allocatedOrderId` trỏ vào đơn đó và phải cập nhật **trong cùng transaction**. `recalcAll()` dựng
   lại số này sau khi nhập file sao lưu.
4. `payments.orderId` giữ đơn nơi tiền phát sinh; `allocatedOrderId` là nơi tiền đang được phân bổ
   và có thể bằng `0` khi cần đối soát. Huỷ đơn không xoá phiếu thu. Thu nợ phân bổ đơn cũ nhất trước.
5. Báo cáo luôn tách **Doanh thu / Giá vốn / Chi phí**, không gộp thành một con số, kèm cảnh báo khi
   giá vốn có nguy cơ bị trừ hai lần.
6. Các schema Dexie đã phát hành đều đóng băng. Đổi schema phải thêm
   `version(n+1).stores(…).upgrade(…)`; Worker không thể tự nâng IndexedDB đang nằm trên từng máy.

## Sao lưu

Sổ chung trên Worker giảm rủi ro mất riêng một máy nhưng **không thay file sao lưu độc lập**. Màn
*Thêm → Cài đặt*:

- **Sao lưu ra file** → tải `my-biller-backup-YYMMDD-HHmm.json` (JSON thuần, đọc và sửa tay được).
  Nếu bản sao không có đơn, mặt hàng, khách, khoản chi hay giá riêng còn dùng được, app sẽ cảnh báo
  trước khi tải; file vẫn có thể chứa thông tin cửa hàng, nhóm/loại và cấu hình.
- Máy chưa ghép có thể **Nhập từ file** → kiểm định dạng trước, sai thì dừng và **không đụng DB**;
  đúng thì hỏi xác nhận, tự tải một file của dữ liệu hiện tại về máy, rồi mới ghi đè trong một
  transaction và chạy `recalcAll()`.
- Máy đã ghép dùng **Kéo lại từ đầu** để dựng lại bản sao từ sổ chung; không cho nhập file đè lên
  dữ liệu của các máy khác.
- Safari và app đã thêm vào Màn hình chính là hai kho dữ liệu tách biệt. Luôn sao lưu ở đúng nơi đang
  nhìn thấy sổ; nếu Safari báo bản sao chưa có dữ liệu bán hàng, hãy mở biểu tượng app trên Màn hình
  chính rồi kiểm tra lại.
- Sau khi tải bản sao thủ công hợp lệ, thiết bị hỗ trợ chia sẻ file sẽ hiện nút chia sẻ chính file JSON
  vừa tải. Máy không hỗ trợ vẫn dùng file trong Tải về để gửi qua Zalo hoặc lưu Drive. File chứa toàn
  bộ sổ và thông tin khách, chỉ gửi tới nơi tin cậy.
- File sao lưu không chứa token, mã máy hay trạng thái đồng bộ trong `deviceState`.
- Quá 7 ngày chưa sao lưu thì có banner nhắc ở màn Bán và màn Cài đặt.
- **Ghim bộ nhớ** (`navigator.storage.persist()`) giảm khả năng hệ điều hành xoá dữ liệu, nhưng không
  thay được việc sao lưu.

## Giới hạn đã biết

- Mỗi quán có một sổ chung; mỗi máy có bản sao và tự đồng bộ khi đã ghép. Mạng mất ngắn hạn vẫn ghi
  vào hàng đợi, nhưng thay đổi xung đột có thể bị máy chủ từ chối và hoàn lại sau khi nối lại.
- **iOS có thể xoá dữ liệu web app không dùng tới sau khoảng 7 ngày.** Ghim bộ nhớ + sao lưu đều đặn.
- Xoá dữ liệu duyệt web / gỡ app làm mất danh tính và token của máy; phải ghép lại để kéo sổ chung.
- M1 không có tài khoản hay vai trò: mọi máy đã ghép ngang quyền, đều tạo mã ghép và thu hồi máy
  khác. Authentication và authorization người dùng thuộc milestone sau.

## Ngoài phạm vi milestone M1

Hoá đơn điện tử có mã CQT · tồn kho · in bluetooth 58/80mm · tài khoản người dùng / phân quyền ·
nhập đơn bằng giọng nói · VietQR trên phiếu · dark mode · đa ngôn ngữ.
