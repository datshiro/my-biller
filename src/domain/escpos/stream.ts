import { DOTS_PER_LINE, bytesPerRow } from './bitmap.ts'
import type { Bitmap } from './bitmap.ts'
import { ESC, GS } from './encode.ts'

const FS = 0x1c
const LF = 0x0a
const CR = 0x0d
const HT = 0x09
const DLE = 0x10

export type Align = 'left' | 'center' | 'right'

export interface TextStyle {
  bold: boolean
  underline: boolean
  widthMul: number
  heightMul: number
}

export type Token =
  | { kind: 'text'; bytes: Uint8Array }
  | { kind: 'lf' }
  | { kind: 'reset' }
  | { kind: 'style'; patch: Partial<TextStyle> }
  | { kind: 'align'; align: Align }
  | { kind: 'feed-lines'; n: number }
  | { kind: 'feed-dots'; n: number }
  | { kind: 'raster'; bitmap: Bitmap }
  | { kind: 'cut' }
  | { kind: 'ignored' }

export interface Scan {
  /** Mỗi token kèm vị trí byte ngay sau nó — framer cắt job đúng sau lệnh cắt giấy. */
  tokens: { token: Token; end: number }[]
  /** Số byte đã thành token. Phần sau là một lệnh còn dở (chờ khúc sau), hoặc lệnh lạ nếu có `error`. */
  consumed: number
  /** Gặp lệnh lạ tại `consumed`: token trước đó vẫn dùng được (job đã cắt xong không bị kéo theo). */
  error?: string
}

const hex = (b: number) => `0x${b.toString(16).padStart(2, '0').toUpperCase()}`

/** Lệnh có tham số cố định mà bản dựng lại bỏ qua được (bảng mã, giãn dòng, font, lề…). */
const IGNORED_ESC: Record<number, number> = {
  0x74: 3, 0x32: 2, 0x33: 3, 0x4d: 3, 0x20: 3, 0x7b: 3, 0x52: 3,
  // ESC p: mở két tiền; ESC B: còi báo — máy giả không có, bỏ qua.
  0x70: 5, 0x42: 4,
}
const IGNORED_GS: Record<number, number> = { 0x42: 3, 0x4c: 4, 0x57: 4, 0x61: 3 }

function alignOf(n: number): Align | null {
  if (n === 0 || n === 48) return 'left'
  if (n === 1 || n === 49) return 'center'
  if (n === 2 || n === 50) return 'right'
  return null
}

/**
 * Máy in Bluetooth giả: đọc luồng ESC/POS người gửi đẩy tới. Dễ tính hơn `decodeJob` (chữ, kiểu chữ, căn
 * lề, ảnh `GS v 0` hẹp hơn khổ) nhưng lệnh lạ vẫn là lỗi: độ dài tham số của lệnh lạ không biết được, bỏ qua
 * đoán mò thì phần sau đọc lệch và in ra giấy rác. Thiếu byte ở cuối chỉ dừng lại, trả `consumed`.
 */
export function scanStream(bytes: Uint8Array, from = 0): Scan {
  const tokens: Scan['tokens'] = []
  try {
    return { tokens, consumed: scanInto(bytes, from, tokens) }
  } catch (error) {
    return { tokens, consumed: tokens.at(-1)?.end ?? from, error: (error as Error).message }
  }
}

function scanInto(bytes: Uint8Array, from: number, tokens: Scan['tokens']): number {
  let p = from
  const at = (i: number) => bytes[i] ?? 0
  const has = (n: number) => p + n <= bytes.length
  const push = (token: Token, size: number) => {
    p += size
    tokens.push({ token, end: p })
  }

  while (p < bytes.length) {
    const b = at(p)
    if (b >= 0x20 || b === HT) {
      let q = p
      while (q < bytes.length && (at(q) >= 0x20 || at(q) === HT)) q++
      push({ kind: 'text', bytes: bytes.subarray(p, q) }, q - p)
      continue
    }
    if (b === LF) {
      push({ kind: 'lf' }, 1)
      continue
    }
    if (b === CR) {
      push({ kind: 'ignored' }, 1)
      continue
    }
    if (b === ESC) {
      if (!has(2)) break
      const fn = at(p + 1)
      if (fn === 0x40) {
        push({ kind: 'reset' }, 2)
        continue
      }
      if (fn === 0x69 || fn === 0x6d) {
        push({ kind: 'cut' }, 2)
        continue
      }
      const ignored = IGNORED_ESC[fn]
      if (ignored) {
        if (!has(ignored)) break
        push({ kind: 'ignored' }, ignored)
        continue
      }
      if (!has(3)) break
      const n = at(p + 2)
      switch (fn) {
        case 0x21:
          push(
            {
              kind: 'style',
              patch: { bold: (n & 0x08) !== 0, heightMul: n & 0x10 ? 2 : 1, widthMul: n & 0x20 ? 2 : 1, underline: (n & 0x80) !== 0 },
            },
            3,
          )
          continue
        case 0x45:
        case 0x47:
          push({ kind: 'style', patch: { bold: (n & 1) === 1 } }, 3)
          continue
        case 0x2d:
          push({ kind: 'style', patch: { underline: n === 1 || n === 2 || n === 49 || n === 50 } }, 3)
          continue
        case 0x61: {
          const align = alignOf(n)
          if (!align) throw new Error(`ESC a ${n} tại vị trí ${p}: căn lề không hiểu`)
          push({ kind: 'align', align }, 3)
          continue
        }
        case 0x64:
          push({ kind: 'feed-lines', n }, 3)
          continue
        case 0x4a:
          push({ kind: 'feed-dots', n }, 3)
          continue
      }
      throw new Error(`Lệnh chưa hỗ trợ ESC ${hex(fn)} tại vị trí ${p}`)
    }
    if (b === GS) {
      if (!has(2)) break
      const fn = at(p + 1)
      const ignored = IGNORED_GS[fn]
      if (ignored) {
        if (!has(ignored)) break
        push({ kind: 'ignored' }, ignored)
        continue
      }
      if (fn === 0x21) {
        if (!has(3)) break
        const n = at(p + 2)
        push({ kind: 'style', patch: { widthMul: ((n >> 4) & 7) + 1, heightMul: (n & 7) + 1 } }, 3)
        continue
      }
      if (fn === 0x56) {
        if (!has(3)) break
        const m = at(p + 2)
        if (m === 0 || m === 1 || m === 48 || m === 49) {
          push({ kind: 'cut' }, 3)
          continue
        }
        if (m === 65 || m === 66) {
          if (!has(4)) break
          push({ kind: 'cut' }, 4)
          continue
        }
        throw new Error(`GS V ${m} tại vị trí ${p}: chế độ cắt không hiểu`)
      }
      if (fn === 0x76) {
        if (!has(8)) break
        const m = at(p + 3)
        if (at(p + 2) !== 0x30 || (m !== 0 && m !== 48)) {
          throw new Error(`GS v ${hex(at(p + 2))} m=${m} tại vị trí ${p}: chỉ hiểu GS v 0 cỡ thường`)
        }
        const xBytes = at(p + 4) | (at(p + 5) << 8)
        const rows = at(p + 6) | (at(p + 7) << 8)
        if (xBytes === 0 || xBytes > bytesPerRow(DOTS_PER_LINE)) {
          throw new Error(`Ảnh GS v 0 rộng ${xBytes * 8} chấm tại vị trí ${p}: khổ giấy chỉ ${DOTS_PER_LINE}`)
        }
        if (!has(8 + xBytes * rows)) break
        const data = bytes.slice(p + 8, p + 8 + xBytes * rows)
        push({ kind: 'raster', bitmap: { width: xBytes * 8, height: rows, data } }, 8 + xBytes * rows)
        continue
      }
      throw new Error(`Lệnh chưa hỗ trợ GS ${hex(fn)} tại vị trí ${p}`)
    }
    if (b === FS) {
      if (!has(2)) break
      const fn = at(p + 1)
      // FS & / FS .: bật/tắt chế độ chữ Hán — nhiều app gửi kèm mặc định, vô hại với bản dựng lại.
      if (fn === 0x26 || fn === 0x2e) {
        push({ kind: 'ignored' }, 2)
        continue
      }
      throw new Error(`Lệnh chưa hỗ trợ FS ${hex(fn)} tại vị trí ${p}`)
    }
    if (b === DLE) {
      // DLE EOT / DLE ENQ: người gửi hỏi trạng thái máy in. Máy giả không trả lời được, bỏ qua là đủ.
      if (!has(2)) break
      if (at(p + 1) === 0x04 || at(p + 1) === 0x05) {
        if (!has(3)) break
        push({ kind: 'ignored' }, 3)
        continue
      }
    }
    throw new Error(`Byte điều khiển lạ ${hex(b)} tại vị trí ${p}`)
  }
  return p
}

export type Block =
  | { kind: 'line'; align: Align; runs: { text: string; style: TextStyle }[] }
  | { kind: 'feed'; dots: number }
  | { kind: 'raster'; align: Align; bitmap: Bitmap }

/** Một dòng chữ cỡ thường chiếm 30 chấm (1/6 inch ở 203 dpi) — `ESC d n` đẩy đúng n dòng như thế. */
export const LINE_DOTS = 30

const PLAIN: TextStyle = { bold: false, underline: false, widthMul: 1, heightMul: 1 }

/** Cả job → các khối để dựng lại. Job dừng giữa một lệnh là lỗi: phần ảnh/lệnh còn thiếu không đoán được. */
export function parseJob(bytes: Uint8Array): Block[] {
  const { tokens, consumed, error } = scanStream(bytes)
  if (error) throw new Error(error)
  if (consumed < bytes.length) {
    throw new Error(`Job dừng giữa chừng một lệnh tại vị trí ${consumed} (${bytes.length - consumed} byte cuối)`)
  }

  // Người gửi phải gửi UTF-8 (ESC t bị bỏ qua). Bảng mã khác in ra "�" mà vẫn báo Đã in — nên ném cho rõ.
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const blocks: Block[] = []
  let style: TextStyle = { ...PLAIN }
  let align: Align = 'left'
  let runs: { text: string; style: TextStyle }[] = []
  let pending: Uint8Array[] = []

  const closeRun = () => {
    if (pending.length === 0) return
    const size = pending.reduce((n, part) => n + part.length, 0)
    const joined = new Uint8Array(size)
    let offset = 0
    for (const part of pending) {
      joined.set(part, offset)
      offset += part.length
    }
    let text: string
    try {
      text = decoder.decode(joined)
    } catch {
      throw new Error('Chữ trong phiếu không phải UTF-8 — máy gửi phải gửi chữ UTF-8, không dùng bảng mã.')
    }
    runs.push({ text, style })
    pending = []
  }
  const endLine = (emptyFeeds: boolean) => {
    closeRun()
    if (runs.length > 0) blocks.push({ kind: 'line', align, runs })
    else if (emptyFeeds) blocks.push({ kind: 'feed', dots: LINE_DOTS })
    runs = []
  }

  for (const { token } of tokens) {
    switch (token.kind) {
      case 'text':
        pending.push(token.bytes)
        break
      case 'lf':
        endLine(true)
        break
      case 'reset':
        closeRun()
        style = { ...PLAIN }
        align = 'left'
        break
      case 'style':
        closeRun()
        style = { ...style, ...token.patch }
        break
      case 'align':
        align = token.align
        break
      case 'feed-lines':
        endLine(false)
        if (token.n > 0) blocks.push({ kind: 'feed', dots: token.n * LINE_DOTS })
        break
      case 'feed-dots':
        endLine(false)
        if (token.n > 0) blocks.push({ kind: 'feed', dots: token.n })
        break
      case 'raster':
        endLine(false)
        blocks.push({ kind: 'raster', align, bitmap: token.bitmap })
        break
      case 'cut':
        endLine(false)
        break
      case 'ignored':
        break
    }
  }
  endLine(false)

  // Dòng trống/đẩy giấy ở cuối job không mang nội dung: bỏ để job chỉ có `ESC @` hay "\n\n" thành rỗng.
  while (blocks.length > 0 && blocks[blocks.length - 1]?.kind === 'feed') blocks.pop()
  return blocks
}
