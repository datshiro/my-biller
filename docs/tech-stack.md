# Tech Stack — my-biller

Status: approved · Date: 2026-08-06 · Decided in `/ak:bootstrap --full`
Research: `plans/reports/research-260806-2326-mobile-biller-pwa.md`

## Hình thái sản phẩm

PWA mobile-first, **local-first / offline-only**, không backend, không đăng nhập.
Phiếu bán hàng (không phải hóa đơn điện tử CQT). Tiếng Việt, VND.

## Stack đã chốt

| Lớp | Chọn | Version | Ghi chú |
|---|---|---|---|
| UI | React | ^19.2.8 | |
| Build | Vite | ^8.2.1 | |
| Ngôn ngữ | TypeScript | **^6.0.3** | KHÔNG dùng TS 7 — xem "Bẫy đã tránh" |
| Plugin React | @vitejs/plugin-react | ^6.0.5 | peer: vite ^8 ✓ |
| CSS | tailwindcss + @tailwindcss/vite | ^4.3.3 | Tailwind v4, config trong CSS |
| DB local | dexie | ^4.4.4 | IndexedDB |
| Reactive query | dexie-react-hooks | ^4.4.0 | `useLiveQuery` → UI tự update, **không cần Redux/Zustand** |
| Backup | *(tự viết)* | — | JSON thuần đọc được bằng mắt, validate bằng zod. Đã cân nhắc `dexie-export-import` nhưng blob của nó không đọc/sửa tay được — với app không backend thì khả năng phục hồi tay quan trọng hơn |
| PWA | vite-plugin-pwa | ^1.3.0 | Workbox, peer vite ^8 ✓ |
| Router | react-router | ^8.3.0 | declarative mode — cần cho **nút back Android** |
| Chart | *(CSS thuần)* | — | Đã đo recharts: **93,9 KB gzip** cho một `BarChart` tối thiểu, trong khi cả app chỉ 152,7 KB gzip JS. Biểu đồ duy nhất của app là 7 cột tĩnh (không tooltip, không zoom) nên vẽ bằng flex + `height: %` — xem `src/features/reports/revenue-expense-chart.tsx` |
| Ảnh phiếu | html-to-image | ^1.11.13 | DOM → PNG cho Web Share API |
| Validate | zod | ^4.4.3 | form + validate file backup khi import |
| Ngày | date-fns | ^4.4.0 | locale vi |
| Unit test | vitest | ^4.1.10 | peer vite ^8 ✓ — ghim `TZ: 'Asia/Ho_Chi_Minh'` trong `vite.config.ts`: ranh giới ngày/tháng của app tính theo giờ người bán, chạy test ở múi giờ khác thì mấy ca 23:50 / 00:10 vẫn xanh mà không chứng minh được gì |
| E2E | @playwright/test | ^1.62.1 | chạy trên **Chrome thật của máy** (`channel: 'chrome'`), không phải chromium đóng gói kèm — ảnh phiếu vẽ bằng canvas và bản in do engine trình duyệt render. Máy chưa có: `npx playwright install chrome` |
| Lint | typescript-eslint | ^8.66.0 | |
| Font | Be Vietnam Pro (Google Fonts) | — | self-host, subset `vietnamese` |
| Deploy | Cloudflare Pages | — | static, HTTPS sẵn (PWA bắt buộc HTTPS) |

## Bẫy đã tránh (kiểm chứng bằng `npm view`)

- **TypeScript 7.0.2 là `latest` nhưng KHÔNG dùng.** `typescript-eslint@8` khai peer `typescript >=4.8.4 <6.1.0` → TS 7 (bản port Go) làm vỡ lint. Pin **TS 6.0.3** (nằm trong range). Nâng TS 7 sau khi typescript-eslint hỗ trợ.
- Đã verify peer deps của `vite-plugin-pwa`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `vitest` đều nhận `vite ^8` → không có xung đột.

## Quyết định kiến trúc + lý do

**1. IndexedDB (Dexie), không SQLite-WASM.**
SQLite trong browser chỉ nhanh khi chạy sync-I/O trong Web Worker → thêm cả lớp worker + ~1MB wasm. Quy mô 1 shop (≤ vài chục nghìn dòng) thì Dexie thừa sức, lại có sẵn export/import JSON cho backup. YAGNI.

**2. Không dùng thư viện PDF ở bản 1.**
jsPDF/pdf-lib không có glyph dấu tiếng Việt → phải embed + subset TTF. Thay bằng:
- **PNG**: render phiếu bằng HTML/CSS → `html-to-image` → **Web Share API** (`navigator.share` với file) → gửi Zalo. Zalo hiển thị ảnh inline, thực dụng hơn PDF.
- **PDF**: `window.print()` + `@media print` → user chọn "Lưu thành PDF". Browser render nên dấu tiếng Việt luôn đúng, 0 dependency.
- Fallback khi `navigator.share` không có: nút tải ảnh + copy text phiếu.

**3. Không state-management library.**
`useLiveQuery` của Dexie đọc trực tiếp IndexedDB và tự re-render khi DB đổi. DB **là** state. Thêm Zustand/Redux chỉ là tầng cache trùng lặp.

**4. Tiền lưu bằng số nguyên VND.**
Invariant toàn hệ thống: mọi số tiền là `number` nguyên, đơn vị đồng. VND không có phần thập phân → không bao giờ float. Chỉ format khi render.

**5. Chỗ cắm cho voice/AI (phase sau).**
Tách hàm thuần:
```ts
// src/domain/order-draft/parse-order-text.ts
parseOrderText(text: string, items: Item[]): OrderDraftLine[]
```
Bản 1: gọi từ ô search khi gõ tay. Phase sau: Web Speech API hoặc LLM đổ text vào **cùng hàm này** → không phải viết lại UI bán hàng.

**6. Bố cục module**
```
src/
  app/         routing, layout, providers, service-worker registration
  db/          dexie schema + version migrations, backup export/import
  domain/      logic thuần, không import React: money, order totals,
               debt balance, report aggregate, parse-order-text
  features/    sales · items · customers · expenses · debts · reports · settings
  ui/          component dùng chung (Button, Sheet, NumberPad, Money…)
  lib/         format tiền/ngày, share, print, storage-persist
```
`domain/` không được import từ `db/` hay React → test bằng Vitest không cần DOM.

## Ràng buộc & rủi ro chấp nhận

- **iOS xóa storage sau 7 ngày không dùng** (Safari policy). Mitigation bắt buộc trong bản 1: gọi `navigator.storage.persist()`, banner nhắc backup, hiện "lần backup gần nhất", export 1 chạm. → Backup là tính năng **an toàn dữ liệu**, không phải nice-to-have.
- Mất máy = mất dữ liệu (hệ quả của offline-only, user đã chấp nhận).
- PWA cần HTTPS → không mở bằng `file://`. Dev trên điện thoại thật: `@vitejs/plugin-basic-ssl` hoặc `cloudflared tunnel`.

## Non-goals (bản 1)

Hóa đơn điện tử CQT/chữ ký số · tồn kho · in bluetooth 58/80mm · cloud sync / đa thiết bị / nhiều nhân viên · voice-AI nhập đơn · VietQR trên phiếu · cổng thanh toán.
