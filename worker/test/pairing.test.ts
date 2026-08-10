import { SELF } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import type { SyncEvent } from '../../shared/sync-events'

type ShopCreated = { shopId: string; code: string }
type Paired = { shopId: string; deviceId: string; token: string; letter: string }

const jsonHeaders = { 'content-type': 'application/json' }

const customerRow = (gid: string) => ({
  gid,
  name: 'Hoa',
  phone: '',
  address: '',
  note: '',
  createdAt: 1,
  updatedAt: 1,
})

const groupRow = (gid: string) => ({
  gid,
  name: 'Nước',
  sortOrder: 1,
  createdAt: 1,
  updatedAt: 1,
})

const itemRow = (gid: string) => ({
  gid,
  name: 'Trà',
  groupId: 1,
  unit: 'ly',
  unitPrice: 10_000,
  costPrice: null,
  isActive: 1,
  note: '',
  createdAt: 1,
  updatedAt: 1,
})

async function createShop(): Promise<ShopCreated> {
  const response = await SELF.fetch('https://example.com/shop', {
    method: 'POST',
    headers: { ...jsonHeaders, authorization: 'Bearer test-admin-secret' },
  })
  expect(response.status).toBe(201)
  return response.json<ShopCreated>()
}

async function pair(
  code: string,
  letter: string,
  label = `Máy ${letter}`,
  hasLocalLedger = false,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return SELF.fetch('https://example.com/pair', {
    method: 'POST',
    headers: { ...jsonHeaders, ...extraHeaders },
    body: JSON.stringify({
      code,
      letter,
      label,
      hasLocalLedger,
      localLedgerRows: hasLocalLedger ? 1 : 0,
    }),
  })
}

async function pairWithRows(code: string, letter: string, localLedgerRows: number) {
  return SELF.fetch('https://example.com/pair', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      code,
      letter,
      label: `Máy ${letter}`,
      hasLocalLedger: localLedgerRows > 0,
      localLedgerRows,
    }),
  })
}

async function pairFirst(): Promise<{ shop: ShopCreated; device: Paired }> {
  const shop = await createShop()
  const response = await pair(shop.code, 'A')
  expect(response.status).toBe(201)
  const device = await response.json<Paired>()
  expect((await activate(shop.shopId, device)).status).toBe(201)
  return { shop, device }
}

const authorized = (token: string) => ({ authorization: `Bearer ${token}` })

async function activate(
  shopId: string,
  device: Paired,
  events: readonly SyncEvent[] = [],
): Promise<Response> {
  return SELF.fetch(`https://example.com/shop/${shopId}/seed`, {
    method: 'POST',
    headers: { ...jsonHeaders, ...authorized(device.token) },
    body: JSON.stringify({ events }),
  })
}

describe('device pairing', () => {
  it('protects shop creation with the server-only admin secret', async () => {
    const response = await SELF.fetch('https://example.com/shop', { method: 'POST' })
    expect(response.status).toBe(401)
  })

  it('uses a bootstrap code once and stores a distinct device token', async () => {
    const shop = await createShop()
    const first = await pair(shop.code, 'A')
    expect(first.status).toBe(201)
    const device = await first.json<Paired>()
    expect(device.shopId).toBe(shop.shopId)
    expect(device.token.length).toBeGreaterThanOrEqual(43)
    expect((await activate(shop.shopId, device)).status).toBe(201)

    const reused = await pair(shop.code, 'B')
    expect(reused.status).toBe(401)
    await expect(reused.json()).resolves.toMatchObject({ error: 'pair-invalid' })
  })

  it('allows the first local ledger but requires reconciliation when both sides have data', async () => {
    const shop = await createShop()
    const firstResponse = await pair(shop.code, 'A', 'Máy A', true)
    expect(firstResponse.status).toBe(201)
    const first = await firstResponse.json<Paired>()
    const whileSeeding = await pair(shop.code, 'B', 'Máy B', true)
    expect(whileSeeding.status).toBe(409)
    await expect(whileSeeding.json()).resolves.toMatchObject({ error: 'seed-in-progress' })
    const gid = crypto.randomUUID()
    const ledgerEvent: SyncEvent = {
      eventId: crypto.randomUUID(),
      txId: crypto.randomUUID(),
      txOrder: 0,
      table: 'customers',
      entityKey: gid,
      entityGid: gid,
      operation: 'create',
      before: null,
      after: customerRow(gid),
      refs: {},
    }
    expect((await activate(shop.shopId, first, [ledgerEvent])).status).toBe(201)

    const codeResponse = await SELF.fetch(`https://example.com/shop/${shop.shopId}/pair-code`, {
      method: 'POST',
      headers: authorized(first.token),
    })
    const { code } = await codeResponse.json<{ code: string }>()

    const blocked = await pair(code, 'B', 'Máy B', true)
    expect(blocked.status).toBe(409)
    await expect(blocked.json()).resolves.toMatchObject({ error: 'merge-required' })
    expect((await pair(code, 'B', 'Máy B', false)).status).toBe(201)
  })

  it('promotes the initial ledger atomically instead of publishing a partial seed', async () => {
    const shop = await createShop()
    const pending = await pairWithRows(shop.code, 'A', 2)
    expect(pending.status).toBe(201)
    const device = await pending.json<Paired>()
    const groupGid = crypto.randomUUID()
    const itemGid = crypto.randomUUID()
    const group: SyncEvent = {
      eventId: crypto.randomUUID(),
      txId: crypto.randomUUID(),
      txOrder: 0,
      table: 'itemGroups',
      entityKey: groupGid,
      entityGid: groupGid,
      operation: 'create',
      before: null,
      after: groupRow(groupGid),
      refs: {},
    }
    const invalidItem: SyncEvent = {
      eventId: crypto.randomUUID(),
      txId: group.txId,
      txOrder: 1,
      table: 'items',
      entityKey: itemGid,
      entityGid: itemGid,
      operation: 'create',
      before: null,
      after: itemRow(itemGid),
      refs: {},
    }
    const rejected = await activate(shop.shopId, device, [group, invalidItem])
    expect(rejected.status).toBe(409)
    expect(
      (
        await SELF.fetch(`https://example.com/shop/${shop.shopId}/oplog?since=0`, {
          headers: authorized(device.token),
        })
      ).status,
    ).toBe(401)

    const validItem = { ...invalidItem, refs: { groupId: groupGid } }
    expect((await activate(shop.shopId, device, [group, validItem])).status).toBe(201)
    const pulled = await SELF.fetch(`https://example.com/shop/${shop.shopId}/oplog?since=0`, {
      headers: authorized(device.token),
    })
    const body = await pulled.json<{ events: SyncEvent[] }>()
    expect(body.events).toHaveLength(2)
  })

  it('expires an unfinalized device reservation without consuming the pair code', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-10T10:00:00Z'))
      const shop = await createShop()
      expect((await pair(shop.code, 'A')).status).toBe(201)
      vi.advanceTimersByTime(2 * 60 * 1000 + 1)

      const retried = await pair(shop.code, 'A')
      expect(retried.status).toBe(201)
      const device = await retried.json<Paired>()
      expect((await activate(shop.shopId, device)).status).toBe(201)
      expect((await pair(shop.code, 'B')).status).toBe(401)
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives paired devices equal pairing, listing and revocation rights', async () => {
    const { shop, device: deviceA } = await pairFirst()
    const codeResponse = await SELF.fetch(`https://example.com/shop/${shop.shopId}/pair-code`, {
      method: 'POST',
      headers: authorized(deviceA.token),
    })
    expect(codeResponse.status).toBe(201)
    const { code } = await codeResponse.json<{ code: string }>()
    const deviceBResponse = await pair(code, 'B')
    expect(deviceBResponse.status).toBe(201)
    const deviceB = await deviceBResponse.json<Paired>()
    expect((await activate(shop.shopId, deviceB)).status).toBe(201)

    const listByB = await SELF.fetch(`https://example.com/shop/${shop.shopId}/devices`, {
      headers: authorized(deviceB.token),
    })
    expect(listByB.status).toBe(200)
    await expect(listByB.json()).resolves.toMatchObject({ devices: [{ letter: 'A' }, { letter: 'B' }] })

    const revokeByB = await SELF.fetch(
      `https://example.com/shop/${shop.shopId}/devices/${deviceA.deviceId}/revoke`,
      { method: 'POST', headers: authorized(deviceB.token) },
    )
    expect(revokeByB.status).toBe(200)

    const denied = await SELF.fetch(`https://example.com/shop/${shop.shopId}/devices`, {
      headers: authorized(deviceA.token),
    })
    expect(denied.status).toBe(401)
  })

  it('does not mint a pair code when the requesting device is revoked during hashing', async () => {
    const { shop, device: deviceA } = await pairFirst()
    const firstCode = await SELF.fetch(`https://example.com/shop/${shop.shopId}/pair-code`, {
      method: 'POST',
      headers: authorized(deviceA.token),
    })
    const deviceBResponse = await pair((await firstCode.json<{ code: string }>()).code, 'B')
    const deviceB = await deviceBResponse.json<Paired>()
    expect((await activate(shop.shopId, deviceB)).status).toBe(201)

    const realDigest = crypto.subtle.digest.bind(crypto.subtle)
    let releaseHash!: () => void
    let reachedHash!: () => void
    const hashPaused = new Promise<void>((resolve) => {
      reachedHash = resolve
    })
    const hashReleased = new Promise<void>((resolve) => {
      releaseHash = resolve
    })
    let paused = false
    const digest = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
      const value = new TextDecoder().decode(data)
      if (!paused && value !== deviceA.token && value !== deviceB.token) {
        paused = true
        reachedHash()
        await hashReleased
      }
      return realDigest(algorithm, data)
    })

    try {
      const pendingCode = SELF.fetch(`https://example.com/shop/${shop.shopId}/pair-code`, {
        method: 'POST',
        headers: authorized(deviceB.token),
      })
      await hashPaused
      const revoked = await SELF.fetch(
        `https://example.com/shop/${shop.shopId}/devices/${deviceB.deviceId}/revoke`,
        { method: 'POST', headers: authorized(deviceA.token) },
      )
      expect(revoked.status).toBe(200)
      releaseHash()

      const denied = await pendingCode
      expect(denied.status).toBe(401)
    } finally {
      releaseHash()
      digest.mockRestore()
    }
  })

  it('does not commit an event whose body finishes after the device is revoked', async () => {
    const { shop, device: deviceA } = await pairFirst()
    const codeResponse = await SELF.fetch(`https://example.com/shop/${shop.shopId}/pair-code`, {
      method: 'POST',
      headers: authorized(deviceA.token),
    })
    const deviceBResponse = await pair((await codeResponse.json<{ code: string }>()).code, 'B')
    const deviceB = await deviceBResponse.json<Paired>()
    expect((await activate(shop.shopId, deviceB)).status).toBe(201)
    expect(
      (
        await SELF.fetch(`https://example.com/shop/${shop.shopId}/epoch`, {
          method: 'POST',
          headers: { ...jsonHeaders, ...authorized(deviceB.token) },
          body: JSON.stringify({ epoch: 1 }),
        })
      ).status,
    ).toBe(200)

    const gid = crypto.randomUUID()
    const slowBody = new TransformStream<Uint8Array, Uint8Array>()
    const writer = slowBody.writable.getWriter()
    const pendingEvent = SELF.fetch(`https://example.com/shop/${shop.shopId}/events`, {
      method: 'POST',
      headers: { ...jsonHeaders, ...authorized(deviceB.token) },
      body: slowBody.readable,
    })
    // Khi write này trả về, handler đã kéo phần đầu body và đang chờ phần còn lại trong `readJson`.
    await writer.write(new TextEncoder().encode('{"epoch":1,"event":'))

    const revoked = await SELF.fetch(
      `https://example.com/shop/${shop.shopId}/devices/${deviceB.deviceId}/revoke`,
      { method: 'POST', headers: authorized(deviceA.token) },
    )
    expect(revoked.status).toBe(200)

    const syncEvent: SyncEvent = {
      eventId: crypto.randomUUID(),
      txId: crypto.randomUUID(),
      txOrder: 0,
      table: 'customers',
      entityKey: gid,
      entityGid: gid,
      operation: 'create',
      before: null,
      after: customerRow(gid),
      refs: {},
    }
    await writer.write(new TextEncoder().encode(`${JSON.stringify(syncEvent)}}`))
    await writer.close()

    const denied = await pendingEvent
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({ error: 'unauthorized' })
    const pulled = await SELF.fetch(`https://example.com/shop/${shop.shopId}/oplog?since=0`, {
      headers: authorized(deviceA.token),
    })
    await expect(pulled.json()).resolves.toMatchObject({ events: [] })
  })

  it('rejects a duplicated device letter without consuming a new letter', async () => {
    const { shop, device } = await pairFirst()
    const codeResponse = await SELF.fetch(`https://example.com/shop/${shop.shopId}/pair-code`, {
      method: 'POST',
      headers: authorized(device.token),
    })
    const { code } = await codeResponse.json<{ code: string }>()
    const duplicate = await pair(code, 'A')
    expect(duplicate.status).toBe(409)
    await expect(duplicate.json()).resolves.toMatchObject({ error: 'letter-conflict' })
  })

  it('returns one generic error for wrong, used and malformed secrets', async () => {
    const shop = await createShop()
    const first = await pair(shop.code, 'A')
    expect(first.status).toBe(201)
    expect((await activate(shop.shopId, await first.json<Paired>())).status).toBe(201)

    const variants = [shop.code, `${shop.shopId}.22222222222222222222222222`, 'not-a-code']
    for (const code of variants) {
      const response = await pair(code, 'B')
      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toMatchObject({ error: 'pair-invalid' })
    }
  })

  it('locks pairing after repeated wrong secrets, including for a valid code', async () => {
    const shop = await createShop()
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect(
        (await pair(`${shop.shopId}.22222222222222222222222222`, 'A')).status,
      ).toBe(401)
    }

    const locked = await pair(shop.code, 'A')
    expect(locked.status).toBe(401)
    await expect(locked.json()).resolves.toMatchObject({ error: 'pair-invalid' })
  })

  it('expires a pairing code after five minutes', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-09T10:00:00Z'))
      const shop = await createShop()
      vi.advanceTimersByTime(5 * 60 * 1000 + 1)

      const expired = await pair(shop.code, 'A')
      expect(expired.status).toBe(401)
      await expect(expired.json()).resolves.toMatchObject({ error: 'pair-invalid' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not initialize a guessed shop through an authenticated-looking route', async () => {
    const guessed = crypto.randomUUID()
    const response = await SELF.fetch(`https://example.com/shop/${guessed}/devices`, {
      headers: authorized('not-a-token'),
    })
    expect(response.status).toBe(404)
  })

  it('rate-limits public pairing attempts by the edge actor before Durable Object dispatch', async () => {
    const actor = `203.0.113.${Math.floor(Math.random() * 200) + 1}`
    let response: Response | undefined
    for (let attempt = 0; attempt < 21; attempt += 1) {
      response = await pair('not-a-code', 'A', 'Máy A', false, {
        'cf-connecting-ip': actor,
      })
    }
    expect(response?.status).toBe(429)
    await expect(response?.json()).resolves.toMatchObject({ error: 'rate-limited' })
  })
})
