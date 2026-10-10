import { fromBase64 } from '../base64.ts'
import { scanStream, type Token } from './stream.ts'

export interface CaptureSummary {
  bytes: number
  lines: string[]
  /** Chữ không giải mã được UTF-8 — máy gửi dùng bảng mã khác, `lines` đã giải mã tạm bằng latin1. */
  notUtf8: boolean
  rasters: { width: number; height: number }[]
  commands: string[]
  /** Parser dừng trước hết dữ liệu: lệnh lạ (`problem`) hoặc lệnh dở ở cuối; `rest` là vài byte hex tại chỗ dừng. */
  stoppedAt?: { offset: number; problem?: string; rest: string }
}

const COMMAND_NAME: Partial<Record<Token['kind'], string>> = {
  reset: 'ESC @',
  align: 'ESC a',
  style: 'kiểu chữ',
  'feed-lines': 'ESC d',
  'feed-dots': 'ESC J',
  raster: 'GS v 0',
  cut: 'cắt giấy',
}

const REST_BYTES = 16

function decode(bytes: Uint8Array): { text: string; utf8: boolean } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), utf8: true }
  } catch {
    return { text: new TextDecoder('latin1').decode(bytes), utf8: false }
  }
}

export function summarizeCapture(bytes: Uint8Array): CaptureSummary {
  const { tokens, consumed, error } = scanStream(bytes)
  const lines: string[] = []
  const rasters: CaptureSummary['rasters'] = []
  const commands: string[] = []
  let notUtf8 = false
  let pending: Uint8Array[] = []

  const closeLine = () => {
    if (pending.length === 0) return
    const joined = Uint8Array.from(pending.flatMap((part) => [...part]))
    const { text, utf8 } = decode(joined)
    if (!utf8) notUtf8 = true
    if (text.trim()) lines.push(text.trim())
    pending = []
  }

  for (const { token } of tokens) {
    if (token.kind === 'text') pending.push(token.bytes)
    else if (token.kind === 'lf') closeLine()
    if (token.kind === 'raster') rasters.push({ width: token.bitmap.width, height: token.bitmap.height })
    const name = COMMAND_NAME[token.kind]
    if (name && !commands.includes(name)) commands.push(name)
  }
  closeLine()

  const summary: CaptureSummary = { bytes: bytes.length, lines, notUtf8, rasters, commands }
  if (consumed < bytes.length) {
    const rest = [...bytes.subarray(consumed, consumed + REST_BYTES)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ')
    summary.stoppedAt = { offset: consumed, problem: error, rest }
  }
  return summary
}

export function formatSummary(summary: CaptureSummary): string[] {
  const out: string[] = []
  if (summary.rasters.length > 0) {
    out.push(`  ảnh : ${summary.rasters.map((r) => `raster ${r.width}×${r.height}`).join(', ')}`)
  }
  if (summary.lines.length > 0) {
    const shown = summary.lines.slice(0, 12).map((line) => `'${line}'`)
    const more = summary.lines.length > shown.length ? ` … (+${summary.lines.length - shown.length} dòng)` : ''
    out.push(`  chữ : ${shown.join(', ')}${more}${summary.notUtf8 ? '  [KHÔNG phải UTF-8]' : ''}`)
  }
  if (summary.rasters.length === 0 && summary.lines.length === 0) out.push('  (không có chữ hay ảnh đọc được)')
  out.push(`  lệnh: ${summary.commands.join(', ') || '(không có)'}`)
  if (summary.stoppedAt) {
    const { offset, problem, rest } = summary.stoppedAt
    out.push(`  dừng: tại byte ${offset}/${summary.bytes}${problem ? ` — ${problem}` : ' — lệnh dở ở cuối'} · ${rest}`)
  }
  return out
}

export type SnifferEvent =
  | { kind: 'conn'; device: string }
  | { kind: 'mtu'; mtu: number }
  | { kind: 'sub'; char: string }
  | { kind: 'data'; char: string; bytes: Uint8Array }
  | { kind: 'disc' }
  | { kind: 'other'; line: string }

/** Một dòng nhật ký firmware: `CONN <mac>`, `MTU <n>`, `SUB <char>`, `DATA <char> <base64>`, `DISC`. Dòng khác (log khởi động) là `other`. */
export function parseSnifferLine(raw: string): SnifferEvent {
  const line = raw.trim()
  const [word, first, second] = line.split(' ')
  if (word === 'CONN' && first) return { kind: 'conn', device: first }
  if (word === 'MTU' && Number.isInteger(Number(first))) return { kind: 'mtu', mtu: Number(first) }
  if (word === 'SUB' && first) return { kind: 'sub', char: first }
  if (word === 'DATA' && first && second !== undefined && /^[A-Za-z0-9+/]*={0,2}$/.test(second)) {
    return { kind: 'data', char: first, bytes: fromBase64(second) }
  }
  if (line === 'DISC') return { kind: 'disc' }
  return { kind: 'other', line }
}
