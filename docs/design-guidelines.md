# Design Guidelines — my-biller

Status: approved · Date: 2026-08-06
Hướng: **thực dụng, nút to, tương phản cao** — dùng 1 tay, đọc được ngoài nắng, bấm nhanh khi đông khách.
Wireframe: `docs/wireframe/index.html`

## Nguyên tắc

1. **Số tiền là nhân vật chính.** Tổng tiền luôn là chữ lớn nhất trên màn.
2. **Hành động chính nằm trong vùng ngón tay** — đáy màn hình, cao 56px, full width.
3. **Không trang trí.** Không gradient, không shadow trang trí, không icon-only cho hành động quan trọng (luôn có chữ).
4. **Mọi thao tác bán hàng ≤ 3 chạm.** Chọn hàng → thu tiền → xuất phiếu.
5. **Trạng thái tiền phải phân biệt bằng màu + chữ**, không chỉ màu (người mù màu vẫn đọc được: "Đã thu" / "Còn nợ").

## Font

**Be Vietnam Pro** (Google Fonts) — thiết kế riêng cho tiếng Việt, dấu không bị chồng ở chữ hoa.
Self-host, subset `vietnamese` + `latin`. Weight dùng: **400, 600, 700** (không tải weight khác).
Số tiền bắt buộc `font-variant-numeric: tabular-nums` để cột số thẳng hàng.
Fallback: `system-ui, -apple-system, "Segoe UI", sans-serif`.

## Màu (token)

| Token | Hex | Dùng cho | Contrast trên trắng |
|---|---|---|---|
| `--bg` | `#FFFFFF` | nền màn | — |
| `--surface` | `#F4F6F8` | nền card, input | — |
| `--border` | `#DCE1E7` | viền, đường kẻ | — |
| `--text` | `#14181D` | chữ chính | 16.4:1 |
| `--text-muted` | `#5A6673` | chữ phụ, nhãn | 5.9:1 ✓AA |
| `--text-faint` | `#8A949F` | placeholder, timestamp | 3.1:1 — **chỉ chữ ≥18px** |
| `--brand` | `#0B7A42` | CTA chính, doanh thu, "Đã thu" | 5.5:1 ✓AA (chữ trắng) |
| `--brand-press` | `#085F33` | trạng thái nhấn | — |
| `--brand-tint` | `#E6F4EC` | nền chip/badge xanh | — |
| `--danger` | `#C0271A` | chi phí, xóa | 5.9:1 ✓AA |
| `--danger-tint` | `#FBEAE8` | nền chip đỏ | — |
| `--warn` | `#A85B00` | "Còn nợ", chưa thanh toán | 5.0:1 ✓AA |
| `--warn-tint` | `#FDF1E1` | nền chip vàng | — |

Chỉ **1 màu nhấn** (`--brand`). Đỏ/vàng chỉ dùng cho trạng thái tiền, không dùng làm màu thương hiệu.
**v1 chỉ light mode.** Dark mode để phase sau (bán hàng ban ngày, ưu tiên tương phản dưới nắng).

## Type scale

| Tên | Size / Weight | Dùng |
|---|---|---|
| `money-xl` | 34 / 700 tabular | tổng tiền ở thanh CTA, doanh thu báo cáo |
| `money-lg` | 24 / 700 tabular | tổng phiếu, số nợ |
| `h1` | 20 / 700 | tiêu đề màn |
| `h2` | 17 / 600 | tiêu đề nhóm, tên mặt hàng |
| `body` | 15 / 400 | nội dung |
| `body-strong` | 15 / 600 | số tiền trong danh sách |
| `small` | 13 / 400 | chú thích, giờ |
| `label` | 11 / 700 uppercase, tracking .06em | nhãn cột, nhãn nhóm |

Line-height: 1.35 cho tiêu đề, 1.5 cho nội dung. Tiếng Việt có dấu 2 tầng → **không dùng line-height < 1.3**.

## Kích thước & khoảng cách

- Spacing scale: `4 · 8 · 12 · 16 · 20 · 24 · 32` (Tailwind mặc định).
- **Vùng chạm tối thiểu 48×48px.** CTA chính **56px**. Ô số (numpad, stepper) **56×56**.
- Ô mặt hàng trong grid: cao ≥ 72px, 3 cột trên máy ≥360px, 2 cột nếu < 340px.
- Radius: nút `12` · card `14` · bottom sheet `20 20 0 0` · chip `999`.
- Padding màn: `16` ngang. Danh sách: mỗi dòng padding `12 16`.
- Bottom nav + CTA phải cộng `env(safe-area-inset-bottom)`.
- Không shadow trang trí. Chỉ: bottom nav `border-top 1px`, bottom sheet `0 -8px 24px rgba(0,0,0,.12)`.

## Điều hướng

Bottom tab 5 mục: **Bán · Đơn · Chi phí · Báo cáo · Thêm**

- `Bán` — màn tạo đơn (home).
- `Đơn` — lịch sử đơn/phiếu, mở lại để chia sẻ.
- `Chi phí` — ghi & xem chi phí (hành động ghi hằng ngày → xứng đáng 1 tab).
- `Báo cáo` — doanh thu/chi phí/lãi gộp + biểu đồ + **card công nợ** dẫn sang màn Công nợ.
- `Thêm` — Mặt hàng, Khách hàng, Công nợ, Sao lưu, Cài đặt.

**Trade-off đã cân:** Công nợ *không* có tab riêng vì đó là việc đọc/thu định kỳ, vào từ Báo cáo hoặc trang khách hàng. Chi phí có tab vì là việc *ghi* mỗi ngày. Nếu bạn thu nợ nhiều hơn ghi chi phí → đổi 2 tab này cho nhau.

Nút back Android phải hoạt động ở mọi màn (dùng `react-router`, không dùng state để đổi màn).

## Quy ước hiển thị số & ngày

- Tiền: `1.250.000 đ` — dấu `.` phân nhóm nghìn, đơn vị `đ` viết thường, cách 1 space. Không hiện `,00`.
- Nhập tiền: cho gõ tắt `50k` → `50.000`. Hiện định dạng ngay khi gõ.
- Ngày: `06/08/2026` · giờ `14:32` · nhóm danh sách dùng `Hôm nay` / `Hôm qua` / `06/08`.
- Số lượng thập phân (0,5 kg) dùng dấu phẩy.
- Số âm (lỗ) hiện `-120.000 đ` màu `--danger`, không dùng ngoặc đơn.

## Trạng thái bắt buộc thiết kế

Mỗi màn danh sách phải có: **loading** (skeleton), **empty** (câu hướng dẫn + nút hành động), **error khi ghi DB**.
Empty state phải nói việc cần làm, ví dụ màn Mặt hàng trống → "Chưa có mặt hàng nào. Thêm mặt hàng để bán nhanh hơn." + nút "＋ Thêm mặt hàng".

## Riêng cho app offline

- Banner nhắc sao lưu khi > 7 ngày chưa backup (dismiss được, quay lại sau 24h).
- Màn Cài đặt hiện: lần sao lưu gần nhất, trạng thái "Bộ nhớ đã được ghim" (`navigator.storage.persist()`), dung lượng đang dùng.
- Không có spinner "đang đồng bộ" — app không có server, đừng làm user tưởng có.
