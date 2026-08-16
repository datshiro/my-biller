import { describe, expect, it } from 'vitest'
import { newGid } from '../gid'

describe('newGid', () => {
  it('sinh 100.000 UUID không trùng nhau', () => {
    const gids = Array.from({ length: 100_000 }, newGid)
    expect(new Set(gids).size).toBe(gids.length)
    expect(gids.every((gid) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(gid))).toBe(true)
  })
})
