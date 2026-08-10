# Đồng bộ sổ chung

M1 dùng một Cloudflare Durable Object SQLite cho mỗi quán làm nguồn sự thật. Mỗi máy đã ghép giữ một
bản sao IndexedDB để giao diện phản ứng nhanh và một `outbox` để không mất thao tác khi mạng chập
chờn. Mọi máy đã ghép ngang quyền; tài khoản người dùng và vai trò chủ/nhân viên chưa nằm trong M1.

## Ranh giới dữ liệu

- Chín bảng sổ và `settings` được đồng bộ. Bản ghi sổ giữ khoá số cục bộ để Dexie tương thích, đồng
  thời có `gid` UUID dùng trên đường truyền.
- `deviceState` chứa danh tính, token, con trỏ, lease và thông báo của riêng máy. Bảng này không đi
  vào file sao lưu, không bị nhập file ghi đè và không bị lệnh xoá sổ làm mất.
- `outbox` là hàng đợi bền vững của máy. File sao lưu không mang hàng đợi sang máy khác; thao tác kéo
  lại từ đầu chỉ được chạy khi hàng đợi rỗng.
- Nhập file ghi đè hoặc xoá sổ chỉ dành cho máy offline chưa ghép. Chốt cuối đọc lại `connection`,
  pairing pending và marker `writeBlock=revoked` trong cùng transaction Dexie giữ ledger,
  `deviceState` và `outbox`; một pre-check đã cũ không thể chạy đua với ghép máy rồi ghi đè sổ vừa
  được stage.
- Khoản thu giữ `orderId` là nguồn phát sinh và `allocatedOrderId` là đơn đang nhận tiền. Giá trị `0`
  nghĩa là tiền đã được ghi nhận nhưng đang chờ đối soát; không được xoá phiếu thu để làm hết cảnh báo.

## Đường ghi và đọc

1. Repository chạy trong `syncTransaction`; hook Dexie ghi ảnh `before`/`after`, quan hệ cha bằng
   `gid`, `eventId`, `txId` và thứ tự vào `outbox` cùng transaction với thay đổi nghiệp vụ.
2. Một tab giữ lease trong IndexedDB, tăng `epoch` khi tiếp quản và claim epoch đó trên Durable
   Object. Chỉ tab còn đúng cả owner lẫn epoch được đẩy hoặc áp dữ liệu.
3. Pusher gửi tuần tự để giữ cha trước con. Durable Object suy `deviceId` từ token, kiểm epoch và bất
   biến tiền, đóng dấu thời gian tạo rồi ghi ledger + oplog trong một transaction SQLite ngắn.
4. Durable Object cấp `seq` tăng dần và báo WebSocket như một tín hiệu “có dữ liệu mới”. Puller vẫn
   đọc oplog theo con trỏ; WebSocket không mang bản ghi tài chính làm nguồn sự thật.
5. Applier đổi `gid` quan hệ về id cục bộ rồi ghi cả batch và `lastSeq` trong một transaction Dexie.
   Áp lại một `seq` đã thấy là no-op. Bốn màn truy vấn theo khoảng nghe thêm sync revision để không
   bỏ qua bản ghi nằm ngoài khoảng IndexedDB đang theo dõi.

Đường trên dành cho máy đã kích hoạt. Lần nạp sổ đầu tiên khi ghép máy dùng admission nguyên tử riêng,
không đẩy từng event qua pusher.

## Ghép máy và nạp sổ ban đầu

- Mỗi lần `POST /pair` được chấp nhận đều tạo một reservation pending trong 2 phút, kể cả máy không
  có dữ liệu. Trong thời gian đó không lượt ghép nào khác được dùng mã đồng thời. Mã chỉ được đánh
  dấu đã dùng sau khi kích hoạt thành công: seed lỗi có thể thử lại khi pending còn hạn; pending bị
  thu hồi hoặc hết hạn không tiêu mã, nên có thể ghép lại nếu mã vẫn còn trong TTL 5 phút ban đầu.
- Trước khi gọi Worker, client đặt pairing lock để chặn mọi `syncTransaction`. Khi lưu token và danh
  tính máy, client chụp toàn bộ sổ cục bộ vào `outbox` trong cùng một transaction Dexie; số dòng phải
  khớp với lúc bắt đầu ghép. Khóa ghi được giữ đến khi activation hoàn tất.
- Token pending không dùng được các route của máy đã kích hoạt. Client gửi toàn bộ snapshot một lần
  qua `POST /seed`; Durable Object kiểm số dòng, quan hệ `refs`, bất biến nghiệp vụ và promote cả
  ledger + oplog + trạng thái máy trong một transaction SQLite duy nhất của DO. Một event lỗi làm
  toàn bộ snapshot bị từ chối, không công bố phần đã hợp lệ.
- Nếu response thành công bị mất, client gửi lại cùng snapshot; máy đã được promote trả kết quả kích
  hoạt hiện tại mà không ghi lại event. Pending có dữ liệu tạm trả `seed-in-progress` cho đường ghi
  của các máy đang hoạt động để không xen thay đổi vào lúc promote; pending rỗng không cần chặn ghi.
- Thu hồi hoặc hết hạn pending chỉ xoá reservation và máy tạm. Vì chưa có dữ liệu nào được publish
  ngoài transaction activation, các đường này không để lại ledger hoặc oplog seed dở dang.
- Nếu cả sổ cục bộ lẫn Durable Object đã có dữ liệu, Worker trả `merge-required`; phải đối soát hai
  sổ, không tự seed hoặc ghi đè một bên.

## Idempotency và từ chối

- `eventId` chống gửi lại cùng một thao tác sau lỗi mạng. `gid` chống tạo lại cùng một thực thể;
  `seq` là thứ tự duy nhất do máy chủ cấp. Không dùng thời gian máy bán để phân xử thứ tự.
- Worker yêu cầu danh tính bản ghi khớp chính xác. Với bảng sổ thường,
  `entityKey = entityGid = gid` trong ảnh `before`/`after` tương ứng; với `settings`, `entityGid` phải
  là `null`, `entityKey` chỉ là `shop` hoặc `app` và phải khớp trường `key` của payload. Sai lệch bị
  từ chối trước khi ghi ledger/oplog.
- Với route ghi đã xác thực, kết quả kiểm token ban đầu không đủ để commit: Durable Object tra lại máy
  vẫn chưa bị thu hồi ngay trong transaction ghi. Thu hồi xảy ra khi request còn đang đọc body hoặc
  băm dữ liệu vì vậy không thể công bố event hay tạo mã ghép mới.
- Trạng thái tiền của đơn là dữ liệu máy chủ suy ra: `paidAmount` và `status` được dựng từ các phiếu
  thu canonical đang phân bổ, không tin giá trị hai trường này do máy bán gửi lên.
- Sau khi tạo phiếu thu, `amount`, `method`, `note` và quan hệ gốc tới đơn/khách là bất biến; chỉ nơi
  phân bổ cùng trạng thái/lý do xử lý khoản chưa gắn được phép đổi. Không được phân bổ vào đơn đã
  `void`.
- Xoá đơn hoặc phiếu thu luôn bị từ chối. Với các bảng khác, xoá bản ghi cha cũng bị từ chối khi còn
  bản ghi con tham chiếu; phải gỡ liên kết trước thay vì để lại khoá ngoại mồ côi.
- Khi máy chủ từ chối nghiệp vụ, pusher hoàn lại nhóm bị từ chối và các nhóm sau nó theo thứ tự
  ngược, nhưng chỉ khi dữ liệu hiện tại còn khớp ảnh `after`. Nếu đã có ghi chồng, app giữ dữ liệu và
  đặt `resyncRequired` thay vì đoán.
- Phiếu thu được tạo ở trạng thái chưa phân bổ trước. Nếu bước phân bổ bị từ chối vì số nợ đã đổi,
  tiền vẫn còn trong oplog và UI buộc người bán gắn vào đơn phù hợp, ghi hoàn tiền hoặc loại với lý do.
- Token bị thu hồi làm request kế tiếp trả 401 và đóng WebSocket đang mở. Máy ghi marker
  `writeBlock=revoked` trong `deviceState`, bỏ connection cũ và chặn mọi `syncTransaction` để không
  âm thầm tạo một nhánh sổ cục bộ. Khi ghép lại sau thu hồi, app xoá bản sao sổ và `outbox` cũ, đưa
  con trỏ về `lastSeq=0`, bỏ lease cũ rồi mới xoá marker/thông báo để kéo lại sổ theo token mới.

## Sửa lớp đồng bộ an toàn

- Hợp đồng sự kiện nằm ở `shared/sync-events.ts`; đổi schema phải cập nhật cả PWA, Worker và test.
- Mọi đường ghi bảng sổ phải đi qua repository + `syncTransaction`; không import `db` trực tiếp từ
  `src/features/**` và không thêm `eslint-disable` để vượt ranh giới này.
- Thêm bảng hoặc quan hệ phải xác định thứ tự seed, ánh xạ `refs`, validation ở Worker, rollback và
  backup. Thêm truy vấn Dexie theo khoảng phải nối sync revision.
- Chạy tối thiểu `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`,
  `npm run test:e2e` và suite Robot hai máy trước khi merge.

## Vận hành

Worker production dùng domain miễn phí `my-biller-sync.datshiro.workers.dev`; domain riêng để sau.
`ADMIN_SECRET` là secret phía Worker, chỉ operator dùng để tạo quán đầu tiên. Xem
[`deploy.md`](./deploy.md) để deploy và [`kiem-thu-live.md`](./kiem-thu-live.md) để chạy diễn tập hai
máy. Không đưa token, mã ghép hay secret vào log, ảnh lỗi hoặc file sao lưu.
