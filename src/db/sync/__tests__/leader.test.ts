import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db'
import { assertLeadership, claimLeadership, renewLeadership } from '../leader'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('lease + epoch', () => {
  it('chỉ một tab giữ lease và takeover tăng epoch', async () => {
    const first = await claimLeadership(db, crypto.randomUUID(), 1_000)
    expect(first?.epoch).toBe(1)

    const secondOwner = crypto.randomUUID()
    expect(await claimLeadership(db, secondOwner, 2_000)).toBeNull()
    const takeover = await claimLeadership(db, secondOwner, 20_000)
    expect(takeover?.epoch).toBe(2)

    await expect(assertLeadership(db, first!)).rejects.toThrow('stale-leader')
    await expect(assertLeadership(db, takeover!)).resolves.toBeUndefined()
  })

  it('chỉ đúng owner/epoch mới gia hạn được', async () => {
    const owner = crypto.randomUUID()
    const leader = await claimLeadership(db, owner, 1_000)
    expect(await renewLeadership(db, leader!, 2_000)).toBe(true)
    expect(await renewLeadership(db, { ownerId: owner, epoch: 99 }, 3_000)).toBe(false)
  })
})
