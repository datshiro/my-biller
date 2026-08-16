const workerUrl = requiredUrl('WORKER_URL')
const releaseTag = requiredValue('RELEASE_TAG')

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

await checkedFetch('/shop', { method: 'POST' }, 401)
console.log(`Worker bootstrap smoke passed for ${releaseTag}.`)
