// Giả vỏ APK cho Chrome thật: Capacitor coi trang là Android và gọi plugin qua cầu nối giả này, nên Robot
// lái được các nút chỉ có trong APK mà không cần máy Android. Không gì đi ra ngoài trình duyệt:
// - PrinterSocket: job in nằm lại ở `window.__printJobs` để ca kiểm đọc byte thật app định gửi.
// - DownloadFile: file "lưu vào Tải về" nằm lại ở `window.__savedFiles`; đặt `window.__failSave = true`
//   để giả plugin báo lỗi (hết chỗ, từ chối quyền). Đường MediaStore thật chỉ nghiệm được trên máy Android.
// - App (phím Back): `window.__bamBack()` bấm Back cho mọi listener `backButton` đang đăng ký và trả số
//   listener đã gọi. `window.__backHandlerEnabled` là cờ handler mặc định của plugin, còn `window.__appMinimized`
//   đếm lần app bị thu xuống nền — đúng việc Android làm khi Back ở tab gốc.
async function giaLapApk(context) {
  await context.addInitScript(() => {
    window.__printJobs = []
    window.__savedFiles = []
    window.__failSave = false
    window.__backHandlerEnabled = false
    window.__appMinimized = 0
    window.__backListeners = new Map()
    window.__nextBackListenerId = 1
    window.__bamBack = () => {
      const listeners = [...window.__backListeners.values()]
      for (const listener of listeners) listener({ canGoBack: window.history.length > 1 })
      return listeners.length
    }
    window.androidBridge = { postMessage() {} }
    window.Capacitor = {
      PluginHeaders: [
        { name: 'PrinterSocket', methods: [{ name: 'printRaw', rtype: 'promise' }] },
        { name: 'DownloadFile', methods: [{ name: 'saveToDownloads', rtype: 'promise' }] },
        {
          name: 'App',
          methods: [
            { name: 'addListener', rtype: 'none' },
            { name: 'removeListener', rtype: 'none' },
            { name: 'removeAllListeners', rtype: 'promise' },
            { name: 'exitApp', rtype: 'promise' },
            { name: 'minimizeApp', rtype: 'promise' },
            { name: 'toggleBackButtonHandler', rtype: 'promise' },
          ],
        },
      ],
      nativeCallback: (plugin, method, options, callback) => {
        if (plugin === 'App' && method === 'addListener' && options.eventName === 'backButton') {
          const callbackId = String(window.__nextBackListenerId++)
          window.__backListeners.set(callbackId, callback)
          return callbackId
        }
        if (plugin === 'App' && method === 'removeListener') {
          window.__backListeners.delete(options.callbackId)
          return undefined
        }
        throw new Error('gia-lap-apk: chưa giả ' + plugin + '.' + method)
      },
      nativePromise: async (plugin, method, options) => {
        if (plugin === 'App') {
          if (method === 'toggleBackButtonHandler') {
            window.__backHandlerEnabled = options.enabled
            return undefined
          }
          if (method === 'minimizeApp') {
            window.__appMinimized += 1
            return undefined
          }
          if (method === 'removeAllListeners') {
            window.__backListeners.clear()
            return undefined
          }
          throw new Error('gia-lap-apk: chưa giả ' + plugin + '.' + method)
        }
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
