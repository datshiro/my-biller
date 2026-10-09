// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { GhepMayPage } from '../ghep-may-page'
import { db } from '@/db/db'
import {
  beginDevicePairing,
  completeDevicePairing,
  getDeviceConnection,
  getOrCreateInstallId,
  leaveSharedLedger,
  markDeviceRevoked,
  saveDeviceIdentity,
  savePairedDevice,
} from '@/db/repositories/device-state'
import { SyncApiError } from '@/db/sync/client'
import { UnpairBlockedError } from '@/db/sync/unpair'
import { testGid } from '@/test-fixtures'

const DEVICE_ID = testGid(10)
const TOKEN = 't'.repeat(43)
const LEAVE_TITLE = 'Huỷ ghép “Quầy trước”?'
const REVOKED_TITLE = 'Dùng máy này như máy chưa ghép?'
const OFFLINE_TEXT =
  'Huỷ ghép cần mạng để các máy khác biết máy này đã rời sổ chung. Kết nối Internet rồi thử lại.'

const heartbeatMocks = vi.hoisted(() => ({
  abortUnpairedHeartbeat: vi.fn(),
  heartbeatAfterLeave: vi.fn(),
}))

vi.mock('@/app/unpaired-heartbeat', () => heartbeatMocks)

const syncMocks = vi.hoisted(() => ({
  listShopDevices: vi.fn(),
  pairDevice: vi.fn(),
  revokeShopDevice: vi.fn(),
}))

vi.mock('@/db/sync/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/sync/client')>()
  return {
    ...original,
    listShopDevices: syncMocks.listShopDevices,
    pairDevice: syncMocks.pairDevice,
    revokeShopDevice: syncMocks.revokeShopDevice,
  }
})

const unpairMocks = vi.hoisted(() => ({
  unpairThisDevice: vi.fn(),
}))

vi.mock('@/db/sync/unpair', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/sync/unpair')>()
  return { ...original, unpairThisDevice: unpairMocks.unpairThisDevice }
})

vi.mock('@/db/repositories/device-state', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/repositories/device-state')>()
  return {
    ...original,
    beginDevicePairing: vi.fn(original.beginDevicePairing),
    getOrCreateInstallId: vi.fn(original.getOrCreateInstallId),
  }
})

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await saveDeviceIdentity({ label: 'Quầy trước', letter: 'A' })
  syncMocks.listShopDevices.mockReset().mockResolvedValue({
    devices: [
      { id: DEVICE_ID, letter: 'A', label: 'Quầy trước', createdAt: 1, revokedAt: null, current: true },
    ],
    latestSeq: 0,
  })
  syncMocks.pairDevice.mockReset()
  syncMocks.revokeShopDevice.mockReset().mockResolvedValue({ revoked: true, deviceId: DEVICE_ID })
  unpairMocks.unpairThisDevice.mockReset()
  heartbeatMocks.abortUnpairedHeartbeat.mockReset()
  heartbeatMocks.heartbeatAfterLeave.mockReset()
  ;(beginDevicePairing as Mock).mockClear()
})

afterEach(cleanup)

const renderPage = () =>
  render(
    <MemoryRouter>
      <GhepMayPage />
    </MemoryRouter>,
  )

async function pairThisDevice() {
  const pairing = await beginDevicePairing()
  await savePairedDevice({
    pairingAttemptId: pairing.attemptId,
    admissionExpiresAt: Date.now() + 60_000,
    deviceId: DEVICE_ID,
    label: 'Quầy trước',
    letter: 'A',
    shopId: testGid(500),
    token: TOKEN,
    syncUrl: 'https://sync.example.com',
  })
  await completeDevicePairing(pairing.attemptId)
}

async function submitPairCode(code: string) {
  await userEvent.type(await screen.findByLabelText('Mã ghép máy'), code)
  await userEvent.click(await screen.findByRole('button', { name: 'GHÉP MÁY NÀY' }))
}

async function openLeaveDialog(title: string) {
  const button = (await screen.findByRole('button', { name: 'Huỷ ghép máy này' })) as HTMLButtonElement
  await waitFor(() => expect(button.disabled).toBe(false))
  await userEvent.click(button)
  return screen.findByRole('alertdialog', { name: title })
}

describe('ghép máy gửi mã cài đặt và huỷ heartbeat đang bay', () => {
  it('bắt đầu ghép thì huỷ heartbeat đang bay trước khi mở lượt ghép', async () => {
    syncMocks.pairDevice.mockRejectedValueOnce(
      new SyncApiError('Mã ghép không hợp lệ.', 'invalid-code', 400),
    )
    renderPage()

    await submitPairCode('ABC123')
    await screen.findByText('Mã ghép không hợp lệ.')

    expect(heartbeatMocks.abortUnpairedHeartbeat).toHaveBeenCalledTimes(1)
    const abortOrder = heartbeatMocks.abortUnpairedHeartbeat.mock.invocationCallOrder[0] ?? Infinity
    const beginOrder = (beginDevicePairing as Mock).mock.invocationCallOrder[0] ?? -1
    expect(beginOrder).toBeGreaterThanOrEqual(0)
    expect(abortOrder).toBeLessThan(beginOrder)
  })

  it('ghép máy gửi installId của máy trong pairDevice', async () => {
    syncMocks.pairDevice.mockRejectedValueOnce(
      new SyncApiError('Mã ghép không hợp lệ.', 'invalid-code', 400),
    )
    const installId = await getOrCreateInstallId()
    renderPage()

    await submitPairCode('ABC123')
    await screen.findByText('Mã ghép không hợp lệ.')

    expect(installId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(syncMocks.pairDevice).toHaveBeenCalledWith(expect.objectContaining({ installId }))
  })

  it('không tạo được mã cài đặt thì vẫn ghép máy, chỉ bỏ installId', async () => {
    ;(getOrCreateInstallId as Mock).mockRejectedValueOnce(new Error('IndexedDB lỗi'))
    syncMocks.pairDevice.mockResolvedValueOnce({
      admissionExpiresAt: Date.now() + 60_000,
      deviceId: DEVICE_ID,
      label: 'Quầy trước',
      letter: 'A',
      shopId: testGid(500),
      token: TOKEN,
    })
    renderPage()

    await submitPairCode('ABC123')

    await waitFor(() => expect(syncMocks.pairDevice).toHaveBeenCalledTimes(1))
    expect(syncMocks.pairDevice.mock.calls[0]?.[0]).not.toHaveProperty('installId')
    await waitFor(async () => expect(await getDeviceConnection()).toMatchObject({ shopId: testGid(500) }))
  })
})

describe('rời sổ chung gọi heartbeat ngay một lần', () => {
  it('huỷ ghép máy này gọi heartbeatAfterLeave đúng một lần sau khi rời sổ', async () => {
    await pairThisDevice()
    unpairMocks.unpairThisDevice.mockImplementation(async () => {
      await leaveSharedLedger({ kind: 'connected', token: TOKEN })
      return { droppedOperations: 0 }
    })
    renderPage()

    const dialog = await openLeaveDialog(LEAVE_TITLE)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Huỷ ghép' }))

    await waitFor(() => expect(heartbeatMocks.heartbeatAfterLeave).toHaveBeenCalledTimes(1))
  })

  it('dùng máy bị thu hồi như máy chưa ghép cũng gọi heartbeatAfterLeave đúng một lần', async () => {
    await pairThisDevice()
    await markDeviceRevoked()
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Dùng máy này như máy chưa ghép' }))
    const dialog = await screen.findByRole('alertdialog', { name: REVOKED_TITLE })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dùng như máy chưa ghép' }))

    await waitFor(() => expect(heartbeatMocks.heartbeatAfterLeave).toHaveBeenCalledTimes(1))
  })

  it('huỷ ghép thất bại vì mất mạng thì không gọi heartbeatAfterLeave', async () => {
    await pairThisDevice()
    unpairMocks.unpairThisDevice.mockRejectedValueOnce(new UnpairBlockedError('offline'))
    renderPage()

    const dialog = await openLeaveDialog(LEAVE_TITLE)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Huỷ ghép' }))

    expect((await screen.findByRole('alert')).textContent).toBe(OFFLINE_TEXT)
    expect(heartbeatMocks.heartbeatAfterLeave).not.toHaveBeenCalled()
  })
})
