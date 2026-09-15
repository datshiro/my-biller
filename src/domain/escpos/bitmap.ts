/** Khổ SAPO SPR02: giấy 80mm, vùng in 72mm × 8 chấm/mm. Giả định — xác nhận bằng tờ self-test ở quán. */
export const DOTS_PER_LINE = 576

export interface RgbaImage {
  width: number
  height: number
  /** RGBA xen kẽ, 4 byte/chấm — cùng bố cục với `ImageData.data`. */
  data: Uint8ClampedArray
}

/** 1 bit/chấm, MSB trước, 1 = đen. Mỗi hàng chiếm `bytesPerRow(width)` byte; bit đệm cuối hàng luôn 0. */
export interface Bitmap {
  width: number
  height: number
  data: Uint8Array
}

export function bytesPerRow(width: number): number {
  return Math.ceil(width / 8)
}

export function concatBitmaps(top: Bitmap, bottom: Bitmap): Bitmap {
  if (top.width !== bottom.width) {
    throw new Error(`Không nối được hai bitmap rộng ${top.width} và ${bottom.width} chấm`)
  }
  const data = new Uint8Array(top.data.length + bottom.data.length)
  data.set(top.data)
  data.set(bottom.data, top.data.length)
  return { width: top.width, height: top.height + bottom.height, data }
}
