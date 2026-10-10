// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/db'
import {
  beginDevicePairing,
  completeDevicePairing,
  saveDeviceIdentity,
  savePairedDevice,
} from '@/db/repositories/device-state'
import { testGid } from '@/test-fixtures'

vi.mock('../../printer/printer-sink', () => ({
  isNativeApp: () => false,
  isAndroidWeb: () => false,
  nativeSink: vi.fn(),
}))

import { SettingsPage } from '../settings-page'

const INSTALL_ID = '6f1c9d2e-8a4b-4c3d-9e2f-1a2b3c4d5e6f'
const INSTALL_SHORT = '6f1c…e6f'
const LEGACY_SUBTITLE = 'Tên máy, chữ cái và ghép vào sổ chung'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

const renderPage = () =>
  render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  )

async function saveInstallId() {
  await db.deviceState.put({ key: 'install', installId: INSTALL_ID, createdAt: 1 })
}

async function pairThisDevice() {
  await saveDeviceIdentity({ label: 'Quầy trước', letter: 'A' })
  const pairing = await beginDevicePairing()
  await savePairedDevice({
    pairingAttemptId: pairing.attemptId,
    admissionExpiresAt: Date.now() + 60_000,
    deviceId: testGid(10),
    label: 'Quầy trước',
    letter: 'A',
    shopId: testGid(500),
    token: 't'.repeat(43),
    syncUrl: 'https://sync.example.com',
  })
  await completeDevicePairing(pairing.attemptId)
}

describe('dòng Máy bán hàng ở Cài đặt', () => {
  it('máy đã ghép hiện tên máy, mã sổ rút gọn và chữ máy', async () => {
    await pairThisDevice()
    renderPage()

    expect(await screen.findByText('Quầy trước · Sổ: 0000…500 · Máy A')).toBeDefined()
  })

  it('máy chưa ghép có mã cài đặt thì hiện tên, chữ và mã máy, ghi rõ chưa ghép', async () => {
    await saveDeviceIdentity({ label: 'Quầy trước', letter: 'A' })
    await saveInstallId()
    renderPage()

    expect(await screen.findByText(`Quầy trước · chữ A · Mã máy: ${INSTALL_SHORT} · chưa ghép`)).toBeDefined()
  })

  it('máy chưa ghép chưa đặt tên vẫn hiện mã máy', async () => {
    await saveInstallId()
    renderPage()

    expect(await screen.findByText(`Mã máy: ${INSTALL_SHORT} · chưa ghép`)).toBeDefined()
  })

  it('chưa có mã cài đặt thì giữ câu cũ', async () => {
    await saveDeviceIdentity({ label: 'Quầy trước', letter: 'A' })
    renderPage()

    expect(await screen.findByText(LEGACY_SUBTITLE)).toBeDefined()
  })
})
