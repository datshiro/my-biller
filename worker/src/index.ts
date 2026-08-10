import { parseRoutedPairCode, secretsEqual } from './auth'
import type { Env } from './env'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json()
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function forward(stub: DurableObjectStub, request: Request, pathname: string, body?: unknown): Promise<Response> {
  const headers = new Headers(request.headers)
  headers.delete('host')
  const init: RequestInit = { method: request.method, headers }
  if (body !== undefined) {
    headers.set('content-type', 'application/json')
    init.body = JSON.stringify(body)
  } else if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
  }
  return stub.fetch(new Request(`https://shop.internal${pathname}`, init))
}

function shopStub(env: Env, shopId: string): DurableObjectStub {
  return env.SHOP_DO.get(env.SHOP_DO.idFromName(shopId))
}

async function pairAttemptAllowed(request: Request, env: Env): Promise<boolean> {
  const actor = request.headers.get('cf-connecting-ip')
  if (!actor) return true
  return (await env.PAIR_RATE_LIMITER.limit({ key: `pair:${actor}` })).success
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })

    let response: Response
    if (request.method === 'GET' && url.pathname === '/health') {
      response = Response.json({ status: 'ok' })
    } else if (request.method === 'POST' && url.pathname === '/shop') {
      const authorization = request.headers.get('authorization')
      const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
      if (!env.ADMIN_SECRET || !(await secretsEqual(supplied, env.ADMIN_SECRET))) {
        response = Response.json({ error: 'unauthorized' }, { status: 401 })
      } else {
        const shopId = crypto.randomUUID()
        response = await forward(shopStub(env, shopId), request, '/internal/bootstrap', { shopId })
      }
    } else if (request.method === 'POST' && url.pathname === '/pair') {
      if (!(await pairAttemptAllowed(request, env))) {
        response = Response.json(
          { error: 'rate-limited', message: 'Thử ghép quá nhiều lần. Chờ một phút rồi thử lại.' },
          { status: 429 },
        )
      } else {
        const body = await readJson(request)
        const routed = typeof body?.code === 'string' ? parseRoutedPairCode(body.code.trim()) : null
        if (!routed) {
          response = Response.json(
            { error: 'pair-invalid', message: 'Mã ghép không đúng, đã dùng hoặc đã hết hạn.' },
            { status: 401 },
          )
        } else {
          response = await forward(shopStub(env, routed.shopId), request, '/pair', {
            secret: routed.secret,
            label: body?.label,
            letter: body?.letter,
            hasLocalLedger: body?.hasLocalLedger,
            localLedgerRows: body?.localLedgerRows,
          })
        }
      }
    } else {
      const matched = url.pathname.match(/^\/shop\/([^/]+)(\/.*)$/)
      const shopId = matched?.[1] ? decodeURIComponent(matched[1]) : ''
      const rest = matched?.[2] ?? ''
      const safeShopId = /^[0-9a-f-]{36}$/i.test(shopId)
      const allowed =
        (request.method === 'POST' && rest === '/pair-code') ||
        (request.method === 'GET' && rest === '/devices') ||
        (request.method === 'GET' && rest === '/ws') ||
        (request.method === 'POST' && rest === '/epoch') ||
        (request.method === 'POST' && rest === '/events') ||
        (request.method === 'POST' && rest === '/seed') ||
        (request.method === 'GET' && rest === '/oplog') ||
        (request.method === 'POST' && /^\/devices\/[^/]+\/revoke$/.test(rest))

      response = safeShopId && allowed
        ? await forward(shopStub(env, shopId), request, rest)
        : new Response('Not found', { status: 404 })
    }

    return withCors(response)
  },
} satisfies ExportedHandler<Env>

export { ShopDO } from './shop-do'
export default worker
