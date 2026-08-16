# my-biller

App tính tiền cho quán ăn nhỏ. PWA offline-first: máy đã ghép dùng chung một sổ trên Cloudflare
Durable Object, còn mỗi máy giữ bản sao IndexedDB và hàng đợi để vẫn ghi được khi mạng chập chờn.
Máy chưa ghép chỉ có sổ cục bộ; file sao lưu độc lập vẫn là bắt buộc cho cả hai chế độ. Mọi quy ước
dưới đây bảo vệ các bản sao và đường đồng bộ đó.

## Quy ước: mỗi thay đổi phải kèm ca kiểm thử live

**Thêm hoặc sửa một tính năng / một hàm → sau khi làm xong, viết ca Robot mới cho nó và chạy lại hồi quy.**
Không tách sang "để sau", không gộp vào một lần dọn cuối phase.

Ba việc, theo thứ tự:

1. **Viết ca mới** trong `robot/tests/<màn>.robot` theo mẫu ở
   [`docs/kiem-thu-live.md`](docs/kiem-thu-live.md#mẫu-ca-mới). Ca nằm cùng suite của màn mà người bán
   chạm vào, không mở file mới cho mỗi thay đổi.
2. **Chạy hồi quy nhanh** trong lúc còn đang sửa: `npm run test:regression` (chỉ các ca chốt chặn).
3. **Chạy đủ cổng trước khi commit** — cả năm, không bỏ cái nào:

   ```bash
   npm run test        # Vitest
   npm run lint
   npm run build       # gồm tsc -b cho app, shared và Worker
   npm run test:e2e    # Playwright
   npm run test:live   # Robot, app thật trên Chrome thật
   ```

### Khi nào ca Robot là bắt buộc

Robot lái **giao diện thật**. Nên:

- Thay đổi **chạm tới được từ màn hình** (nút, ô nhập, con số hiện ra, file tải về, dữ liệu ghi xuống
  IndexedDB) → **bắt buộc** có ca Robot. Không có ngoại lệ vì "thay đổi nhỏ".
- Thay đổi **không có đường tới từ giao diện** (hàm thuần trong `src/domain/`, đường di trú DB, nhánh chỉ
  chạy khi dữ liệu hỏng) → Robot không lái tới được. Khi đó gate là ca Vitest, **và phải nói thẳng trong
  commit vì sao không có ca Robot**. Im lặng bỏ qua thì lần review sau không phân biệt được "không lái
  tới được" với "quên viết".

### Ca dính tới tiền

Giao diện hiện đúng mà sổ ghi sai là kiểu hỏng tệ nhất của app này. Ca nào động tới tiền, nợ, hoặc số
lượng thì **đối chiếu thêm bằng `Đọc Bảng`** (đọc thẳng IndexedDB) chứ đừng chỉ tin con số trên màn hình.

### Thẻ `regression`

Gắn `[Tags]    regression` cho ca **khoá lại một lỗi đã từng cắn**, không phải cho mọi ca mới. Suite đầy
đủ vẫn chạy hết; thẻ này để có một vòng nhanh trong lúc đang sửa. Ca gắn thẻ phải có `[Documentation]`
nói rõ lỗi cũ là gì — không thì người sau xoá nhầm vì tưởng trùng.

## Đừng bao giờ

- **Sửa `version(1)` trong `src/db/db.ts`.** Đổi schema là thêm `version(n+1).stores(...)`. Worker
  không thể migrate IndexedDB trên từng máy; sửa version cũ là phá dữ liệu trên máy đang chạy.
- **Commit file trong `plans/` hoặc `journals/`.** Đó là giấy nháp, không phải sản phẩm.
- **Stage kết xuất test** — `robot/results/`, `test-results/`, `coverage/`, ảnh chụp Playwright.

## Ghi chú

Tài liệu và commit message viết tiếng Việt, hợp với người đọc chúng.
Định dạng commit: `(<type>): <mô tả>` — `feat` `fix` `refactor` `perf` `docs` `test` `chore` `build` `ci` `revert`.
