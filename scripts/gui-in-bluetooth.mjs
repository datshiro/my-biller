#!/usr/bin/env node
// Dựng một phiếu ESC/POS mẫu (chữ UTF-8 tiếng Việt, đậm, chữ to, căn giữa, cắt giấy) rồi ghi ra đích:
//   node scripts/gui-in-bluetooth.mjs /dev/cu.Biller-quay     macOS: cổng serial của điện thoại đã ghép
//   node scripts/gui-in-bluetooth.mjs /dev/rfcomm0            Linux: sau `rfcomm bind 0 <MAC>`
//   node scripts/gui-in-bluetooth.mjs phieu-mau.bin           ra file, để xem byte hoặc gửi lại
// Đây là "máy gửi" để thử vòng thật: app phải nhận, dựng lại và in ra máy in nhiệt.
import { writeFileSync } from 'node:fs'

const target = process.argv[2]
if (!target) {
  console.error('Cần đích: đường dẫn cổng serial Bluetooth hoặc tên file.')
  process.exit(1)
}

const ESC = 0x1b
const GS = 0x1d
const parts = []
const cmd = (...bytes) => parts.push(Uint8Array.from(bytes))
const text = (s) => parts.push(new TextEncoder().encode(s))
const row = (left, right) => text(`${left}${' '.repeat(Math.max(1, 48 - [...left].length - [...right].length))}${right}\n`)

cmd(ESC, 0x40)
cmd(ESC, 0x61, 1)
cmd(GS, 0x21, 0x11)
text('QUÁN ĂN NGON\n')
cmd(GS, 0x21, 0x00)
text('12 Lê Lợi, Quận 1 · 0901 234 567\n')
text(`Phiếu gửi thử lúc ${new Date().toLocaleTimeString('vi-VN')}\n`)
cmd(ESC, 0x61, 0)
text('-'.repeat(48) + '\n')
row('Phở bò tái x2', '90.000đ')
row('Bún chả Hà Nội x1', '45.000đ')
row('Trà đá x3', '15.000đ')
text('-'.repeat(48) + '\n')
cmd(ESC, 0x45, 1)
cmd(GS, 0x21, 0x01)
row('TỔNG CỘNG', '150.000đ')
cmd(GS, 0x21, 0x00)
cmd(ESC, 0x45, 0)
cmd(ESC, 0x61, 1)
text('Cảm ơn quý khách — hẹn gặp lại!\n')
cmd(ESC, 0x64, 3)
cmd(GS, 0x56, 66, 3)

const out = Buffer.concat(parts)
writeFileSync(target, out)
console.log(`Đã ghi ${out.length} byte tới ${target}`)
