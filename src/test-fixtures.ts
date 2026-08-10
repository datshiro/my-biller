import { saveDeviceIdentity } from '@/db/repositories/device-state'

export async function installTestDevice(letter = 'A'): Promise<void> {
  await saveDeviceIdentity({ label: `Máy ${letter}`, letter })
}

export function testGid(sequence = 0): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
}
