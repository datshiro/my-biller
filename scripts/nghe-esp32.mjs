#!/usr/bin/env node
// Nghe nhật ký của firmware firmware/esp32-ble-sniffer rồi lưu mỗi lần in thành một file .bin:
//   node scripts/nghe-esp32.mjs /dev/cu.usbmodem5CCC…     cổng COM của board (macOS)
//   node scripts/nghe-esp32.mjs nhat-ky.log               phát lại một file nhật ký, để thử không cần board
// Một lần in = các dòng DATA từ lúc nối tới khi ngắt, hoặc tới khi im quá IDLE_MS (Grab có thể giữ nối).
import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { formatSummary, parseSnifferLine, summarizeCapture } from '../src/domain/escpos/capture-summary.ts'

const IDLE_MS = 2000
const OUT_DIR = 'captures'

const target = process.argv[2]
if (!target) {
  console.error('Cần cổng serial của board (/dev/cu.usbmodem…) hoặc file nhật ký.')
  process.exit(1)
}

// macOS không giữ tốc độ sau khi đóng cổng (và mở cổng chưa `clocal` thì treo), nên cài tốc độ và đọc phải
// cùng một lần mở: shell mở cổng, `stty` cài, rồi `cat` đọc tiếp trên chính fd đó.
const reader = statSync(target).isFile()
  ? null
  : spawn('sh', ['-c', 'exec <"$1"; stty 921600 raw -echo clocal && exec cat', 'sh', target], {
      stdio: ['ignore', 'pipe', 'inherit'],
    })

const clock = () => new Date().toTimeString().slice(0, 8)
const stamp = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
const say = (text) => console.log(`${clock()} ${text}`)

let session = null
let jobCount = 0
let lastOther = ''

const openSession = (device) => ({ device, parts: [], chars: new Set(), timer: null })

function flush() {
  if (!session) return
  clearTimeout(session.timer)
  session.timer = null
  if (session.parts.length === 0) return
  const size = session.parts.reduce((n, part) => n + part.length, 0)
  const joined = new Uint8Array(size)
  let offset = 0
  for (const part of session.parts) {
    joined.set(part, offset)
    offset += part.length
  }
  session.parts = []

  jobCount += 1
  mkdirSync(OUT_DIR, { recursive: true })
  const file = `${OUT_DIR}/grab-${stamp()}-${String(jobCount).padStart(2, '0')}.bin`
  writeFileSync(file, joined)
  say(`▸ job #${jobCount}  ${size} byte  qua ${[...session.chars].join(', ')}  → ${file}`)
  for (const line of formatSummary(summarizeCapture(joined))) console.log(line)
}

function handle(raw) {
  const event = parseSnifferLine(raw)
  if (event.kind === 'conn') {
    flush()
    session = openSession(event.device)
    say(`✓ nối: ${event.device}`)
  } else if (event.kind === 'mtu') {
    say(`· MTU ${event.mtu}`)
  } else if (event.kind === 'sub') {
    say(`· Grab đăng ký nhận thông báo: ${event.char}`)
  } else if (event.kind === 'data') {
    session ??= openSession('?')
    session.parts.push(event.bytes)
    session.chars.add(event.char)
    clearTimeout(session.timer)
    session.timer = setTimeout(flush, IDLE_MS)
  } else if (event.kind === 'disc') {
    flush()
    session = null
    say('✗ ngắt')
  } else if (event.line && event.line !== lastOther) {
    lastOther = event.line
    console.log(`  ${event.line}`)
  }
}

const lines = createInterface({ input: reader ? reader.stdout : createReadStream(target) })
lines.on('line', handle)
lines.on('close', () => {
  flush()
  clearTimeout(session?.timer)
})
process.on('SIGINT', () => {
  flush()
  reader?.kill()
  process.exit(0)
})
