const workerUrl = requiredUrl('WORKER_URL')
const shopId = requiredValue('PRODUCTION_SMOKE_SHOP_ID')
const deviceToken = requiredValue('PRODUCTION_SMOKE_DEVICE_TOKEN')
const releaseTag = requiredValue('RELEASE_TAG')

if (!/^[0-9a-f-]{36}$/i.test(shopId)) {
  throw new Error('PRODUCTION_SMOKE_SHOP_ID không phải UUID hợp lệ.')
}

const authorization = `Bearer ${deviceToken}`

function requiredValue(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Thiếu biến ${name}.`)
  return value
}

function requiredUrl(name) {
  const value = new URL(requiredValue(name))
  if (value.protocol !== 'https:') throw new Error(`${name} phải dùng HTTPS.`)
  return value.toString().replace(/\/$/, '')
}

async function checkedFetch(path, init, expectedStatus) {
  const response = await fetch(`${workerUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status !== expectedStatus) {
    throw new Error(`${init?.method ?? 'GET'} ${path} trả HTTP ${response.status}, cần ${expectedStatus}.`)
  }
  return response
}

async function checkHttpContract() {
  const health = await checkedFetch('/health', undefined, 200)
  const healthBody = await health.json().catch(() => null)
  if (healthBody?.status !== 'ok') throw new Error('Worker health không trả status=ok.')

  const preflight = await checkedFetch(
    '/shop',
    {
      method: 'OPTIONS',
      headers: {
        origin: 'https://an-quynh.pages.dev',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    },
    204,
  )
  if (preflight.headers.get('access-control-allow-origin') !== '*') {
    throw new Error('Worker CORS không cho phép production origin.')
  }

  await checkedFetch(
    `/shop/${shopId}/epoch`,
    {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ epoch: Date.now() }),
    },
    200,
  )

  const devices = await checkedFetch(
    `/shop/${shopId}/devices`,
    { headers: { authorization } },
    200,
  )
  const devicesBody = await devices.json().catch(() => null)
  if (!Array.isArray(devicesBody?.devices) || devicesBody.devices.length === 0) {
    throw new Error('Synthetic shop không đọc lại được danh sách thiết bị.')
  }
  if (typeof devicesBody.latestSeq !== 'number') {
    throw new Error('Worker production chưa trả latestSeq — deploy Worker mới trước khi deploy Pages.')
  }

  const oplog = await checkedFetch(
    `/shop/${shopId}/oplog?since=0`,
    { headers: { authorization } },
    200,
  )
  const oplogBody = await oplog.json().catch(() => null)
  if (!Array.isArray(oplogBody?.events)) throw new Error('Synthetic shop không đọc lại được oplog.')
}

async function checkWebSocketContract() {
  const socketUrl = new URL(`${workerUrl}/shop/${shopId}/ws`)
  socketUrl.protocol = 'wss:'

  await new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl, ['my-biller', deviceToken])
    const timeout = setTimeout(() => {
      socket.close()
      reject(new Error('WebSocket production không trả pong trong 10 giây.'))
    }, 10_000)

    socket.addEventListener('open', () => socket.send('ping'))
    socket.addEventListener('message', (event) => {
      if (event.data !== 'pong') return
      clearTimeout(timeout)
      socket.close(1000, 'release smoke complete')
      resolve()
    })
    socket.addEventListener('error', () => {
      clearTimeout(timeout)
      reject(new Error('Không mở được WebSocket production.'))
    })
  })
}

await checkHttpContract()
await checkWebSocketContract()
console.log(`Worker production smoke passed for ${releaseTag}.`)
