import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

const port = 5176
const roots = {
  normal: resolve('dist'),
  recovery: resolve('dist-recovery'),
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
  const switchMode = url.pathname.match(/^\/__test__\/mode\/(normal|recovery)$/)
  if (request.method === 'POST' && switchMode) {
    mode = switchMode[1]
    respond(response, 204, '')
    return
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    respond(response, 405, 'Method Not Allowed')
    return
  }

  const root = roots[mode]
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
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
