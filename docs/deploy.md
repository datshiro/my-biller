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

## 5. Cập nhật app

Service worker chạy ở chế độ `prompt`: có bản mới thì app hiện thanh hỏi, người dùng bấm mới tải lại.
Cố ý làm vậy — tự reload giữa lúc đang lên đơn là mất đơn.

## Giới hạn đã biết

- **iOS xoá dữ liệu của web app không dùng tới sau ~7 ngày.** Đó là lý do màn Cài đặt có nút ghim bộ
  nhớ và banner nhắc sao lưu. Sao lưu ra file vẫn là lớp bảo vệ thật sự duy nhất.
- Mỗi máy một kho dữ liệu riêng. Không có đồng bộ; muốn chuyển máy thì Sao lưu ở máy cũ → Nhập ở máy
  mới.
- Không có tài khoản, không có phân quyền. Ai cầm máy là dùng được.

## Số đo tham chiếu (bản 1.0.0, đo trên máy dev)

| Hạng mục | Kết quả |
|---|---|
| Bundle | 542 KB thô · **165 KB gzip** (JS) + 5 KB gzip (CSS) |
| Precache của service worker | 17 file · 623 KB |
| LCP (Chrome, CPU ×4 + Slow 4G) | **464 ms** · CLS 0.00 |
| Lighthouse mobile | Accessibility 100 · Best Practices 100 · SEO 91 |
| PWA installable | manifest hợp lệ (name, short_name, start_url, standalone, icon 192/512 + maskable) + service worker *activated* |

Kiểm trên chính `an-quynh.pages.dev` (8/8/2026): `/`, `/bao-cao`, `/don/1/phieu`,
`/manifest.webmanifest`, `/sw.js` — 50/50 lượt đều 200, manifest đúng `application/manifest+json`;
service worker *activated*, nắm quyền điều khiển sau lần reload đầu, precache 14 file.

Bài kiểm offline chạy trên Chrome thật giả lập Pixel 7: chặn toàn bộ mạng (`fetch` ra ngoài trả
`OFFLINE`), rồi tải lại route sâu `/bao-cao` → render đủ; bán trọn một đơn → phiếu `PBH-260808-001`
hiện ra và Báo cáo lên `Doanh thu 25.000`. Tức là mất mạng vẫn bán và vẫn xuất phiếu được — phần còn
lại cần điện thoại thật chỉ là thao tác cài lên màn hình chính.

Lighthouse 12 đã bỏ hạng mục PWA, nên "installable" kiểm bằng chính các điều kiện trên chứ không phải
bằng điểm số. `Performance` cũng không lấy được điểm từ công cụ đang dùng — số thay thế là LCP/CLS đo
dưới đúng mức bóp CPU và mạng của Lighthouse mobile.
