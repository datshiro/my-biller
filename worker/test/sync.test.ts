import { SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SyncEvent } from '../../shared/sync-events'

const headers = { 'content-type': 'application/json' }
let shopId: string
let token: string
let deviceId: string

const auth = () => ({ ...headers, authorization: `Bearer ${token}` })
const event = (
  table: SyncEvent['table'],
  entityKey: string,
  after: Record<string, unknown> | null,
  refs: Record<string, string | null> = {},
  operation: SyncEvent['operation'] = 'create',
  before: Record<string, unknown> | null = null,
): SyncEvent => ({
  eventId: crypto.randomUUID(),
  txId: crypto.randomUUID(),
  txOrder: 0,
  table,
  entityKey,
  entityGid: table === 'settings' ? null : entityKey,
  operation,
  before,
  after,
  refs,
})

async function post(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify(body),
  })
}

async function push(syncEvent: SyncEvent, epoch = 1): Promise<Response> {
  return post(`/shop/${shopId}/events`, { epoch, event: syncEvent, deviceId: crypto.randomUUID() })
}

async function pullAll(): Promise<Array<SyncEvent & { seq: number }>> {
  const pulled = await SELF.fetch(`https://example.com/shop/${shopId}/oplog?since=0`, {
    headers: auth(),
  })
  return (await pulled.json<{ events: Array<SyncEvent & { seq: number }> }>()).events
}

const customerRow = (gid: string, name = 'Hoa') => ({
  gid,
  name,
  phone: '',
  address: '',
  note: '',
  createdAt: 1,
  updatedAt: 1,
})

const groupRow = (gid: string, name = 'Nước') => ({
  gid,
  name,
  sortOrder: 1,
  createdAt: 1,
  updatedAt: 1,
})

const itemRow = (gid: string, groupId: number | null = null) => ({
  gid,
  name: 'Trà',
  groupId,
  unit: 'ly',
  unitPrice: 10_000,
  costPrice: null,
  isActive: 1,
  note: '',
  createdAt: 1,
  updatedAt: 1,
})

const orderRow = (gid: string, customerGid: string, total = 100_000) => ({
  after: {
    gid,
    code: 'PBH-260810-A001',
    originalCode: '',
    customerId: 1,
    customerName: 'Hoa',
    subtotal: total,
    discount: 0,
    surcharge: 0,
    total,
    paidAmount: 0,
    status: 'unpaid',
    soldAt: 1,
    note: '',
    createdAt: 1,
    updatedAt: 1,
  },
  refs: { customerId: customerGid },
})

const paymentRow = (gid: string, amount: number) => ({
  gid,
  orderId: 1,
  allocatedOrderId: 0,
  customerId: 1,
  amount,
  method: 'cash',
  paidAt: 1,
  note: '',
})

beforeEach(async () => {
  const created = await SELF.fetch('https://example.com/shop', {
    method: 'POST',
    headers: { ...headers, authorization: 'Bearer test-admin-secret' },
  })
  const shop = await created.json<{ shopId: string; code: string }>()
  shopId = shop.shopId
  const paired = await SELF.fetch('https://example.com/pair', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      code: shop.code,
      letter: 'A',
      label: 'Quầy trước',
      hasLocalLedger: false,
      localLedgerRows: 0,
    }),
  })
  const device = await paired.json<{ token: string; deviceId: string }>()
  token = device.token
  deviceId = device.deviceId
  expect(
    (
      await SELF.fetch(`https://example.com/shop/${shopId}/seed`, {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ events: [] }),
      })
    ).status,
  ).toBe(201)
  expect((await post(`/shop/${shopId}/epoch`, { epoch: 1 })).status).toBe(200)
})

describe('oplog đồng bộ', () => {
  it('chống gửi trùng bằng eventId, suy deviceId từ token và kéo theo seq', async () => {
    const gid = crypto.randomUUID()
    const created = event('customers', gid, customerRow(gid))
    expect((await push(created)).status).toBe(201)
    const duplicate = await push(created)
    expect(duplicate.status).toBe(200)
    await expect(duplicate.json()).resolves.toMatchObject({ seq: 1, duplicate: true })

    const pulled = await SELF.fetch(`https://example.com/shop/${shopId}/oplog?since=0`, {
      headers: auth(),
    })
    const body = await pulled.json<{ events: Array<{ deviceId: string; seq: number }> }>()
    expect(body.events).toHaveLength(1)
    expect(body.events[0]).toMatchObject({ deviceId, seq: 1 })
  })

  it('fence request từ epoch cũ mà không ghi thêm oplog', async () => {
    expect((await post(`/shop/${shopId}/epoch`, { epoch: 2 })).status).toBe(200)
    const gid = crypto.randomUUID()
    const stale = await push(event('customers', gid, customerRow(gid)), 1)
    expect(stale.status).toBe(409)
    await expect(stale.json()).resolves.toMatchObject({ error: 'stale-leader' })
  })

  it('nhận phiếu thu trước nhưng từ chối phân bổ vượt nợ', async () => {
    const customerGid = crypto.randomUUID()
    const orderGid = crypto.randomUUID()
    const paymentGid = crypto.randomUUID()
    expect((await push(event('customers', customerGid, customerRow(customerGid)))).status).toBe(201)
    expect(
      (
        await push(
          event(
            'orders',
            orderGid,
            orderRow(orderGid, customerGid).after,
            orderRow(orderGid, customerGid).refs,
          ),
        )
      ).status,
    ).toBe(201)
    const payment = paymentRow(paymentGid, 120_000)
    expect(
      (
        await push(
          event('payments', paymentGid, payment, {
            orderId: orderGid,
            allocatedOrderId: null,
            customerId: customerGid,
          }),
        )
      ).status,
    ).toBe(201)

    const rejected = await push(
      event(
        'payments',
        paymentGid,
        { ...payment, allocatedOrderId: 1 },
        { orderId: orderGid, allocatedOrderId: orderGid, customerId: customerGid },
        'put',
        payment,
      ),
    )
    expect(rejected.status).toBe(409)
    await expect(rejected.json()).resolves.toMatchObject({ error: 'business-rejected' })

    const pulled = await SELF.fetch(`https://example.com/shop/${shopId}/oplog?since=0`, {
      headers: auth(),
    })
    const body = await pulled.json<{ events: SyncEvent[] }>()
    expect(body.events).toHaveLength(3)
    expect(body.events.at(-1)).toMatchObject({ table: 'payments', operation: 'create' })
  })

  it('derives paidAmount from canonical payments under concurrent stale order snapshots', async () => {
    const customerGid = crypto.randomUUID()
    const orderGid = crypto.randomUUID()
    expect((await push(event('customers', customerGid, customerRow(customerGid)))).status).toBe(201)
    const order = orderRow(orderGid, customerGid)
    expect((await push(event('orders', orderGid, order.after, order.refs))).status).toBe(201)

    const collect = async (amount: number, claimedPaid: number) => {
      const paymentGid = crypto.randomUUID()
      const payment = paymentRow(paymentGid, amount)
      expect(
        (
          await push(
            event('payments', paymentGid, payment, {
              orderId: orderGid,
              allocatedOrderId: null,
              customerId: customerGid,
            }),
          )
        ).status,
      ).toBe(201)
      expect(
        (
          await push(
            event(
              'payments',
              paymentGid,
              { ...payment, allocatedOrderId: 1 },
              { orderId: orderGid, allocatedOrderId: orderGid, customerId: customerGid },
              'put',
              payment,
            ),
          )
        ).status,
      ).toBe(201)
      expect(
        (
          await push(
            event(
              'orders',
              orderGid,
              {
                ...order.after,
                paidAmount: claimedPaid,
                status: claimedPaid >= 100_000 ? 'paid' : 'partial',
                note: `ghi chú ${amount}`,
              },
              order.refs,
              'put',
              order.after,
            ),
          )
        ).status,
      ).toBe(201)
    }

    await collect(40_000, 40_000)
    await collect(60_000, 60_000)

    const lastOrder = (await pullAll()).filter((entry) => entry.table === 'orders').at(-1)
    expect(lastOrder?.after).toMatchObject({ paidAmount: 100_000, status: 'paid' })
  })

  it('keeps receipt history immutable and refuses allocations into void orders', async () => {
    const customerGid = crypto.randomUUID()
    const orderGid = crypto.randomUUID()
    const paymentGid = crypto.randomUUID()
    expect((await push(event('customers', customerGid, customerRow(customerGid)))).status).toBe(201)
    const order = orderRow(orderGid, customerGid)
    expect((await push(event('orders', orderGid, order.after, order.refs))).status).toBe(201)
    const payment = paymentRow(paymentGid, 40_000)
    const paymentRefs = { orderId: orderGid, allocatedOrderId: null, customerId: customerGid }
    expect((await push(event('payments', paymentGid, payment, paymentRefs))).status).toBe(201)

    const changedAmount = await push(
      event('payments', paymentGid, { ...payment, amount: 41_000 }, paymentRefs, 'put', payment),
    )
    expect(changedAmount.status).toBe(409)
    const deleted = await push(event('payments', paymentGid, null, paymentRefs, 'delete', payment))
    expect(deleted.status).toBe(409)

    expect(
      (
        await push(
          event(
            'payments',
            paymentGid,
            { ...payment, allocatedOrderId: 1 },
            { ...paymentRefs, allocatedOrderId: orderGid },
            'put',
            payment,
          ),
        )
      ).status,
    ).toBe(201)

    const legacyDetachEvent = event('payments', paymentGid, payment, paymentRefs, 'put', payment)
    const legacyDetach = await push(legacyDetachEvent)
    expect(legacyDetach.status).toBe(201)
    const duplicateLegacyDetach = await push(legacyDetachEvent)
    expect(duplicateLegacyDetach.status).toBe(200)
    await expect(duplicateLegacyDetach.json()).resolves.toMatchObject({ duplicate: true })
    expect(
      (await pullAll()).filter((entry) => entry.table === 'payments').at(-1)?.refs,
    ).toMatchObject({ allocatedOrderId: orderGid })

    expect(
      (
        await push(
          event('orders', orderGid, { ...order.after, status: 'void' }, order.refs, 'put', order.after),
        )
      ).status,
    ).toBe(201)
    const afterVoid = await pullAll()
    const detached = afterVoid.filter((entry) => entry.table === 'payments').at(-1)
    const voidOrder = afterVoid.filter((entry) => entry.table === 'orders').at(-1)
    expect(detached?.refs).toMatchObject({ allocatedOrderId: null })
    expect(detached?.after).not.toHaveProperty('allocatedOrderId')
    expect(voidOrder?.after).toMatchObject({ paidAmount: 0, status: 'void' })

    const lateLegacyDetach = await push(
      event('payments', paymentGid, payment, paymentRefs, 'put', payment),
    )
    expect(lateLegacyDetach.status).toBe(201)
    expect((await pullAll()).filter((entry) => entry.table === 'payments').at(-1)).toMatchObject({
      after: {
        unallocatedStatus: 'pending',
        resolutionNote: 'Đơn đã huỷ; khoản thu chờ xử lý.',
      },
      refs: { allocatedOrderId: null },
    })

    const allocated = await push(
      event(
        'payments',
        paymentGid,
        { ...payment, allocatedOrderId: 1 },
        { ...paymentRefs, allocatedOrderId: orderGid },
        'put',
        payment,
      ),
    )
    expect(allocated.status).toBe(409)
  })

  it('keeps an allocated payment terminal against stale resolution and reallocation', async () => {
    const customerGid = crypto.randomUUID()
    const firstOrderGid = crypto.randomUUID()
    const secondOrderGid = crypto.randomUUID()
    const paymentGid = crypto.randomUUID()
    expect((await push(event('customers', customerGid, customerRow(customerGid)))).status).toBe(201)

    const firstOrder = orderRow(firstOrderGid, customerGid)
    const secondOrder = orderRow(secondOrderGid, customerGid)
    secondOrder.after.code = 'PBH-260810-A002'
    expect(
      (await push(event('orders', firstOrderGid, firstOrder.after, firstOrder.refs))).status,
    ).toBe(201)
    expect(
      (await push(event('orders', secondOrderGid, secondOrder.after, secondOrder.refs))).status,
    ).toBe(201)

    const pendingPayment = {
      ...paymentRow(paymentGid, 40_000),
      unallocatedStatus: 'pending',
      resolutionNote: 'Đơn đã huỷ; khoản thu chờ xử lý.',
    }
    const pendingRefs = {
      orderId: firstOrderGid,
      allocatedOrderId: null,
      customerId: customerGid,
    }
    expect((await push(event('payments', paymentGid, pendingPayment, pendingRefs))).status).toBe(201)

    const allocatedRefs = { ...pendingRefs, allocatedOrderId: firstOrderGid }
    expect(
      (
        await push(
          event('payments', paymentGid, pendingPayment, allocatedRefs, 'put', pendingPayment),
        )
      ).status,
    ).toBe(201)

    const staleRefund = await push(
      event(
        'payments',
        paymentGid,
        {
          ...pendingPayment,
          unallocatedStatus: 'refunded',
          resolutionNote: 'Thiết bị cũ đánh dấu đã hoàn.',
        },
        pendingRefs,
        'put',
        pendingPayment,
      ),
    )
    expect(staleRefund.status).toBe(409)

    const staleDiscard = await push(
      event(
        'payments',
        paymentGid,
        {
          ...pendingPayment,
          unallocatedStatus: 'discarded',
          resolutionNote: 'Thiết bị cũ bỏ khoản thu.',
        },
        pendingRefs,
        'put',
        pendingPayment,
      ),
    )
    expect(staleDiscard.status).toBe(409)

    const staleReallocation = await push(
      event(
        'payments',
        paymentGid,
        pendingPayment,
        { ...pendingRefs, allocatedOrderId: secondOrderGid },
        'put',
        pendingPayment,
      ),
    )
    expect(staleReallocation.status).toBe(409)

    const paymentEvents = (await pullAll()).filter((entry) => entry.table === 'payments')
    expect(paymentEvents.at(-1)).toMatchObject({
      after: { unallocatedStatus: 'pending' },
      refs: { allocatedOrderId: firstOrderGid },
    })
  })

  it('keeps a resolved payment terminal when a stale device sends another decision', async () => {
    const customerGid = crypto.randomUUID()
    const orderGid = crypto.randomUUID()
    const paymentGid = crypto.randomUUID()
    expect((await push(event('customers', customerGid, customerRow(customerGid)))).status).toBe(201)
    const order = orderRow(orderGid, customerGid)
    expect((await push(event('orders', orderGid, order.after, order.refs))).status).toBe(201)

    const pendingPayment = {
      ...paymentRow(paymentGid, 40_000),
      unallocatedStatus: 'pending',
      resolutionNote: 'Đơn đã huỷ; khoản thu chờ xử lý.',
    }
    const paymentRefs = { orderId: orderGid, allocatedOrderId: null, customerId: customerGid }
    expect((await push(event('payments', paymentGid, pendingPayment, paymentRefs))).status).toBe(201)

    const refunded = {
      ...pendingPayment,
      unallocatedStatus: 'refunded',
      resolutionNote: 'Đã trả lại tiền cho khách.',
    }
    expect(
      (
        await push(
          event('payments', paymentGid, refunded, paymentRefs, 'put', pendingPayment),
        )
      ).status,
    ).toBe(201)

    const staleDiscard = await push(
      event(
        'payments',
        paymentGid,
        {
          ...pendingPayment,
          unallocatedStatus: 'discarded',
          resolutionNote: 'Thiết bị cũ chọn bỏ khoản thu.',
        },
        paymentRefs,
        'put',
        pendingPayment,
      ),
    )
    expect(staleDiscard.status).toBe(409)
    await expect(staleDiscard.json()).resolves.toMatchObject({ error: 'business-rejected' })

    const staleAllocation = await push(
      event(
        'payments',
        paymentGid,
        pendingPayment,
        { ...paymentRefs, allocatedOrderId: orderGid },
        'put',
        pendingPayment,
      ),
    )
    expect(staleAllocation.status).toBe(409)

    const paymentEvents = (await pullAll()).filter((entry) => entry.table === 'payments')
    expect(paymentEvents.at(-1)).toMatchObject({
      after: {
        unallocatedStatus: 'refunded',
        resolutionNote: 'Đã trả lại tiền cho khách.',
      },
      refs: { allocatedOrderId: null },
    })
  })

  it('rejects deleting a parent while a concurrently-created child still references it', async () => {
    const groupGid = crypto.randomUUID()
    const itemGid = crypto.randomUUID()
    const group = groupRow(groupGid)
    const item = itemRow(itemGid, 1)
    expect((await push(event('itemGroups', groupGid, group))).status).toBe(201)
    const missingRefs = await push(event('items', itemGid, item))
    expect(missingRefs.status).toBe(409)
    await expect(missingRefs.json()).resolves.toMatchObject({ error: 'business-rejected' })
    expect((await push(event('items', itemGid, item, { groupId: groupGid }))).status).toBe(201)
    const canonicalItem = (await pullAll()).filter((entry) => entry.table === 'items').at(-1)
    expect(canonicalItem?.after).not.toHaveProperty('groupId')
    expect(canonicalItem?.refs).toEqual({ groupId: groupGid })

    const blocked = await push(event('itemGroups', groupGid, null, {}, 'delete', group))
    expect(blocked.status).toBe(409)
    expect(
      (
        await push(
          event('items', itemGid, { ...item, groupId: null }, { groupId: null }, 'put', item),
        )
      ).status,
    ).toBe(201)
    expect((await push(event('itemGroups', groupGid, null, {}, 'delete', group))).status).toBe(201)
  })

  it('từ chối payload sai hợp đồng ở mọi bảng trước khi ghi vào sổ', async () => {
    const customerGid = crypto.randomUUID()
    const groupGid = crypto.randomUUID()
    const itemGid = crypto.randomUUID()
    const orderGid = crypto.randomUUID()
    const categoryGid = crypto.randomUUID()
    expect((await push(event('customers', customerGid, customerRow(customerGid)))).status).toBe(201)
    expect((await push(event('itemGroups', groupGid, groupRow(groupGid)))).status).toBe(201)
    expect(
      (await push(event('items', itemGid, itemRow(itemGid, 1), { groupId: groupGid }))).status,
    ).toBe(201)
    const order = orderRow(orderGid, customerGid)
    expect((await push(event('orders', orderGid, order.after, order.refs))).status).toBe(201)
    expect(
      (
        await push(
          event('expenseCategories', categoryGid, {
            gid: categoryGid,
            name: 'Nguyên liệu',
            createdAt: 1,
            updatedAt: 1,
          }),
        )
      ).status,
    ).toBe(201)

    const invalidCases: Array<{
      table: SyncEvent['table']
      entityKey: string
      after: Record<string, unknown>
      refs?: Record<string, string | null>
    }> = [
      {
        table: 'settings',
        entityKey: 'shop',
        after: { key: 'shop', value: { name: 'Quán', phone: '', address: '' } },
      },
      {
        table: 'itemGroups',
        entityKey: crypto.randomUUID(),
        after: { ...groupRow(crypto.randomUUID(), 'Nhóm lỗi'), sortOrder: 1.5 },
      },
      {
        table: 'items',
        entityKey: crypto.randomUUID(),
        after: { ...itemRow(crypto.randomUUID(), 1), unitPrice: 10_000.5 },
        refs: { groupId: groupGid },
      },
      {
        table: 'customers',
        entityKey: crypto.randomUUID(),
        after: { ...customerRow(crypto.randomUUID()), phone: 123 },
      },
      {
        table: 'customerPrices',
        entityKey: crypto.randomUUID(),
        after: {
          gid: crypto.randomUUID(),
          customerId: 1,
          itemId: 1,
          unitPrice: 9_000.5,
          createdAt: 1,
          updatedAt: 1,
        },
        refs: { customerId: customerGid, itemId: itemGid },
      },
      {
        table: 'orders',
        entityKey: crypto.randomUUID(),
        after: { ...orderRow(crypto.randomUUID(), customerGid).after, total: 100_000.5 },
        refs: { customerId: customerGid },
      },
      {
        table: 'orderLines',
        entityKey: crypto.randomUUID(),
        after: {
          gid: crypto.randomUUID(),
          orderId: 1,
          itemId: 1,
          name: 'Trà',
          unit: 'ly',
          unitPrice: 10_000,
          costPrice: null,
          qty: 1,
          amount: 10_000.5,
        },
        refs: { orderId: orderGid, itemId: itemGid },
      },
      {
        table: 'payments',
        entityKey: crypto.randomUUID(),
        after: paymentRow(crypto.randomUUID(), 0),
        refs: { orderId: orderGid, allocatedOrderId: null, customerId: customerGid },
      },
      {
        table: 'expenseCategories',
        entityKey: crypto.randomUUID(),
        after: { gid: crypto.randomUUID(), name: '', createdAt: 1, updatedAt: 1 },
      },
      {
        table: 'expenses',
        entityKey: crypto.randomUUID(),
        after: {
          gid: crypto.randomUUID(),
          categoryId: 1,
          amount: 10_000.5,
          note: '',
          spentAt: 1,
          createdAt: 1,
          updatedAt: 1,
        },
        refs: { categoryId: categoryGid },
      },
    ]

    for (const invalid of invalidCases) {
      if (invalid.table !== 'settings') invalid.after.gid = invalid.entityKey
      const response = await push(
        event(invalid.table, invalid.entityKey, invalid.after, invalid.refs ?? {}),
      )
      expect(response.status, invalid.table).toBe(409)
      await expect(response.json()).resolves.toMatchObject({ error: 'business-rejected' })
    }

    expect(await pullAll()).toHaveLength(5)
  })

  it('rejects mismatched entity keys for create, put, delete and settings rows', async () => {
    const canonicalGid = crypto.randomUUID()
    const otherGid = crypto.randomUUID()
    const mismatchedCreate = event('customers', canonicalGid, customerRow(otherGid))
    mismatchedCreate.entityGid = otherGid
    expect((await push(mismatchedCreate)).status).toBe(409)

    expect(
      (await push(event('customers', canonicalGid, customerRow(canonicalGid)))).status,
    ).toBe(201)
    const mismatchedExistingCreate = event(
      'customers',
      canonicalGid,
      customerRow(otherGid, 'Bản cục bộ sai gid'),
    )
    mismatchedExistingCreate.entityGid = otherGid
    expect((await push(mismatchedExistingCreate)).status).toBe(409)
    const mismatchedPut = event(
      'customers',
      canonicalGid,
      customerRow(otherGid, 'Hoa mới'),
      {},
      'put',
      customerRow(canonicalGid),
    )
    mismatchedPut.entityGid = otherGid
    expect((await push(mismatchedPut)).status).toBe(409)

    const mismatchedDelete = event(
      'customers',
      canonicalGid,
      null,
      {},
      'delete',
      customerRow(otherGid),
    )
    mismatchedDelete.entityGid = otherGid
    expect((await push(mismatchedDelete)).status).toBe(409)

    const invalidSettings = event('settings', 'khong-hop-le', {
      key: 'khong-hop-le',
      value: {},
    })
    invalidSettings.entityGid = null
    expect((await push(invalidSettings)).status).toBe(409)

    const pulled = await pullAll()
    expect(pulled).toHaveLength(1)
    expect(pulled[0]).toMatchObject({ table: 'customers', entityKey: canonicalGid })
  })
})

describe('seq mới nhất của sổ chung', () => {
  const listDevices = () =>
    SELF.fetch(`https://example.com/shop/${shopId}/devices`, { headers: auth() })

  it('trả latestSeq bằng 0 khi oplog còn rỗng', async () => {
    const response = await listDevices()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ latestSeq: 0 })
  })

  it('latestSeq bằng đúng seq của sự kiện cuối mà máy kéo về', async () => {
    const customerGid = crypto.randomUUID()
    const orderGid = crypto.randomUUID()
    expect((await push(event('customers', customerGid, customerRow(customerGid)))).status).toBe(201)
    const order = orderRow(orderGid, customerGid)
    expect((await push(event('orders', orderGid, order.after, order.refs))).status).toBe(201)

    const pulled = await pullAll()
    const body = await (await listDevices()).json<{ latestSeq: number }>()
    expect(body.latestSeq).toBeGreaterThan(0)
    expect(body.latestSeq).toBe(pulled.at(-1)?.seq)
  })
})

describe('kéo oplog theo trang', () => {
  const pull = (since: number) =>
    SELF.fetch(`https://example.com/shop/${shopId}/oplog?since=${since}`, { headers: auth() })

  it('tôn trọng since: trang sau bắt đầu ngay sau seq đã có, không trả lại từ đầu', async () => {
    // Gateway từng dựng URL nội bộ chỉ từ pathname nên `?since=` rơi mất: mọi trang đều là seq 1..500,
    // máy có sổ từ 500 sự kiện kẹt ở seq 500 và quay vòng kéo mãi. Ca này khoá đúng đường đi qua gateway.
    const gids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
    for (const gid of gids) {
      expect((await push(event('customers', gid, customerRow(gid)))).status).toBe(201)
    }
    const all = await pullAll()
    expect(all.map((row) => row.entityKey)).toEqual(gids)
    const secondSeq = all[1]!.seq

    const tail = await (await pull(secondSeq)).json<{ events: Array<{ seq: number; entityKey: string }>; hasMore: boolean }>()
    expect(tail.events.map((row) => row.entityKey)).toEqual([gids[2]])
    expect(tail.events[0]!.seq).toBe(secondSeq + 1)
    expect(tail.hasMore).toBe(false)

    const empty = await (await pull(all.at(-1)!.seq)).json<{ events: unknown[]; hasMore: boolean }>()
    expect(empty).toEqual({ events: [], hasMore: false })
  })
})
