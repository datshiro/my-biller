// ESP32-S3 giả máy in nhiệt BLE để bắt phiếu GrabMerchant (iOS) rồi đẩy nhật ký ra cổng COM (UART).
// Mỗi sự kiện là một dòng, scripts/nghe-esp32.mjs đọc đúng định dạng này:
//   CONN <mac> | MTU <n> | SUB <char> | DATA <char> <base64> | DISC | DROP <n>
// Mở nhiều dịch vụ GATT cùng lúc vì chưa biết Grab tìm dịch vụ nào; dòng DATA cho biết nó ghi vào đâu.
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <freertos/FreeRTOS.h>
#include <freertos/message_buffer.h>
#include <mbedtls/base64.h>

#if !defined(CONFIG_NIMBLE_ENABLED)
#error "Firmware viết cho backend NimBLE của core esp32 3.x trên ESP32-S3; backend Bluedroid có chữ ký callback khác."
#endif

#define PRINTER_NAME "GCPS01-0001"
// Gói quảng bá chỉ vừa 31 byte: tên + một UUID 16-bit. Đổi dòng này nếu biết Grab lọc theo dịch vụ khác.
#define ADV_SERVICE_UUID "18F0"
#define BAUD 921600
#define LOG_BYTES (128 * 1024)
#define MAX_WRITE 512  // ATT cho ghi tối đa 512 byte một lần

static MessageBufferHandle_t logBuffer;
static volatile uint32_t dropped = 0;

// Callback BLE chạy trên task Bluetooth: không được chờ cổng serial, nên đẩy dòng vào bộ đệm rồi loop() mới in.
static void emit(const char* text, size_t length) {
  if (xMessageBufferSend(logBuffer, text, length, 0) != length) dropped++;
}

static void emitf(const char* format, ...) {
  char line[128];
  va_list args;
  va_start(args, format);
  int length = vsnprintf(line, sizeof line, format, args);
  va_end(args);
  if (length > 0) emit(line, min((size_t)length, sizeof line - 1));
}

static void emitData(const char* tag, const uint8_t* data, size_t length) {
  static char line[MAX_WRITE * 4 / 3 + 64];  // callback chạy tuần tự nên dùng chung được một bộ đệm
  if (length > MAX_WRITE) length = MAX_WRITE;
  int head = snprintf(line, sizeof line, "DATA %s ", tag);
  size_t written = 0;
  mbedtls_base64_encode((unsigned char*)line + head, sizeof line - head - 1, &written, data, length);
  line[head + written] = '\n';
  emit(line, head + written + 1);
}

class ServerEvents : public BLEServerCallbacks {
  void onConnect(BLEServer*, ble_gap_conn_desc* desc) override {
    const uint8_t* a = desc->peer_ota_addr.val;  // địa chỉ lưu từ byte thấp nhất, in ngược lại cho đúng cách đọc
    emitf("CONN %02X:%02X:%02X:%02X:%02X:%02X\n", a[5], a[4], a[3], a[2], a[1], a[0]);
  }
  void onMtuChanged(BLEServer*, ble_gap_conn_desc*, uint16_t mtu) override {
    emitf("MTU %u\n", mtu);
  }
  void onDisconnect(BLEServer*, ble_gap_conn_desc*) override {
    emit("DISC\n", 5);
    BLEDevice::startAdvertising();
  }
};

class Tap : public BLECharacteristicCallbacks {
 public:
  explicit Tap(const char* tag) : tag(tag) {}
  void onWrite(BLECharacteristic* characteristic, ble_gap_conn_desc*) override {
    emitData(tag, characteristic->getData(), characteristic->getLength());
  }
  void onSubscribe(BLECharacteristic*, ble_gap_conn_desc*, uint16_t subValue) override {
    if (subValue != 0) emitf("SUB %s\n", tag);
  }
 private:
  const char* tag;
};

// Một dịch vụ kiểu máy in: characteristic ghi (writeUuid) để máy gửi đẩy dữ liệu, characteristic thông báo
// (notifyUuid) để máy gửi đăng ký nhận trạng thái. Khi hai UUID trùng nhau thì chỉ có một characteristic.
static void addPrinterService(BLEServer* server, const char* tag, const char* serviceUuid,
                              const char* writeUuid, const char* notifyUuid) {
  BLEService* service = server->createService(serviceUuid);
  uint32_t writeProps = BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR;
  bool same = strcmp(writeUuid, notifyUuid) == 0;

  BLECharacteristic* write = service->createCharacteristic(
      writeUuid, same ? (writeProps | BLECharacteristic::PROPERTY_NOTIFY) : writeProps);
  write->setCallbacks(new Tap(tag));
  if (!same) {
    BLECharacteristic* notify = service->createCharacteristic(notifyUuid, BLECharacteristic::PROPERTY_NOTIFY);
    notify->setCallbacks(new Tap(tag));
  }
  service->start();
}

void setup() {
  Serial.begin(BAUD);
  logBuffer = xMessageBufferCreate(LOG_BYTES);

  BLEDevice::init(PRINTER_NAME);
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerEvents());

  addPrinterService(server, "18f0", "18F0", "2AF1", "2AF0");
  addPrinterService(server, "issc", "49535343-FE7D-4AE5-8FA9-9FAFD205E455",
                    "49535343-8841-43F4-A8D4-ECBE34729BB3", "49535343-1E4D-4BD9-BA61-23C647249616");
  addPrinterService(server, "e781", "E7810A71-73AE-499D-8C15-FAA9AEF0C3F2",
                    "BEF8D6C9-9C21-4C9E-B632-BD58C1009F9F", "BEF8D6C9-9C21-4C9E-B632-BD58C1009F9F");
  addPrinterService(server, "nus", "6E400001-B5A3-F393-E0A9-E50E24DCCA9E",
                    "6E400002-B5A3-F393-E0A9-E50E24DCCA9E", "6E400003-B5A3-F393-E0A9-E50E24DCCA9E");

  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(ADV_SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();

}

// Cổng USB gốc ngắt rồi nối lại khi board khởi động, nên một dòng READY lúc setup luôn bị lỡ: nhắc lại định kỳ.
void loop() {
  static char line[MAX_WRITE * 4 / 3 + 64];
  static uint32_t lastReady = 0;
  if (millis() - lastReady >= 10000) {
    lastReady = millis();
    Serial.println("READY " PRINTER_NAME);
  }
  size_t length = xMessageBufferReceive(logBuffer, line, sizeof line, pdMS_TO_TICKS(1000));
  if (length > 0) Serial.write((const uint8_t*)line, length);
  if (dropped > 0) {
    Serial.printf("DROP %u\n", dropped);
    dropped = 0;
  }
}
