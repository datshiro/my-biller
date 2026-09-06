// Máy in nhiệt giả: nghe TCP 9100 như SAPO SPR02, mỗi kết nối là một job. Khi bên gửi đóng, giải mã đúng
// bằng bộ decode của app rồi ghi PNG 1-bit — byte lạ thì giữ nguyên .bin để soi.
//   node scripts/may-in-ao.mjs [--port 9100] [--out ./may-in-ao-out]
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { decodeJob } from '../src/domain/escpos/decode.ts'
import { encodePng1 } from '../src/domain/escpos/png-1bit.ts'

let values
try {
  values = parseArgs({
    options: {
      port: { type: 'string', default: '9100' },
      out: { type: 'string', default: './may-in-ao-out' },
    },
  }).values
} catch (err) {
  console.error(`${err.message}\nDùng: [--port 9100] [--out ./may-in-ao-out]`)
  process.exit(2)
}
const port = Number(values.port)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`--port phải là số nguyên 1–65535, nhận: ${values.port}`)
  process.exit(2)
}
const outDir = values.out
await mkdir(outDir, { recursive: true })

const vi = new Intl.NumberFormat('vi-VN')
const stamp = () => {
  const now = new Date()
  const hhmmss = now.toTimeString().slice(0, 8).replaceAll(':', '')
  return `${hhmmss}-${String(now.getMilliseconds()).padStart(3, '0')}`
}

const server = createServer((socket) => {
  const from = `${socket.remoteAddress}:${socket.remotePort}`
  const parts = []
  let ended = false
  console.log(`← kết nối từ ${from}`)
  socket.on('data', (buf) => parts.push(buf))
  socket.on('end', () => {
    ended = true
  })
  socket.on('error', (err) => console.error(`  lỗi socket ${from}: ${err.message}`))
  // Xử lý ở 'close' chứ không phải 'end': bên gửi bị giết giữa chừng thì không có FIN, nhưng byte đã gom
  // vẫn phải ra file để soi.
  socket.once('close', async () => {
    const bytes = Buffer.concat(parts)
    if (bytes.length === 0) {
      console.log(`  ${from} đóng mà không gửi gì — bỏ qua`)
      return
    }
    if (!ended) console.warn(`  ${from} đứt trước khi đóng hẳn — xử lý ${vi.format(bytes.length)} byte đã gom`)
    const name = `job-${stamp()}`
    try {
      const { bitmap, commands } = decodeJob(bytes)
      const png = await encodePng1(bitmap)
      const file = join(outDir, `${name}.png`)
      await writeFile(file, png)
      console.log(
        `→ ${file} ${bitmap.width}×${bitmap.height}, ${commands.length} lệnh, ` +
          `${vi.format(bytes.length)} byte nhận, PNG ${vi.format(png.length)} byte`,
      )
      console.log(`  ${commands.join(' · ')}`)
    } catch (err) {
      const file = join(outDir, `${name}.bin`)
      await writeFile(file, bytes)
      console.error(`✗ ${err.message} — giữ nguyên ${vi.format(bytes.length)} byte ở ${file}`)
    }
  })
})

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Cổng ${port} đang bận — có máy in ảo khác đang chạy?` : err.message)
  process.exit(1)
})
server.listen(port, () => console.log(`Máy in ảo nghe cổng ${port}, ghi ảnh vào ${outDir}. Ctrl+C để dừng.`))
