# Deploy my-biller lên Cloudflare

**Bản đang chạy: <https://an-quynh.pages.dev>** (project Cloudflare Pages `an-quynh`, nhánh production
`main`).

> Subdomain `*.pages.dev` bị ghim theo tên project **lúc tạo** và không đổi theo khi đổi tên project.
> Muốn địa chỉ khác thì phải tạo project mới mang đúng tên đó. Xem
> [`cloudflare-deploy-giai-thich.html`](./cloudflare-deploy-giai-thich.html).

Frontend vẫn là các file tĩnh trong `dist/` trên Cloudflare Pages. M1 đồng bộ nhiều máy thêm một
Cloudflare Worker ở `my-biller-sync.datshiro.workers.dev`; domain riêng để sau. Dữ liệu IndexedDB
không bị thay đổi chỉ vì frontend hoặc Worker được deploy — migration chỉ chạy khi app mới mở DB.

## Worker đồng bộ và cổng chi phí M1

Số liệu đọc ngày **11/08/2026** từ tài liệu chính thức của Cloudflare:

| Hạn mức Durable Objects SQLite trên Workers Free | Giá trị |
|---|---:|
| Request | 100.000/ngày |
| Thời lượng compute | 13.000 GB-s/ngày |
| Dòng SQLite đọc | 5.000.000/ngày |
| Dòng SQLite ghi | 100.000/ngày |
| Tổng dung lượng tài khoản | 5 GB |
| Dung lượng một Durable Object | 1 GB |

Nguồn: [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[limits](https://developers.cloudflare.com/durable-objects/platform/limits/) và
[FAQ](https://developers.cloudflare.com/durable-objects/reference/faq/). Free chỉ cho tạo Durable
Object dùng SQLite. Khi vượt một hạn mức ngày, thao tác tương ứng **thất bại** thay vì tự phát sinh
phí vượt mức; hạn mức ngày đặt lại lúc 00:00 UTC.

Runner remote poll dự phòng mỗi 30 giây; lease cục bộ 5 giây không gọi Cloudflare. Một máy mở 8 giờ
tạo khoảng 2.880 request nền; hai máy là 5.760. Ước lượng bảo thủ thêm 1.000 sự kiện/ngày, mỗi sự
kiện tối đa 6 request, 10 dòng đọc và 10 dòng ghi: tổng khoảng 11.760 request, dưới 70.000 dòng đọc
và dưới 12.000 dòng ghi mỗi ngày — đều dưới 12% hạn mức tương ứng. Localhost vẫn poll 2 giây để
bù WebSocket local không ổn định, nhưng không dùng quota Cloudflare. Giả sử mỗi sự kiện chiếm trung
bình 2 KB kể cả index, một năm `oplog` khoảng 730 MB, dưới giới hạn 1 GB của một quán nhưng phải đo
lại trước năm vận hành thứ hai. Với giả định cực đại 1 giây compute ở 128 MB cho mỗi sự kiện thì
khoảng 125 GB-s/ngày; WebSocket hibernation không tính thời lượng khi idle đủ điều kiện.

**Kết luận Phase 1: đi tiếp ở 0 USD/tháng.** Cổng này chỉ đúng khi tài khoản ở Workers Free và
mức dùng không vượt các hạn mức trên. Nếu số đo production tiến gần hạn mức, phải dừng mở rộng thay
vì tự chuyển sang Paid.

### Giới hạn thử mã ghép

Binding `PAIR_RATE_LIMITER` trong [`worker/wrangler.toml`](../worker/wrangler.toml) cho phép 20 lượt
`POST /pair` mỗi 60 giây theo `cf-connecting-ip`. Worker kiểm lớp này trước khi đọc mã định tuyến và
chọn Durable Object; request không có header Cloudflare đó được cho qua để local/test vẫn chạy.

Đây là bộ đếm cục bộ, thiên về cho qua của Cloudflare: nó giảm thử mã hàng loạt ở edge nhưng không
phải lá chắn quota phân tán tuyệt đối. Không dùng nó để nâng dự báo tải hay cam kết không thể vượt
hạn mức Free; ShopDO vẫn giữ chốt thử sai theo từng quán. M1 tiếp tục dùng domain miễn phí
`my-biller-sync.datshiro.workers.dev` với `workers_dev = true`, chưa mua domain riêng.

```bash
npm run worker:dev       # http://127.0.0.1:8787
curl https://my-biller-sync.datshiro.workers.dev/health
```

Lần đầu hoặc khi xoay secret, đặt secret phía Worker; không đưa giá trị vào `.env`, frontend hay
lệnh được lưu trong tài liệu:

```bash
npx wrangler secret put ADMIN_SECRET --config worker/wrangler.toml
npm run worker:deploy
curl --fail https://my-biller-sync.datshiro.workers.dev/health
```

Deploy Worker và kiểm `/health` **trước** Pages. Frontend production đã trỏ vào domain miễn phí
`my-biller-sync.datshiro.workers.dev`; chỉ đổi `DEFAULT_SYNC_URL` khi mua domain riêng và phải giữ
CORS/HTTPS hoạt động. `ADMIN_SECRET` chỉ dùng để operator tạo quán đầu tiên qua `POST /shop`, không
được đóng gói vào PWA. Protocol pending không thêm endpoint ADMIN: client kích hoạt reservation bằng
token máy tạm qua `POST /shop/{shopId}/seed` (route `/seed` trong ShopDO). Khi khôi phục sự cố,
rollback cả hai artifact về cặp phiên bản đã kiểm thử; không xoá Durable Object hoặc đổi migration
tag đã phát hành.

Health endpoint đã trả `200 {"status":"ok"}` từ mạng Internet ngày 09/08/2026. Lượt kiểm cuối
trên điện thoại thật qua 4G vẫn là bước thủ công trước khi đưa máy người bán vào M1.

## Staging tách khỏi production

Staging dùng Worker `my-biller-sync-staging.datshiro.workers.dev` và một namespace Durable Object
riêng. Frontend staging là preview deployment của project Pages `an-quynh`; production branch vẫn là
`main`, nên deploy nhánh `release/staging-260811` không đổi `an-quynh.pages.dev`.

Lần đầu tạo môi trường, đặt một `ADMIN_SECRET` **riêng cho staging**; không dùng lại hoặc ghi giá trị
production vào lệnh, file hay log:

```bash
npx wrangler secret put ADMIN_SECRET --config worker/wrangler.toml --env staging
npm run worker:deploy:staging
curl --fail https://my-biller-sync-staging.datshiro.workers.dev/health
```

Chỉ sau khi health Worker xanh mới build và deploy Pages preview:

```bash
npm run build:staging
npx wrangler pages deploy dist --project-name an-quynh --branch release/staging-260811
```

`build:staging` đóng cứng URL Worker staging vào bundle; `npm run build` vẫn đóng URL production.
Sau deploy, kiểm bundle từ preview không chứa URL production trước khi tạo quán thử. Bản staging hiện
nút dữ liệu mẫu dành riêng cho kiểm thử; production không có nút này.

Runner remote không tự dựng hoặc tái sử dụng Vite/Worker local; nó chỉ chấp nhận Worker staging và
Pages preview HTTPS, không chấp nhận domain production. Nạp secret staging từ kho secret an toàn vào
biến đã export của phiên hiện tại, rồi chạy bộ Chrome thật với đúng URL preview bất biến vừa deploy:

```bash
test -n "${STAGING_ADMIN_SECRET:-}" || exit 1
BASE_URL=https://<deployment-hash>.an-quynh.pages.dev \
WORKER_URL=https://my-biller-sync-staging.datshiro.workers.dev \
ROBOT_WORKER_ADMIN_SECRET="$STAGING_ADMIN_SECRET" \
npm run test:staging -- robot/tests/hai-may.robot
unset STAGING_ADMIN_SECRET
```

Rollback Worker staging bằng version tốt gần nhất; Pages preview giữ URL bất biến của từng deployment,
nên checkout commit tốt, build lại bằng `build:staging` rồi deploy lại cùng nhánh để đưa alias về bản đó:

```bash
npx wrangler deployments list --config worker/wrangler.toml --env staging
npx wrangler rollback <version-id> --config worker/wrangler.toml --env staging
```

## Phục hồi schema v5 cùng origin

`dist-recovery/` là artifact sự cố riêng của 2.0.0. Nó mở cùng Dexie schema v5 nhưng chỉ hiển thị số
bản ghi và tải file sao lưu; không khởi động sync runner, không bán hàng, nhập file, ghép máy, kéo lại
từ đầu hoặc ghi ledger/outbox. File tải xuống vẫn chứa toàn bộ sổ và thông tin khách nên phải được
lưu ở nơi tin cậy.

IndexedDB bị cô lập theo origin. Bản recovery trên localhost, staging hoặc một Pages preview URL
không thể đọc dữ liệu của `an-quynh.pages.dev`. Chỉ kích hoạt recovery trên **đúng production origin**
khi app 2.x chính không mở được mà cần lấy dữ liệu ra. Đây là deployment production, cần authorization
riêng và vẫn phải đi qua quy trình CI/CD/Tech Ops; không dùng lệnh deploy thủ công như một đường tắt.

Chuẩn bị và kiểm artifact ở local/CI:

```bash
npm ci
npm run test:e2e:recovery
npm run test:live:recovery
npm run build:recovery
```

Ba lệnh cuối phải xanh và `dist-recovery/` phải tách khỏi `dist/`. Trước khi kích hoạt trong sự cố:

1. Xác nhận version/source của recovery khớp schema đang chạy và Worker không cần thay đổi.
2. Yêu cầu người dùng đóng hoàn toàn mọi tab Safari, PWA Màn hình chính và app 2.x cũ đang mở; một
   context cũ còn chạy vẫn có thể ghi dữ liệu hoặc đẩy outbox.
3. Deploy artifact recovery bằng pipeline production lên đúng origin. Không deploy Worker và không
   xoá Durable Object, IndexedDB hay service-worker storage.
4. Mở origin để trình duyệt nhận service worker recovery. Recovery worker dùng `skipWaiting` và
   `clientsClaim` để tự kích hoạt; normal build vẫn giữ cơ chế hỏi trước khi cập nhật. Nếu còn thấy
   app bán hàng, không thao tác với sổ: chờ worker mới giành quyền, đóng hẳn context rồi mở lại/tải lại.
5. Trước khi đọc hoặc tải file, bắt buộc kiểm đủ ba dấu: title tab là
   **“my-biller — Phục hồi chỉ đọc”**, banner đỏ **“CHẾ ĐỘ PHỤC HỒI — KHÔNG BÁN HÀNG”** và phần tử
   gốc có `data-app-mode="recovery"`. Thiếu một dấu thì dừng canary, không xem đó là recovery.
6. Chỉ sau canary trên mới đối chiếu số bản ghi, tải file và giữ file ở nơi tin cậy. Không tiếp tục
   bán hàng trong thời gian recovery đang được kích hoạt.

Thoát recovery bằng **roll-forward**: build và deploy artifact app 2.x đã sửa qua pipeline, sau đó
yêu cầu người dùng chấp nhận cập nhật service worker/tải lại rồi kiểm số liệu. Không rollback frontend
về 1.0.2 sau khi schema v5 đã được mở; 1.0.2 không hiểu schema mới. Nếu cần rollback Worker, chỉ dùng
Worker version tương thích với frontend/schema v5 và version đã qua kiểm thử.

Normal và staging đều ghi vào `dist/`, còn recovery ghi vào `dist-recovery/`. Khi chuẩn bị local
release candidate, build staging và recovery trước rồi chạy `npm run build` cuối cùng để `dist/` còn
lại là artifact production normal.

## 1. Build

```bash
npm ci
npm run build     # tsc -b && vite build → dist/
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
  nhớ và banner nhắc sao lưu. Sổ chung giúp dựng lại bản sao máy, còn file sao lưu vẫn là lớp phục
  hồi độc lập do người bán tự giữ.
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
- Mỗi máy giữ bản sao IndexedDB riêng nhưng các máy đã ghép dùng chung một sổ trên Durable Object.
  Mạng chập chờn được xếp hàng; xung đột nghiệp vụ có thể bị hoàn lại khi kết nối trở lại.
- M1 chưa có tài khoản và phân quyền người dùng. Mọi máy đã ghép có quyền ngang nhau, gồm tạo mã ghép
  và thu hồi máy khác.

## Số đo tham chiếu (đo trên máy dev)

Bundle và precache đo lại ở bản đang chạy (`a2c8d08`, 1.0.2 + giá sỉ Phase 1); LCP với Lighthouse vẫn là
số của 1.0.0 — chưa đo lại trên bản deploy mới, đừng đọc chúng như số của bản này.

| Hạng mục | Kết quả |
|---|---|
| Bundle (`a2c8d08`) | 544 KB thô · **164 KB gzip** (JS) + 5 KB gzip (CSS) |
| Precache của service worker (`a2c8d08`) | 17 file · 638 KB |
| LCP (1.0.0; Chrome, CPU ×4 + Slow 4G) | **464 ms** · CLS 0.00 |
| Lighthouse mobile (1.0.0) | Accessibility 100 · Best Practices 100 · SEO 91 |
| PWA installable | manifest hợp lệ (name, short_name, start_url, standalone, icon 192/512 + maskable) + service worker *activated* |

Kiểm trên chính `an-quynh.pages.dev` (8/8/2026): `/`, `/bao-cao`, `/don/1/phieu`,
`/manifest.webmanifest`, `/sw.js` — 50/50 lượt đều 200, manifest đúng `application/manifest+json`;
service worker *activated*, nắm quyền điều khiển sau lần reload đầu, precache 14 file.

Đo lại sau lần deploy 9/8/2026 (`a2c8d08`, deployment `2538bdb0`): `/bao-cao` mở thẳng trả 200 và render
màn Báo cáo; service worker *activated*, scope `/`, nắm quyền sau lần tải lại; manifest `standalone`,
`start_url: /`, 3 icon, không lỗi. Bundle trên mạng **trùng byte** với `dist/` đã qua cổng kiểm
(`sha256 b148b823…c389`, 556 597 byte) — dùng cách này để biết production đúng là bản đã test, thay vì
tin vào việc lệnh deploy chạy xong không báo lỗi. Kho dữ liệu dựng đúng schema mới: `my-biller@20`,
10 bảng, có `customerPrices`.

Trình duyệt báo 14 file trong cache còn `sw.js` khai 17 — chênh này có từ lần deploy trước, không phải
do bản này. Bài kiểm offline bên dưới vẫn chạy được, nên nó chưa cắn ai; ai đụng tới precache thì soi lại.

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
