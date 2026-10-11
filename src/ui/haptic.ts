/** Rung nhẹ khi món vào giỏ. iOS Safari không có API rung, APK thiếu quyền VIBRATE thì WebView lặng lẽ bỏ qua. */
export function tapHaptic() {
  navigator.vibrate?.(10)
}
