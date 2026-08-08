# Deploy lên Cloudflare Pages

**Bản đang chạy: <https://an-quynh.pages.dev>** (project Cloudflare Pages `an-quynh`, nhánh production
`main`).

> Subdomain `*.pages.dev` bị ghim theo tên project **lúc tạo** và không đổi theo khi đổi tên project.
> Muốn địa chỉ khác thì phải tạo project mới mang đúng tên đó. Xem
> [`cloudflare-deploy-giai-thich.html`](./cloudflare-deploy-giai-thich.html).

App không có backend. "Deploy" ở đây chỉ là đưa mấy file tĩnh trong `dist/` lên một host chạy HTTPS,
để điện thoại cài được về màn hình chính. Dữ liệu vẫn nằm trong IndexedDB của từng máy — deploy
không đụng gì tới nó.

## 1. Build

```bash
npm ci
npm run build     # tsc --noEmit && vite build → dist/
```

Kết quả cần có trong `dist/`: `index.html`, `assets/`, `manifest.webmanifest`, `sw.js`, `icons/`,
`fonts/`, `_redirects`, `robots.txt`.

`_redirects` chứa `/*  /index.html  200`. Thiếu dòng đó thì mở thẳng `https://…/bao-cao` hoặc bấm F5
ở màn Báo cáo sẽ ra trang 404 của Cloudflare, vì router nằm ở phía trình duyệt.

## 2. Đưa lên Cloudflare Pages

Cách nhanh nhất, không cần nối Git:

```bash
npx wrangler login                                                    # chỉ lần đầu, mở trình duyệt
npx wrangler pages project create an-quynh --production-branch main   # chỉ lần đầu
npx wrangler pages deploy dist --project-name an-quynh --branch main
```

Bỏ bước `project create` thì lệnh deploy báo `Project not found [code: 8000007]` — ở chế độ không
tương tác `wrangler` không tự tạo project.

Mỗi lần deploy in ra một URL xem trước dạng `https://<hash>.an-quynh.pages.dev`; bản chính luôn ở
`https://an-quynh.pages.dev`. Ngay sau khi tạo project mới, DNS mất khoảng nửa phút mới phân giải, và
sau đó vài lượt đầu còn trả **522** — edge chưa propagate xong, chờ rồi thử lại chứ không phải cấu
hình sai.

Hai mã lỗi hay gặp lúc đặt tên project, phân biệt cho khỏi mất công:

| Mã | Thông báo | Nghĩa |
|---|---|---|
| `8000002` | A project with this name already exists | Trùng tên project **trong tài khoản của mình** |
| `8000029` | Subdomain is unavailable | Tên đã bị người khác **trên toàn cầu** chiếm |

Nếu muốn tự build mỗi lần push, nối repo trong Cloudflare Dashboard → Workers & Pages → Create →
Pages → Connect to Git, với:

| Thiết lập | Giá trị |
|---|---|
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | 22 trở lên |

## 3. Kiểm sau khi deploy

1. Mở `https://…/bao-cao` **thẳng từ thanh địa chỉ** → phải ra màn Báo cáo, không phải 404.
2. DevTools → Application → Manifest: không có lỗi; Service Worker ở trạng thái *activated*.
3. Bấm cài lên màn hình chính, tắt máy bay… ý là **bật** chế độ máy bay, rồi mở app từ icon: phải
   lên đơn và xuất phiếu được như thường.
4. Đọc [`ghi-chu-phat-hanh.md`](./ghi-chu-phat-hanh.md) xem bản này có việc gì người bán phải tự làm
   trên dữ liệu cũ của họ. Deploy không đụng tới IndexedDB, nên dữ liệu do lỗi bản trước ghi sai vẫn
   nằm nguyên ở đó — phải nhắc chủ quán, không có migration nào chữa hộ được.

## 4. Cài lên điện thoại

- **Android (Chrome):** mở link → menu ⋮ → *Thêm vào Màn hình chính* / *Cài đặt ứng dụng*.
- **iPhone (Safari):** mở link → nút Chia sẻ → *Thêm vào MH chính*. Bắt buộc dùng Safari; Chrome trên
  iOS không cài PWA được.

Sau khi cài, mở app **từ icon** chứ đừng mở lại bằng trình duyệt: hai đường đó dùng chung IndexedDB
trên Android, nhưng trên iOS thì bản cài và bản trong Safari có thể là hai kho dữ liệu khác nhau.

> Câu "dùng chung IndexedDB trên Android" ở trên **chưa có phép đo nào đứng sau** — xem cuối mục
> [Số đo tham chiếu](#số-đo-tham-chiếu-đo-trên-máy-dev). Cứ làm theo hướng dẫn này, nhưng đừng dựa vào
> nó để hứa với chủ quán rằng mở nhầm đường thì dữ liệu vẫn còn nguyên.

## 5. Cập nhật app

Service worker chạy ở chế độ `prompt`: có bản mới thì app hiện thanh hỏi, người dùng bấm mới tải lại.
Cố ý làm vậy — tự reload giữa lúc đang lên đơn là mất đơn.

## Giới hạn đã biết

- **iOS xoá dữ liệu của web app không dùng tới sau ~7 ngày.** Đó là lý do màn Cài đặt có nút ghim bộ
  nhớ và banner nhắc sao lưu. Sao lưu ra file vẫn là lớp bảo vệ thật sự duy nhất.
- **Nút ghim bộ nhớ bị từ chối cho tới khi site được bookmark.** Đo trên Chrome-Android, bốn lượt
  trên máy vừa xoá sạch dữ liệu Chrome:

  | lượt | tình huống | `navigator.storage.persist()` |
  |---|---|---|
  | A | vừa mở lần đầu | `false` |
  | C | để nguyên 4 phút, chưa bookmark | `false` |
  | E | bookmark (đã xác nhận nút đổi thành *Edit bookmark*) | **`true`** |

  Lượt C loại trừ khả năng "cứ chờ là được". Chỉ **một** thao tác bookmark là đủ, không cần cài lên
  màn hình chính. Trước đó nút bấm không hỏng — nó bị Chrome từ chối, mà người bán không nhận ra khác
  biệt vì màn hình vẫn hiện y như cũ. Đáng cân nhắc cho màn Cài đặt tự nói ra điều này.
- Mỗi máy một kho dữ liệu riêng. Không có đồng bộ; muốn chuyển máy thì Sao lưu ở máy cũ → Nhập ở máy
  mới.
- Không có tài khoản, không có phân quyền. Ai cầm máy là dùng được.

## Số đo tham chiếu (đo trên máy dev)

Bundle và precache đo lại ở bản 1.0.1; LCP với Lighthouse vẫn là số của 1.0.0 — chưa đo lại trên bản
deploy mới, đừng đọc chúng như số của 1.0.1.

| Hạng mục | Kết quả |
|---|---|
| Bundle (1.0.1) | 552 KB thô · **168 KB gzip** (JS) + 5 KB gzip (CSS) |
| Precache của service worker (1.0.1) | 17 file · 633 KB |
| LCP (1.0.0; Chrome, CPU ×4 + Slow 4G) | **464 ms** · CLS 0.00 |
| Lighthouse mobile (1.0.0) | Accessibility 100 · Best Practices 100 · SEO 91 |
| PWA installable | manifest hợp lệ (name, short_name, start_url, standalone, icon 192/512 + maskable) + service worker *activated* |

Kiểm trên chính `an-quynh.pages.dev` (8/8/2026): `/`, `/bao-cao`, `/don/1/phieu`,
`/manifest.webmanifest`, `/sw.js` — 50/50 lượt đều 200, manifest đúng `application/manifest+json`;
service worker *activated*, nắm quyền điều khiển sau lần reload đầu, precache 14 file.

Bài kiểm offline chạy trên Chrome thật giả lập Pixel 7: chặn toàn bộ mạng (`fetch` ra ngoài trả
`OFFLINE`), rồi tải lại route sâu `/bao-cao` → render đủ; bán trọn một đơn → phiếu `PBH-260808-001`
hiện ra và Báo cáo lên `Doanh thu 25.000`. Tức là mất mạng vẫn bán và vẫn xuất phiếu được — phần còn
lại cần điện thoại thật chỉ là thao tác cài lên màn hình chính.

Chạy thêm trên Chrome-Android thật (máy ảo Android 16, Pixel 7) qua `adb reverse` — `localhost` là
secure context nên service worker vẫn bật được mà không cần HTTPS. Kiểm được: app render đúng,
service worker *activated* và nắm quyền điều khiển, manifest standalone với đủ icon 192/512/maskable,
IndexedDB ghi thật rồi tải lại trang vẫn còn, `visibilitychange` thật sự nổ khi bấm HOME rồi quay lại.

Chạy lại lần nữa, lần này trỏ thẳng vào `https://an-quynh.pages.dev` chứ không qua `localhost`. Chrome
mời cài đàng hoàng ("Install app / my-biller — Bán hàng"), bấm Install, nhưng không gói nào sinh ra.
Logcat nói rõ vì sao:

```
Finsky: installPackage: com.android.chrome (org.chromium.webapk.a0fc74e8ccf979ace_v2)
Finsky: WebAPK service unknown_account
```

Google **đã** nhận yêu cầu và **đã** cấp tên gói — tức là phía máy chủ không có vấn đề gì. Play từ
chối cài vì máy ảo không đăng nhập tài khoản Google nào (`dumpsys account` đếm được 0). Điện thoại
thật của chủ quán luôn có tài khoản, nên đây là giới hạn của máy ảo chứ không phải của app.

> Ghi chú sửa lại: bản trước của tài liệu này đoán rằng lượt cài qua `localhost` hỏng vì máy chủ
> Google không tải được manifest. Lượt đo trên đây cho thấy nguyên nhân nhiều khả năng vẫn là thiếu
> tài khoản — máy ảo lúc đó cũng chưa có tài khoản nào. Đừng dựa vào lời giải thích cũ.

Hệ quả: câu "bản cài và bản trong Chrome dùng chung IndexedDB" ở mục 4 **vẫn chưa có phép đo nào đứng
sau**. Muốn kiểm thì phải đăng nhập một tài khoản Google vào máy ảo, hoặc dùng điện thoại thật.

Lighthouse 12 đã bỏ hạng mục PWA, nên "installable" kiểm bằng chính các điều kiện trên chứ không phải
bằng điểm số. `Performance` cũng không lấy được điểm từ công cụ đang dùng — số thay thế là LCP/CLS đo
dưới đúng mức bóp CPU và mạng của Lighthouse mobile.
