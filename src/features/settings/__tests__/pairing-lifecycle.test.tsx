// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GhepMayPage } from '../ghep-may-page'
import { db } from '@/db/db'
import { installTestDevice, testGid } from '@/test-fixtures'

const syncMocks = vi.hoisted(() => ({
  listShopDevices: vi.fn(),
}))

vi.mock('@/db/sync/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/sync/client')>()
  return { ...original, listShopDevices: syncMocks.listShopDevices }
})

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await installTestDevice()
  syncMocks.listShopDevices.mockReset().mockResolvedValue({ devices: [] })
})

afterEach(cleanup)

describe('vòng đời kích hoạt máy', () => {
  it('không mount giao diện active cho tới khi snapshot pairing đã được xoá', async () => {
    render(
      <MemoryRouter>
        <GhepMayPage />
      </MemoryRouter>,
    )
    expect(await screen.findByLabelText('Mã ghép máy')).toBeDefined()

    // Ghi trong lúc component đang mounted để tái hiện đúng transition từng cho hai live query
    // connection/pairing lệch nhau một nhịp và mount nhầm PairedView bằng token pending.
    await db.transaction('rw', db.deviceState, async () => {
      await db.deviceState.bulkPut([
        {
          key: 'connection',
          shopId: testGid(1),
          token: 'token-thu-nghiem-du-dai-cho-ket-noi-1234567890',
          syncUrl: 'https://sync.example.com',
        },
        {
          key: 'pairing',
          attemptId: testGid(2),
          hasLocalLedger: false,
          localLedgerRows: 0,
          connectionSaved: true,
          expiresAt: Date.now() + 60_000,
        },
      ])
    })

    expect(await screen.findByText('Đang hoàn tất ghép máy…')).toBeDefined()
    expect(screen.queryByText('Đã ghép')).toBeNull()
    expect(syncMocks.listShopDevices).not.toHaveBeenCalled()

    await db.deviceState.delete('pairing')

    expect(await screen.findByText('Đã ghép')).toBeDefined()
    await waitFor(() => expect(syncMocks.listShopDevices).toHaveBeenCalledTimes(1))
  })
})
