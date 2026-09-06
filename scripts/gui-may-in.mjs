// Gửi một job ESC/POS từ laptop tới máy in nhiệt (hoặc máy in ảo) qua TCP 9100. Không đọc phản hồi:
// máy in RAW 9100 không nói gì, socket đóng là "đã gửi", không phải "đã in".
//   node scripts/gui-may-in.mjs --ip 192.168.1.50 [--port 9100] (--mau | --file bill.bin | --text "HELLO")
//                               [--reband 48] [--feed 5] [--timeout 3000]
import { readFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { parseArgs } from 'node:util'
import { decodeJob } from '../src/domain/escpos/decode.ts'
import { CUT_FEED, ESC, GS, encodeJob } from '../src/domain/escpos/encode.ts'
import { sampleBitmap } from '../src/domain/escpos/sample.ts'

const USAGE =
  'Dùng: --ip <ip> [--port 9100] (--mau | --file <x.bin> | --text "<ASCII>") [--reband N] [--feed N] [--timeout ms]'

let values
try {
  values = parseArgs({
    options: {
      ip: { type: 'string' },
      port: { type: 'string', default: '9100' },
      mau: { type: 'boolean', default: false },
      file: { type: 'string' },
      text: { type: 'string' },
      reband: { type: 'string' },
      feed: { type: 'string' },
      timeout: { type: 'string', default: '3000' },
    },
  }).values
} catch (err) {
  console.error(`${err.message}\n${USAGE}`)
  process.exit(2)
}

const sources = [values.mau, values.file !== undefined, values.text !== undefined].filter(Boolean).length
if (!values.ip || sources !== 1) {
  console.error(USAGE)
  process.exit(2)
}

function soNguyen(ten, raw, min, max) {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) {
    console.error(`--${ten} phải là số nguyên ${min}–${max}, nhận: ${raw}`)
    process.exit(2)
  }
  return n
}

const host = values.ip
const port = soNguyen('port', values.port, 1, 65535)
const timeout = soNguyen('timeout', values.timeout, 1, 600_000)
// 4095 là trần yL+yH×256 nhiều máy Epson-compatible chịu được cho một khối GS v 0; encodeJob cho tới 65535 theo
// định dạng, nhưng gửi khối lớn hơn ra máy thật thì máy có thể nuốt im.
const rowsPerBand = values.reband === undefined ? undefined : soNguyen('reband', values.reband, 1, 4095)
const feed = values.feed === undefined ? undefined : soNguyen('feed', values.feed, 0, 255)
const vi = new Intl.NumberFormat('vi-VN')

async function taoJob() {
  if (values.mau) return encodeJob(sampleBitmap(), { rowsPerBand, feed })
  if (values.file !== undefined) {
    const bytes = new Uint8Array(
      await readFile(values.file).catch((err) => {
        throw new Error(`Không đọc được ${values.file}: ${err.code ?? err.message}`)
      }),
    )
    // --reband / --feed: đóng lại cùng bill với khối hoặc feed khác ngay tại quán, không dựng lại app
    if (rowsPerBand === undefined && feed === undefined) return bytes
    return encodeJob(decodeJob(bytes).bitmap, { rowsPerBand, feed })
  }
  // Chỉ để thử đường dây với máy in thật: máy in ảo không đọc được text (không phải GS v 0) và sẽ giữ .bin
  if (/[^\x20-\x7e]/.test(values.text)) throw new Error('--text chỉ nhận ASCII — không in được tiếng Việt bằng đường này.')
  return Uint8Array.from([ESC, 0x40, ...Buffer.from(values.text, 'ascii'), 0x0a, 0x0a, 0x0a, GS, 0x56, 66, feed ?? CUT_FEED])
}

function loiTiengViet(err) {
  switch (err.code) {
    case 'ECONNREFUSED':
      return `Máy in ${host}:${port} từ chối kết nối — máy in tắt hoặc cổng sai (RAW thường là 9100).`
    case 'ETIMEDOUT':
      return `Không nối được máy in ${host}:${port} — hết giờ chờ; kiểm tra máy in đã bật và cùng WiFi.`
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return `Không tới được ${host} — laptop không cùng mạng với máy in.`
    case 'ENOTFOUND':
      return `Không tìm thấy ${host} — kiểm tra lại địa chỉ.`
    default:
      return `Lỗi gửi tới ${host}:${port}: ${err.code ?? err.message}`
  }
}

let bytes
try {
  bytes = await taoJob()
} catch (err) {
  console.error(err.message)
  process.exit(2)
}

const started = performance.now()
let daGui = false
const socket = connect({ host, port })
socket.setTimeout(timeout)
socket.once('connect', () => {
  socket.end(bytes, () => {
    daGui = true
  })
})
// setTimeout của socket là hết-giờ-khi-im-lặng: nổ cả khi máy in đã nhận đủ byte nhưng không đóng kết nối
// (nhiều máy RAW 9100 làm vậy). Chỉ coi là lỗi nối khi chưa gửi được gì.
socket.once('timeout', () => {
  if (daGui) {
    console.warn(`Máy in ${host}:${port} không đóng kết nối sau ${timeout / 1000}s — byte đã gửi hết, tự đóng.`)
  } else {
    console.error(`Không nối được máy in ${host}:${port} trong ${timeout / 1000}s — kiểm tra máy in đã bật và cùng WiFi.`)
    process.exitCode = 1
  }
  socket.destroy()
})
socket.once('error', (err) => {
  console.error(loiTiengViet(err))
  process.exitCode = 1
})
socket.once('close', () => {
  if (process.exitCode) return
  console.log(`Đã gửi ${vi.format(bytes.length)} byte tới ${host}:${port}, đóng sau ${Math.round(performance.now() - started)} ms.`)
})
