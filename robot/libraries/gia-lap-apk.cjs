// Giả vỏ APK cho Chrome thật: Capacitor coi trang là Android và gọi plugin PrinterSocket qua cầu nối
// giả này, nên Robot lái được các nút chỉ có trong APK (IN TEM) mà không cần máy Android. Job không đi
// ra mạng — nằm lại ở `window.__printJobs` để ca kiểm đọc byte thật app định gửi.
async function giaLapApk(context) {
  await context.addInitScript(() => {
    window.__printJobs = []
    window.androidBridge = { postMessage() {} }
    window.Capacitor = {
      PluginHeaders: [{ name: 'PrinterSocket', methods: [{ name: 'printRaw', rtype: 'promise' }] }],
      nativePromise: async (plugin, method, options) => {
        window.__printJobs.push({ plugin, method, host: options.host, port: options.port, base64: options.base64 })
        return { sent: atob(options.base64).length }
      },
    }
  })
}

exports.__esModule = true
exports.giaLapApk = giaLapApk
