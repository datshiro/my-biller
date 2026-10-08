import { useEffect, useEffectEvent } from 'react'

type Layer = { dismiss: () => void }

const layers: Layer[] = []

/**
 * Lớp mount sau nằm trên. React chạy effect của con trước cha, nên đừng mount hộp thoại cùng commit với
 * Sheet cha — Sheet sẽ nằm trên và Back đóng nhầm lớp. Trong app mọi hộp đều mở bằng một cú chạm sau.
 */
export function pushBackDismiss(dismiss: () => void): () => void {
  const layer: Layer = { dismiss }
  layers.push(layer)
  return () => {
    const index = layers.indexOf(layer)
    if (index !== -1) layers.splice(index, 1)
  }
}

/** `true` khi có lớp — kể cả lớp chọn không đóng (hộp đang chờ lưu): Back khi đó bị nuốt. */
export function dismissTopOverlay(): boolean {
  const top = layers.at(-1)
  if (!top) return false
  top.dismiss()
  return true
}

/** Phím Back của APK đóng lớp này trước khi được đi lùi màn hay thu app. */
export function useBackDismiss(dismiss: () => void): void {
  const onBack = useEffectEvent(dismiss)
  useEffect(() => pushBackDismiss(() => onBack()), [])
}
