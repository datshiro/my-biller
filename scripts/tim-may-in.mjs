// Dò máy in trong mạng LAN: quét cả dải /24 của máy này tìm thiết bị mở TCP 9100 (cổng in thô).
// Máy in phiếu và máy in tem đều nghe cổng 9100, nên có thể ra nhiều địa chỉ; --in-thu gửi một tem TSPL
// mẫu tới MỘT địa chỉ để biết máy nào là máy in tem (máy in phiếu ESC/POS sẽ in chữ lạ hoặc im lặng).
//   node scripts/tim-may-in.mjs [--subnet 192.168.1] [--port 9100] [--timeout 800]
//   node scripts/tim-may-in.mjs --in-thu 192.168.1.60 [--rong 50 --cao 30 --khe 2]
import { execFile } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { createConnection } from 'node:net'
import { parseArgs } from 'node:util'
import { promisify } from 'node:util'

const run = promisify(execFile)

let values
try {
  values = parseArgs({
    options: {
      subnet: { type: 'string' },
      port: { type: 'string', default: '9100' },
      timeout: { type: 'string', default: '800' },
      'in-thu': { type: 'string' },
      rong: { type: 'string', default: '50' },
      cao: { type: 'string', default: '30' },
      khe: { type: 'string', default: '2' },
    },
  }).values
} catch (err) {
  console.error(`${err.message}\nDùng: [--subnet 192.168.1] [--port 9100] [--timeout 800] | --in-thu IP [--rong 50 --cao 30 --khe 2]`)
  process.exit(2)
}

const integer = (name, text, min, max) => {
  const n = Number(text)
  if (!Number.isInteger(n) || n < min || n > max) {
    console.error(`--${name} phải là số nguyên ${min}–${max}, nhận: ${text}`)
    process.exit(2)
  }
  return n
}
const port = integer('port', values.port, 1, 65535)
const timeoutMs = integer('timeout', values.timeout, 100, 10_000)
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const validIp = (ip) => IPV4.test(ip) && ip.split('.').every((part) => Number(part) <= 255)

// Chỉ card WiFi/Ethernet thật (en*, eth*, wlan*): quét luôn cả VPN, Docker hay mạng ảo là dò cả mạng công ty.
const PHYSICAL_NIC = /^(en|eth|wlan|wlp|enp)/

function lanAddresses() {
  return Object.entries(networkInterfaces())
    .filter(([name]) => PHYSICAL_NIC.test(name))
    .flatMap(([, nics]) => nics ?? [])
    .filter((nic) => nic.family === 'IPv4' && !nic.internal)
    .map((nic) => nic.address)
}

function openPort(host) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port })
    const done = (open) => {
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

async function macOf(ip) {
  try {
    const { stdout } = await run('arp', ['-n', ip])
    const mac = stdout.match(/([0-9a-f]{1,2}(?::[0-9a-f]{1,2}){5})/i)?.[1]
    return mac ? mac.split(':').map((byte) => byte.padStart(2, '0')).join(':') : null
  } catch {
    return null
  }
}

async function printTest(ip) {
  if (!validIp(ip)) {
    console.error(`--in-thu cần một địa chỉ IPv4, nhận: ${ip}`)
    process.exit(2)
  }
  const width = integer('rong', values.rong, 30, 72)
  const height = integer('cao', values.cao, 25, 100)
  const gap = integer('khe', values.khe, 0, 10)
  const job =
    `SIZE ${width} mm,${height} mm\r\nGAP ${gap} mm,0 mm\r\nDIRECTION 1,0\r\nREFERENCE 0,0\r\nCLS\r\n` +
    `TEXT 16,16,"3",0,1,1,"MAY IN TEM"\r\nTEXT 16,56,"3",0,1,1,"${ip}"\r\nPRINT 1,1\r\n`
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: ip, port }, () => socket.end(job, 'ascii'))
    socket.setTimeout(3000, () => {
      socket.destroy()
      reject(new Error('không trả lời sau 3 giây'))
    })
    socket.once('error', reject)
    socket.once('close', resolve)
  })
  console.log(`Đã gửi tem thử tới ${ip}:${port}. Ra tem "MAY IN TEM ${ip}" là máy in tem; máy in phiếu sẽ in chữ lạ hoặc không in.`)
}

async function scan() {
  const own = lanAddresses()
  const prefixes = values.subnet
    ? [values.subnet]
    : [...new Set(own.map((ip) => ip.split('.').slice(0, 3).join('.')))]
  if (prefixes.length === 0) {
    console.error('Không thấy card WiFi/Ethernet nào có địa chỉ IPv4. Kết nối mạng hoặc truyền --subnet 192.168.1')
    process.exit(1)
  }
  for (const prefix of prefixes) {
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(prefix) || !validIp(`${prefix}.1`)) {
      console.error(`--subnet phải có dạng 192.168.1, nhận: ${prefix}`)
      process.exit(2)
    }
  }

  const found = []
  for (const prefix of prefixes) {
    console.log(`Quét ${prefix}.1–254 cổng ${port}…`)
    const hosts = Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`)
    const queue = [...hosts]
    const worker = async () => {
      for (let host = queue.shift(); host; host = queue.shift()) {
        if (await openPort(host)) found.push(host)
      }
    }
    await Promise.all(Array.from({ length: 64 }, worker))
  }

  if (found.length === 0) {
    console.log('Không thấy thiết bị nào mở cổng. Kiểm tra máy in đã bật, cùng WiFi/LAN với máy này, rồi thử --subnet khác.')
    return
  }
  found.sort((a, b) => a.split('.').map(Number).reduce((x, y) => x * 256 + y) - b.split('.').map(Number).reduce((x, y) => x * 256 + y))
  console.log(`\nThiết bị mở cổng ${port}:`)
  for (const ip of found) {
    const mac = await macOf(ip)
    const note = own.includes(ip) ? '  ← máy này (có thể là máy in ảo scripts/may-in-ao.mjs)' : ''
    console.log(`  ${ip}${mac ? `  MAC ${mac}` : ''}${note}`)
  }
  console.log(`\nNhiều địa chỉ thì chạy: node scripts/tim-may-in.mjs --in-thu <IP> để in tem thử và biết máy nào là máy in tem.`)
}

if (values['in-thu']) {
  try {
    await printTest(values['in-thu'])
  } catch (err) {
    console.error(`Không gửi được tới ${values['in-thu']}:${port}: ${err.message}`)
    process.exit(1)
  }
} else {
  await scan()
}
