import type { CapacitorConfig } from '@capacitor/cli'

// appId chốt 06/09 (D15) — đổi sau khi đã cài là app khác trên máy. appName = short_name PWA.
// Không đặt server.url; webDir 'dist'; androidScheme mặc định 'https' (Capacitor 8) để IndexedDB/SW chạy.
const config: CapacitorConfig = {
  appId: 'dev.datshiro.mybiller',
  appName: 'Biller',
  webDir: 'dist',
  // Plugin App nuốt Back khi chưa có listener; tắt mặc định để màn ngoài router (chặn dữ liệu, màn lỗi)
  // giữ Back của Android. `AndroidBackButton` bật lại trong lúc nó mount.
  plugins: { App: { disableBackButtonHandler: true } },
}

export default config
