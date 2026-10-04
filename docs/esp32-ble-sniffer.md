# ESP32-S3 giả máy in BLE để bắt phiếu Grab

Mục đích: biết GrabMerchant trên iPhone có nhận ESP32 là máy in không, nó ghi vào characteristic nào, và gửi
**chữ** hay **ảnh**. Chưa lưu gì vào app — chỉ bắt byte và xem.

```
iPhone · GrabMerchant ──BLE──▶ ESP32-S3 "GCPS01-0001" ──USB (cổng COM)──▶ Mac: scripts/nghe-esp32.mjs
                                                                              ├─ captures/*.bin
                                                                              └─ tóm tắt: chữ hay ảnh
```

Firmware: [`firmware/esp32-ble-sniffer/esp32-ble-sniffer.ino`](../firmware/esp32-ble-sniffer/esp32-ble-sniffer.ino).
Board: ESP32-S3-N16R8 (flash 16MB, PSRAM octal). Core `esp32:esp32` 3.x, backend NimBLE.

## Nạp firmware

```bash
brew install arduino-cli
arduino-cli core install esp32:esp32
FQBN=esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,CDCOnBoot=default
arduino-cli compile --fqbn $FQBN firmware/esp32-ble-sniffer
arduino-cli upload  --fqbn $FQBN -p /dev/cu.usbserial-XXXX firmware/esp32-ble-sniffer
```

Board có **hai cổng Type-C**. Cắm vào cổng ghi **COM** (UART) — dùng cổng này cho cả nạp lẫn đọc nhật ký. Tên cổng
xem bằng `arduino-cli board list`. Nếu nạp báo không kết nối được: giữ nút `BOOT`, bấm `RST`, thả `BOOT`, rồi nạp lại.

## Xem phiếu bắt được

```bash
node scripts/nghe-esp32.mjs /dev/cu.usbserial-XXXX
```

Mỗi lần in ra một file `captures/grab-<ngày-giờ>-<số>.bin` (thư mục này không vào git: phiếu thật có tên và số
điện thoại khách) kèm tóm tắt:

```
✓ nối: AA:BB:CC:DD:EE:FF
▸ job #1  2314 byte  qua 18f0/2af1  → captures/grab-261004-1210-01.bin
  chữ : 'GF-085', 'Cơm tấm sườn x2', '90.000'
  lệnh: ESC @, ESC a, cắt giấy
```

Đọc kết quả:

| Thấy | Nghĩa |
|---|---|
| Không có `✓ nối` sau khi bấm in | iPhone không nhận ESP32 là máy in. Thử đổi `ADV_SERVICE_UUID` hoặc `PRINTER_NAME` trong firmware rồi nạp lại. |
| Có `✓ nối`, có `Grab đăng ký nhận thông báo`, không có `job` | Grab nối nhưng không ghi dữ liệu — có thể đang chờ phản hồi trạng thái mà firmware chưa trả. |
| `job` có dòng `ảnh : raster …` | Grab gửi ảnh phiếu, không đọc được chữ từ byte. |
| `job` có dòng `chữ : …` | Grab gửi chữ — đọc được món và giá. |
| `[KHÔNG phải UTF-8]` | Chữ dùng bảng mã khác; file `.bin` vẫn giữ nguyên byte để phân tích. |

Mỗi lần in được tính từ lúc nối tới lúc ngắt, hoặc khi im quá 2 giây (Grab có thể giữ kết nối giữa các lần in).

## Tự thử không cần Grab

Dùng nRF Connect trên iPhone: nối vào `GCPS01-0001`, ghi vài byte (kiểu hex) vào một characteristic ghi được, rồi
kiểm tra `captures/*.bin` khớp đúng byte đã ghi. Script cũng đọc được một file nhật ký đã lưu
(`node scripts/nghe-esp32.mjs nhat-ky.log`) — định dạng dòng: `CONN`, `MTU`, `SUB`, `DATA <char> <base64>`, `DISC`.

iOS nhớ danh sách dịch vụ của thiết bị đã nối. Sau mỗi lần nạp firmware có đổi dịch vụ, tắt rồi bật Bluetooth
trên iPhone (hoặc quên thiết bị) trước khi thử lại, kẻo tưởng firmware hỏng.
