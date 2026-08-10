// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { testGid } from '@/test-fixtures'
import { SyncBanner } from '../sync-banner'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

afterEach(cleanup)

describe('trạng thái đồng bộ', () => {
  it('thông báo từ chối cũ không che lượt kéo lại hiện tại và có thể được ẩn', async () => {
    await db.deviceState.bulkPut([
      {
        key: 'connection',
        shopId: testGid(1),
        token: 'token-thu-nghiem-du-dai-cho-ket-noi-1234567890',
        syncUrl: 'https://sync.example.com',
      },
      {
        key: 'sync',
        lastSeq: 4,
        revision: 2,
        resyncRequired: true,
        lastConnectedAt: 1,
      },
      {
        key: 'notice',
        id: testGid(2),
        kind: 'sync',
        message: 'Máy chủ từ chối thay đổi trước đó.',
        createdAt: 1,
      },
    ])

    render(
      <MemoryRouter>
        <SyncBanner />
      </MemoryRouter>,
    )

    expect((await screen.findByRole('alert')).textContent).toContain('Máy chủ từ chối')
    expect(screen.getByRole('status').textContent).toContain('đang kéo lại toàn bộ sổ')

    await userEvent.click(screen.getByRole('button', { name: 'Ẩn thông báo đồng bộ' }))

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByRole('status').textContent).toContain('đang kéo lại toàn bộ sổ')
    expect(await db.deviceState.get('notice')).toBeUndefined()
  })
})
