# my-biller

PWA bán hàng cho quán nhỏ: lên đơn → xuất **phiếu bán hàng** gửi khách qua Zalo → tự ra doanh thu,
chi phí, công nợ, báo cáo. Chạy hoàn toàn trên máy người bán, **không backend, không đăng nhập, không
mạng vẫn bán được**. Tiếng Việt, VND.

> **Đây là phiếu bán hàng / biên nhận, không phải hoá đơn điện tử có mã cơ quan thuế.** Không có chữ
> ký số, không phát hành theo TT78/NĐ123. Ai cần hoá đơn hợp lệ về thuế thì phải dùng dịch vụ HĐĐT
> riêng.

## Chạy local

```bash
npm ci
npm run dev          # http://localhost:5173
```

Màn **Thêm** có nút *Nạp dữ liệu mẫu* (chỉ hiện ở bản dev) để có sẵn mặt hàng, khách, đơn và chi phí.

## Lệnh

| Lệnh | Việc |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | `tsc --noEmit` rồi `vite build` → `dist/` |
| `npm run preview` | Xem thử bản build |
| `npm run typecheck` | Chỉ kiểm kiểu |
| `npm run lint` | ESLint |
| `npm test` | Vitest (unit + component) |
| `npm run test:e2e` | Playwright trên Chrome thật, cổng 5174 |

`npm run test:e2e` cần Chrome của máy: `npx playwright install chrome`.

## Kiến trúc

```
src/domain/       hàm thuần: tiền, tổng đơn, trạng thái nợ, phân bổ tiền thu, báo cáo, sao lưu
                  (không import React, không import Dexie — test bằng Vitest không cần DOM)
src/db/           Dexie: schema, repository, recalc, backup
src/features/     mỗi màn một thư mục: sales, orders, receipt, items, customers,
                  expenses, debts, reports, settings
src/ui/           nút, sheet, ô nhập, dòng danh sách… dùng chung
src/app/          router, layout, bottom nav, service worker prompt
```

ESLint chặn cứng hai ranh giới: ngoài `src/db/**` không ai được import `@/db/db` (phải đi qua
repository), và `src/domain/**` không được import React / Dexie / `@/db/*`.

Chi tiết lựa chọn công nghệ: [`docs/tech-stack.md`](docs/tech-stack.md) ·
giao diện: [`docs/design-guidelines.md`](docs/design-guidelines.md) ·
deploy: [`docs/deploy.md`](docs/deploy.md).

## Bất biến (vi phạm = sai số tiền)

1. **Mọi số tiền là số nguyên VND.** Chỉ `qty` được lẻ. Format chỉ xảy ra lúc render.
2. **Dòng đơn lưu ảnh chụp** `name`/`unit`/`unitPrice`/`costPrice` lúc bán. Sửa giá mặt hàng không
   bao giờ làm đổi phiếu cũ.
3. `orders.paidAmount` là số suy diễn được lưu sẵn — phải cập nhật **trong cùng transaction** với
   việc thêm `payments`. `recalcAll()` dựng lại từ `payments` sau khi nhập file sao lưu.
4. Thu nợ trừ dần **đơn cũ nhất trước**, mỗi bản ghi `payments` trỏ đúng một đơn.
5. Báo cáo luôn tách **Doanh thu / Giá vốn / Chi phí**, không gộp thành một con số, kèm cảnh báo khi
   giá vốn có nguy cơ bị trừ hai lần.
6. Schema Dexie `version(1)` đã đóng băng. Đổi schema phải thêm `version(n+1).stores(…).upgrade(…)` —
   dữ liệu nằm trên máy người dùng, không có server để migrate hộ.

## Sao lưu

Không có backend nghĩa là **file sao lưu là bản sao duy nhất**. Màn *Thêm → Cài đặt*:

- **Sao lưu ra file** → tải `my-biller-backup-YYMMDD-HHmm.json` (JSON thuần, đọc và sửa tay được).
- **Nhập từ file** → kiểm định dạng trước, sai thì dừng và **không đụng DB**; đúng thì hỏi xác nhận,
  tự tải một file của dữ liệu hiện tại về máy, rồi mới ghi đè trong một transaction và chạy
  `recalcAll()`.
- Quá 7 ngày chưa sao lưu thì có banner nhắc ở màn Bán và màn Cài đặt.
- **Ghim bộ nhớ** (`navigator.storage.persist()`) giảm khả năng hệ điều hành xoá dữ liệu, nhưng không
  thay được việc sao lưu.

## Giới hạn đã biết

- **Mỗi máy một kho dữ liệu.** Không đồng bộ, không đa thiết bị, không nhiều nhân viên. Chuyển máy =
  sao lưu ở máy cũ, nhập ở máy mới.
- **iOS có thể xoá dữ liệu web app không dùng tới sau khoảng 7 ngày.** Ghim bộ nhớ + sao lưu đều đặn.
- Xoá dữ liệu duyệt web / gỡ app là mất sạch, trừ khi còn file sao lưu.
- Không có tài khoản, không phân quyền, không mã hoá. Ai cầm máy là xem được.

## Không làm ở bản 1

Hoá đơn điện tử có mã CQT · tồn kho · in bluetooth 58/80mm · cloud sync · nhiều nhân viên / phân
quyền · nhập đơn bằng giọng nói · VietQR trên phiếu · dark mode · đa ngôn ngữ.
