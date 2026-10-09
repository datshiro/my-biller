// Điền bù chỉ mục sổ của khu admin: liệt kê mọi Durable Object `ShopDO` có dữ liệu qua API Cloudflare rồi gửi
// từng lô id tới `POST /admin/index/reconcile`. Chạy lại bao nhiêu lần cũng được: sổ đã có chỉ bị đếm là
// `alreadyIndexed`. Script không bao giờ in token, secret hay account id; lỗi chỉ nêu tên biến và mã HTTP.

const REQUIRED = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'WORKER_URL', 'ADMIN_SECRET', 'SCRIPT_NAME']
const ALLOWED_HOSTS = ['my-biller-sync.datshiro.workers.dev', 'my-biller-sync-staging.datshiro.workers.dev']
const ALLOWED_SCRIPTS = ['my-biller-sync', 'my-biller-sync-staging']
const RECONCILE_BATCH = 20
const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4'

/** Lỗi có thông điệp do script tự soạn, chắc chắn không chứa giá trị biến môi trường. */
class ScriptError extends Error {}

function requiredValue(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new ScriptError(`Thiếu biến ${name}.`)
  return value
}

function requiredUrl(name) {
  let value
  try {
    value = new URL(requiredValue(name))
  } catch (error) {
    if (error instanceof ScriptError) throw error
    throw new ScriptError(`${name} không phải URL hợp lệ.`)
  }
  if (value.protocol !== 'https:') throw new ScriptError(`${name} phải dùng HTTPS.`)
  return value
}

function readConfig() {
  const missing = REQUIRED.filter((name) => !process.env[name]?.trim())
  if (missing.length > 0) throw new ScriptError(`Thiếu biến: ${missing.join(', ')}.`)

  const workerUrl = requiredUrl('WORKER_URL')
  if (!ALLOWED_HOSTS.includes(workerUrl.hostname)) {
    throw new ScriptError(`WORKER_URL phải là một trong: ${ALLOWED_HOSTS.join(', ')}.`)
  }
  const scriptName = requiredValue('SCRIPT_NAME')
  if (!ALLOWED_SCRIPTS.includes(scriptName)) {
    throw new ScriptError(`SCRIPT_NAME phải là một trong: ${ALLOWED_SCRIPTS.join(', ')}.`)
  }

  return {
    token: requiredValue('CLOUDFLARE_API_TOKEN'),
    accountId: requiredValue('CLOUDFLARE_ACCOUNT_ID'),
    adminSecret: requiredValue('ADMIN_SECRET'),
    workerOrigin: workerUrl.origin,
    scriptName,
    dryRun: process.env.DRY_RUN === '1',
  }
}

async function cloudflareGet(config, path, label) {
  const response = await fetch(`${CLOUDFLARE_API}/accounts/${encodeURIComponent(config.accountId)}${path}`, {
    headers: { authorization: `Bearer ${config.token}` },
    signal: AbortSignal.timeout(30_000),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.success !== true || !Array.isArray(body.result)) {
    throw new ScriptError(`API Cloudflare (${label}) trả HTTP ${response.status}.`)
  }
  return body
}

async function findShopNamespace(config) {
  const namespaces = []
  for (let page = 1; ; page += 1) {
    const body = await cloudflareGet(config, `/workers/durable_objects/namespaces?page=${page}&per_page=100`, 'namespaces')
    namespaces.push(...body.result)
    const totalPages = Number(body.result_info?.total_pages) || 1
    if (body.result.length === 0 || page >= totalPages) break
  }
  const matches = namespaces.filter((item) => item?.class === 'ShopDO' && item?.script === config.scriptName)
  if (matches.length !== 1) {
    throw new ScriptError(`Cần đúng một namespace ShopDO của ${config.scriptName}, tìm thấy ${matches.length}.`)
  }
  return matches[0].id
}

async function listStoredObjectIds(config, namespaceId) {
  const ids = []
  let cursor = ''
  for (;;) {
    const query = new URLSearchParams({ limit: '1000' })
    if (cursor) query.set('cursor', cursor)
    const body = await cloudflareGet(
      config,
      `/workers/durable_objects/namespaces/${encodeURIComponent(namespaceId)}/objects?${query}`,
      'objects',
    )
    for (const item of body.result) {
      if (item?.hasStoredData === true && typeof item.id === 'string') ids.push(item.id)
    }
    cursor = typeof body.result_info?.cursor === 'string' ? body.result_info.cursor : ''
    if (!cursor || body.result.length === 0) return ids
  }
}

async function reconcileBatch(config, ids) {
  const response = await fetch(`${config.workerOrigin}/admin/index/reconcile`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.adminSecret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ids }),
    signal: AbortSignal.timeout(60_000),
  })
  const body = await response.json().catch(() => null)
  if (
    response.status !== 200 ||
    typeof body?.registered !== 'number' ||
    typeof body?.alreadyIndexed !== 'number' ||
    !Array.isArray(body?.skipped)
  ) {
    throw new ScriptError(`POST /admin/index/reconcile trả HTTP ${response.status}.`)
  }
  return body
}

async function main() {
  const config = readConfig()
  const namespaceId = await findShopNamespace(config)
  const ids = await listStoredObjectIds(config, namespaceId)
  console.log(`listed: ${ids.length}`)
  if (config.dryRun) return

  const total = { registered: 0, alreadyIndexed: 0, skipped: [] }
  for (let start = 0; start < ids.length; start += RECONCILE_BATCH) {
    const result = await reconcileBatch(config, ids.slice(start, start + RECONCILE_BATCH))
    total.registered += result.registered
    total.alreadyIndexed += result.alreadyIndexed
    total.skipped.push(...result.skipped)
  }
  console.log(`registered: ${total.registered}`)
  console.log(`alreadyIndexed: ${total.alreadyIndexed}`)
  console.log(`skipped: ${total.skipped.length}`)
  for (const item of total.skipped) console.log(`  ${item.id} ${item.reason}`)
}

try {
  await main()
} catch (error) {
  // Chỉ in thông điệp do script tự soạn; lỗi mạng của Node có thể kèm URL chứa account id.
  const message = error instanceof ScriptError ? error.message : 'Lỗi mạng hoặc hết thời gian chờ khi gọi API.'
  console.error(message)
  process.exitCode = 1
}
