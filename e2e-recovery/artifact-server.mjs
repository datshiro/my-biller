import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

const port = 5176
const roots = {
  normal: resolve('dist'),
  recovery: resolve('dist-recovery'),
  // Bản staging ghi ra thư mục riêng: hash bundle và sw.js khác bản normal, đủ để trình duyệt coi là
  // "bản mới" khi test đường cập nhật; mạng ra Worker bị chặn trong test nên URL staging vô hại.
  next: resolve('dist-next'),
}
let mode = 'recovery'

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
}

function respond(response, status, body, headers = {}) {
  response.writeHead(status, headers)
  response.end(body)
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
  const switchMode = url.pathname.match(/^\/__test__\/mode\/(normal|recovery|next|mat-mang)$/)
  if (request.method === 'POST' && switchMode) {
    mode = switchMode[1]
    respond(response, 204, '')
    return
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    respond(response, 405, 'Method Not Allowed')
    return
  }

  // `mat-mang`: vẫn phục vụ bản normal nhưng `sw.js` trả 503, để `registration.update()` reject như
  // lúc mất mạng. Phải giả ở server vì `context.setOffline` của Playwright không chặn được cú tải
  // `sw.js` do chính trình duyệt phát khi kiểm cập nhật.
  const root = roots[mode === 'mat-mang' ? 'normal' : mode]
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
  if (mode === 'mat-mang' && relative === 'sw.js') {
    respond(response, 503, 'Service Unavailable')
    return
  }
  let file = resolve(root, relative)
  if (file !== root && !file.startsWith(`${root}${sep}`)) {
    respond(response, 403, 'Forbidden')
    return
  }
  try {
    if (!(await stat(file)).isFile()) file = resolve(root, 'index.html')
  } catch {
    if (request.headers.accept?.includes('text/html')) file = resolve(root, 'index.html')
    else {
      respond(response, 404, 'Not Found')
      return
    }
  }

  try {
    const body = await readFile(file)
    const headers = {
      'content-type': contentTypes[extname(file)] ?? 'application/octet-stream',
      'cache-control': file.endsWith(`${sep}sw.js`) ? 'no-store' : 'no-cache',
    }
    respond(response, 200, request.method === 'HEAD' ? '' : body, headers)
  } catch {
    respond(response, 404, 'Not Found')
  }
})

server.listen(port, '127.0.0.1')
const stop = () => server.close(() => process.exit(0))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
