import { App } from '@capacitor/app'

/**
 * Bật/tắt handler Back của plugin App. Tắt thì Back thuộc về Android. Cờ nằm ở phía native và sống qua một lần
 * nạp lại trang (khôi phục sao lưu, cập nhật app), còn listener JS thì mất — nên lúc khởi động phải tắt lại.
 */
export function setAndroidBackHandler(enabled: boolean): Promise<void> {
  return App.toggleBackButtonHandler({ enabled }).catch((error: unknown) =>
    console.error('Không đổi được handler phím Back:', error),
  )
}
