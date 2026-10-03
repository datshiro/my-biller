import { bytesPerRow } from './escpos/bitmap.ts'
import type { Bitmap } from './escpos/bitmap.ts'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Số ô mực trên 16 của mỗi ô Bayer 4×4. Đậm trên 8/16 thì logo lấn chữ dù đã có viền trắng — thử trên ảnh mô phỏng
 * tem 50×30, chưa in trên máy thật.
 */
export const STRENGTH_CELLS = { light: 3, medium: 5, dark: 8 } as const

export type LogoInk = { kind: 'solid' } | { kind: 'dither'; cells: number }

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

function blank(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8Array(bytesPerRow(width) * height) }
}

export function getBit(b: Bitmap, x: number, y: number): boolean {
  return ((b.data[y * bytesPerRow(b.width) + (x >> 3)] ?? 0) & (0x80 >> (x & 7))) !== 0
}

function setBit(b: Bitmap, x: number, y: number, ink: boolean): void {
  const k = y * bytesPerRow(b.width) + (x >> 3)
  const mask = 0x80 >> (x & 7)
  b.data[k] = ink ? (b.data[k] ?? 0) | mask : (b.data[k] ?? 0) & ~mask
}

export function inkBounds(b: Bitmap): Rect | null {
  let minX = b.width
  let minY = b.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) {
      if (!getBit(b, x, y)) continue
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

export function cropBitmap(b: Bitmap, r: Rect): Bitmap {
  const out = blank(r.width, r.height)
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) if (getBit(b, r.x + x, r.y + y)) setBit(out, x, y, true)
  }
  return out
}

/**
 * Co (hoặc phóng) logo vừa hộp, giữ tỉ lệ. Mỗi chấm đích mang tỉ lệ mực của các chấm nguồn có tâm nằm trong vùng
 * nó phủ; khi phóng to vùng đó có thể không chứa tâm nào thì lấy chấm nguồn gần nhất.
 */
export function fitCoverage(
  logo: Bitmap,
  maxW: number,
  maxH: number,
): { width: number; height: number; coverage: Float32Array } {
  const scale = Math.min(maxW / logo.width, maxH / logo.height)
  const width = Math.max(1, Math.round(logo.width * scale))
  const height = Math.max(1, Math.round(logo.height * scale))
  const sx = logo.width / width
  const sy = logo.height / height
  const span = (d: number, s: number, limit: number) => [
    Math.max(0, Math.ceil(d * s - 0.5)),
    Math.min(limit, Math.ceil((d + 1) * s - 0.5)),
  ]
  const coverage = new Float32Array(width * height)
  for (let dy = 0; dy < height; dy++) {
    const [y0 = 0, y1 = 0] = span(dy, sy, logo.height)
    for (let dx = 0; dx < width; dx++) {
      const [x0 = 0, x1 = 0] = span(dx, sx, logo.width)
      let value: number
      if (x1 <= x0 || y1 <= y0) {
        const nx = Math.min(logo.width - 1, Math.floor((dx + 0.5) * sx))
        const ny = Math.min(logo.height - 1, Math.floor((dy + 0.5) * sy))
        value = getBit(logo, nx, ny) ? 1 : 0
      } else {
        let ink = 0
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (getBit(logo, x, y)) ink++
        value = ink / ((x1 - x0) * (y1 - y0))
      }
      coverage[dy * width + dx] = value
    }
  }
  return { width, height, coverage }
}

/** Một ảnh trắng cỡ `canvas`, logo co vừa `box` rồi căn giữa trong `box`. Mẫu Bayer neo theo toạ độ canvas. */
export function renderLogoLayer(
  canvas: { width: number; height: number },
  logo: Bitmap,
  box: Rect,
  ink: LogoInk,
): Bitmap {
  const out = blank(canvas.width, canvas.height)
  const fit = fitCoverage(logo, box.width, box.height)
  const left = box.x + Math.floor((box.width - fit.width) / 2)
  const top = box.y + Math.floor((box.height - fit.height) / 2)
  for (let fy = 0; fy < fit.height; fy++) {
    const y = top + fy
    if (y < 0 || y >= canvas.height) continue
    for (let fx = 0; fx < fit.width; fx++) {
      const x = left + fx
      if (x < 0 || x >= canvas.width || (fit.coverage[fy * fit.width + fx] ?? 0) < 0.5) continue
      if (ink.kind === 'dither' && (BAYER[y & 3]?.[x & 3] ?? 16) >= ink.cells) continue
      setBit(out, x, y, true)
    }
  }
  return out
}

export function dilate(b: Bitmap, radius: number): Bitmap {
  const out = blank(b.width, b.height)
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) {
      if (!getBit(b, x, y)) continue
      for (let ny = Math.max(0, y - radius); ny <= Math.min(b.height - 1, y + radius); ny++) {
        for (let nx = Math.max(0, x - radius); nx <= Math.min(b.width - 1, x + radius); nx++) setBit(out, nx, ny, true)
      }
    }
  }
  return out
}

/**
 * Logo nằm DƯỚI chữ: chữ giữ nguyên, logo bị khoét một viền `halo` chấm quanh mỗi nét để chấm logo không dính vào
 * nét chữ — tên món và ghi chú vẫn đọc được khi logo chạy ngang qua.
 */
export function compositeUnder(text: Bitmap, layer: Bitmap, halo: number): Bitmap {
  if (text.width !== layer.width || text.height !== layer.height) {
    throw new Error(`Lớp logo ${layer.width}×${layer.height} khác ảnh tem ${text.width}×${text.height}`)
  }
  const keepOut = dilate(text, halo)
  const data = new Uint8Array(text.data.length)
  for (let i = 0; i < data.length; i++) {
    data[i] = (text.data[i] ?? 0) | ((layer.data[i] ?? 0) & ~(keepOut.data[i] ?? 0) & 0xff)
  }
  return { width: text.width, height: text.height, data }
}
