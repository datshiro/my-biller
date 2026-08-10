# Tech Stack — my-biller

Status: approved · Updated: 2026-08-09
Research: `plans/reports/research-260806-2326-mobile-biller-pwa.md`

## Hình thái sản phẩm

PWA mobile-first với **sổ chung do máy chủ quyết định**. Cloudflare Durable Object giữ sổ chính của
mỗi quán; IndexedDB trên từng máy là bản sao đọc và hàng đợi ghi khi mạng chập chờn. M1 ghép theo
thiết bị, chưa có đăng nhập hay vai trò người dùng. Phiếu bán hàng (không phải hóa đơn điện tử CQT).
Tiếng Việt, VND.

## Stack đã chốt

| Lớp | Chọn | Version | Ghi chú |
|---|---|---|---|
| UI | React | ^19.2.8 | |
| Build | Vite | ^8.2.1 | |
| Ngôn ngữ | TypeScript | **^6.0.3** | KHÔNG dùng TS 7 — xem "Bẫy đã tránh" |
| Plugin React | @vitejs/plugin-react | ^6.0.5 | peer: vite ^8 ✓ |
| CSS | tailwindcss + @tailwindcss/vite | ^4.3.3 | Tailwind v4, config trong CSS |
| DB local | dexie | ^4.4.4 | IndexedDB: bản sao đọc, outbox và danh tính máy |
| Reactive query | dexie-react-hooks | ^4.4.0 | `useLiveQuery` → UI tự update, **không cần Redux/Zustand** |
| Backup | *(tự viết)* | — | JSON thuần, validate bằng zod; cố ý loại token và trạng thái đồng bộ |
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
| Sync API | Cloudflare Workers + Durable Objects SQLite | wrangler ^4.120.0 | một Durable Object cho mỗi quán, WebSocket hibernation |
| Worker test | @cloudflare/vitest-pool-workers | ^0.20.3 | chạy Worker/DO thật trong môi trường Miniflare |

## Bẫy đã tránh (kiểm chứng bằng `npm view`)

- **TypeScript 7.0.2 là `latest` nhưng KHÔNG dùng.** `typescript-eslint@8` khai peer `typescript >=4.8.4 <6.1.0` → TS 7 (bản port Go) làm vỡ lint. Pin **TS 6.0.3** (nằm trong range). Nâng TS 7 sau khi typescript-eslint hỗ trợ.
- Đã verify peer deps của `vite-plugin-pwa`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `vitest` đều nhận `vite ^8` → không có xung đột.

## Quyết định kiến trúc + lý do

**1. Durable Object là nguồn sự thật; IndexedDB (Dexie) là bản sao đọc.**

Một Durable Object SQLite cho mỗi quán cô lập sổ theo đối tượng vật lý và xếp thứ tự sự kiện bằng
`seq`. Dexie vẫn giữ UI phản ứng nhanh, làm việc qua mạng chập chờn và backup JSON; lớp đồng bộ nằm
trong `src/db/sync/`. Không dùng SQLite-WASM trong trình duyệt.

**2. Không dùng thư viện PDF ở bản 1.**
jsPDF/pdf-lib không có glyph dấu tiếng Việt → phải embed + subset TTF. Thay bằng:
- **PNG**: render phiếu bằng HTML/CSS → `html-to-image` → **Web Share API** (`navigator.share` với file) → gửi Zalo. Zalo hiển thị ảnh inline, thực dụng hơn PDF.
- **PDF**: `window.print()` + `@media print` → user chọn "Lưu thành PDF". Browser render nên dấu tiếng Việt luôn đúng, 0 dependency.
- Fallback khi `navigator.share` không có: nút tải ảnh + copy text phiếu.

**3. Không state-management library.**
`useLiveQuery` đọc bản sao Dexie và tự re-render khi applier ghi sự kiện từ máy chủ. Bốn truy vấn
theo khoảng còn nghe thêm revision của sync applier. Thêm Zustand/Redux chỉ là tầng cache trùng lặp.

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
  db/          dexie schema + migrations, backup, outbox, pull/push/applier/leader
  domain/      logic thuần, không import React: money, order totals,
               debt balance, report aggregate, parse-order-text
  features/    sales · items · customers · expenses · debts · reports · settings
  ui/          component dùng chung (Button, Sheet, NumberPad, Money…)
  lib/         format tiền/ngày, share, print, storage-persist
shared/        schema sự kiện đồng bộ dùng chung
worker/        Worker routes + ShopDO SQLite
```
`domain/` không được import từ `db/` hay React → test bằng Vitest không cần DOM.

**7. Giá riêng của khách — bảng mềm, hai tầng, không có "giá sỉ chung".**

Dexie đã lên **`version(2)`**, thêm đúng một bảng `customerPrices` với index ghép **unique**
`&[customerId+itemId]`. Hình dạng bản ghi ở `src/domain/schema.ts` (`CustomerPriceSchema`) — đừng chép
lại vào đây, chép là để nó lệch.

Ba invariant, cả ba đều ở `src/domain/wholesale-price.ts`:

- **Đúng 2 tầng:** giá riêng của khách → giá lẻ. Không có tầng "giá sỉ chung" cho mọi khách.
- **Không có dòng = bán giá lẻ.** Vắng mặt là câu trả lời, không phải dữ liệu thiếu.
- **`0` là một giá thật** (hàng tặng kèm, khuyến mãi). Vì vậy code tra giá dùng `??`, không `||` —
  `||` biến một món người bán đã quyết định cho không thành một món có tính tiền.

Giá lẻ mà dòng giỏ rơi về khi tắt SỈ là **ảnh chụp lúc dòng vào giỏ** (`CartLine.retailPrice`), không
phải giá đọc lại từ danh mục: đọc lại thì sửa giá ở màn Mặt hàng sẽ làm giá của một đơn đang lên dở
nhảy theo.

**Bảng mềm, không phải bảng cứng.** Dòng giá mồ côi (món hoặc khách không còn) và dòng trùng cặp là rác
**vô hại** — giá tra theo `itemId` của dòng đang trong giỏ nên dòng mồ côi không bao giờ được đọc. Nên
nó **không** nằm trong `validateBackupIntegrity`; nó bị lọc ở `cleanPriceRows` rồi đếm và nói ra ở cửa
xác nhận. Chặn cả file vì mấy dòng rác thì đường ra duy nhất của người bán là sửa tay JSON — cái giá đó
lớn hơn nhiều lần cái hại. Riêng dòng trùng cặp thì bắt buộc phải lọc: để nguyên là `bulkPut` ăn
`ConstraintError` và **huỷ cả lượt nhập**, không riêng dòng đó.

**File sao lưu nhận các version cũ và xuất version hiện hành.** File v1 ra đời trước bảng giá nên thiếu hẳn khoá
`customerPrices`; nó được bù `[]` ở bước preprocess **theo đúng `version`**, chứ không phải bằng
`.default([])` trên trường đó — `.default()` sẽ nuốt luôn một file v2 bị lược mất bảng giá, và khi đó
`version` chỉ còn là chữ trang trí.

**Không revert deploy sau khi đã lên v2.** Bản JS cũ **mở được** kho đã ở version cao hơn: Dexie ăn
`VersionError` rồi tự mở lại không nêu version và chạy tiếp với đúng những bảng nó khai. Hậu quả không
phải màn trắng mà là mất tiền trong im lặng — `collectBackup` gom theo `db.tables` nên file sao lưu
thiếu hẳn bảng mới mà vẫn đóng dấu `lastBackupAt` như file lành, còn `replaceAllData` xoá cũng theo
`db.tables` nên bảng mới sống sót qua lần nhập rồi bám sang bản ghi vừa nhận đúng số id đó. Chặn ở
`db.on('ready')`: thấy trong kho có bảng mình không khai thì dừng hẳn, so theo **tên bảng** chứ không
theo số version (Dexie có đường mở lại ở `idbdb.version + 1` nên một bản v1 hợp lệ vẫn có thể nằm ở
version thật 11). Cùng nhà với nó là `on('versionchange')` — một bản JS khác vừa nâng version thì đóng
kết nối và chặn màn, vì giữ kết nối là mọi lệnh ghi hỏng trong khi màn hình vẫn hiện như thường.

## Ràng buộc & rủi ro chấp nhận

- **iOS xóa storage sau 7 ngày không dùng** (Safari policy). Mitigation bắt buộc trong bản 1: gọi `navigator.storage.persist()`, banner nhắc backup, hiện "lần backup gần nhất", export 1 chạm. → Backup là tính năng **an toàn dữ liệu**, không phải nice-to-have.
- Mất một máy không làm mất sổ chung, nhưng làm mất token thiết bị; phải ghép lại. File sao lưu vẫn
  cần cho phục hồi độc lập và đối soát.
- M1 tin cậy các máy đã ghép: mọi máy ngang quyền; xác thực người dùng và vai trò chủ/nhân viên để
  milestone sau.
- PWA cần HTTPS → không mở bằng `file://`. Dev trên điện thoại thật: `@vitejs/plugin-basic-ssl` hoặc `cloudflared tunnel`.

## Non-goals (bản 1)

Hóa đơn điện tử CQT/chữ ký số · tồn kho · in bluetooth 58/80mm · tài khoản người dùng và phân quyền
chủ/nhân viên · voice-AI nhập đơn · VietQR trên phiếu · cổng thanh toán.
