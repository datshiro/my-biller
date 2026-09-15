import type { CapacitorConfig } from '@capacitor/cli'

// appId chốt 06/09 (D15) — đổi sau khi đã cài là app khác trên máy. appName = short_name PWA.
// Không đặt server.url; webDir 'dist'; androidScheme mặc định 'https' (Capacitor 8) để IndexedDB/SW chạy.
const config: CapacitorConfig = {
  appId: 'dev.datshiro.mybiller',
  appName: 'Biller',
  webDir: 'dist',
}

export default config
