// Giả vỏ APK cho Chrome thật: Capacitor coi trang là Android và gọi plugin qua cầu nối giả này, nên Robot
// lái được các nút chỉ có trong APK mà không cần máy Android. Không gì đi ra ngoài trình duyệt:
// - PrinterSocket: job in nằm lại ở `window.__printJobs` để ca kiểm đọc byte thật app định gửi.
// - DownloadFile: file "lưu vào Tải về" nằm lại ở `window.__savedFiles`; đặt `window.__failSave = true`
//   để giả plugin báo lỗi (hết chỗ, từ chối quyền). Đường MediaStore thật chỉ nghiệm được trên máy Android.
async function giaLapApk(context) {
  await context.addInitScript(() => {
    window.__printJobs = []
    window.__savedFiles = []
    window.__failSave = false
    window.androidBridge = { postMessage() {} }
    window.Capacitor = {
      PluginHeaders: [
        { name: 'PrinterSocket', methods: [{ name: 'printRaw', rtype: 'promise' }] },
        { name: 'DownloadFile', methods: [{ name: 'saveToDownloads', rtype: 'promise' }] },
      ],
      nativePromise: async (plugin, method, options) => {
        if (plugin === 'DownloadFile') {
          if (window.__failSave) throw new Error('Chưa lưu được file vào thư mục Tải về: bộ nhớ đầy (giả lập).')
          window.__savedFiles.push({ filename: options.filename, mimeType: options.mimeType, text: options.text })
          // Như MediaStore: trùng tên thì hệ thống tự đổi, app phải hiện tên thật nó trả về.
          const taken = window.__savedFiles.filter((file) => file.filename === options.filename).length
          const dot = options.filename.lastIndexOf('.')
          const displayName =
            taken === 1 ? options.filename : `${options.filename.slice(0, dot)} (${taken - 1})${options.filename.slice(dot)}`
          return { displayName, relativePath: 'Download/' }
        }
        window.__printJobs.push({ plugin, method, host: options.host, port: options.port, base64: options.base64 })
        return { sent: atob(options.base64).length }
      },
    }
  })
}

exports.__esModule = true
exports.giaLapApk = giaLapApk
