import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PORT,
  PRINTER_CONFIG_KEY,
  parsePrinterConfig,
  readPrinterConfig,
  savePrinterConfig,
} from '../printer-config'

afterEach(() => localStorage.clear())

describe('parsePrinterConfig', () => {
  it('IPv4 hợp lệ + cổng hợp lệ → ok', () => {
    const r = parsePrinterConfig('192.168.1.50', '9100')
    expect(r).toEqual({ ok: true, value: { host: '192.168.1.50', port: 9100 } })
  })

  it('cổng trống → dùng cổng mặc định 9100', () => {
    const r = parsePrinterConfig('192.168.1.50', '')
    expect(r.ok && r.value.port).toBe(DEFAULT_PORT)
  })

  it('octet > 255 → lỗi, không lưu', () => {
    expect(parsePrinterConfig('256.1.1.1', '9100').ok).toBe(false)
  })

  it('thiếu octet → lỗi', () => {
    expect(parsePrinterConfig('1.2.3', '9100').ok).toBe(false)
  })

  it('IP rỗng → lỗi', () => {
    expect(parsePrinterConfig('   ', '9100').ok).toBe(false)
  })

  it('khoảng trắng trong địa chỉ → lỗi', () => {
    expect(parsePrinterConfig('192.168 .1.50', '9100').ok).toBe(false)
  })

  it('hostname không khoảng trắng → hợp lệ', () => {
    const r = parsePrinterConfig('may-in.local', '9100')
    expect(r.ok && r.value.host).toBe('may-in.local')
  })

  it('dán nhầm cổng vào ô IP (192.168.1.50:9100) → lỗi', () => {
    expect(parsePrinterConfig('192.168.1.50:9100', '9100').ok).toBe(false)
  })

  it('dán nhầm cả URL (http://192.168.1.50) → lỗi', () => {
    expect(parsePrinterConfig('http://192.168.1.50', '9100').ok).toBe(false)
  })

  it('cổng dạng 0x10 / 1e3 → lỗi (chỉ nhận chữ số)', () => {
    expect(parsePrinterConfig('192.168.1.50', '0x10').ok).toBe(false)
    expect(parsePrinterConfig('192.168.1.50', '1e3').ok).toBe(false)
  })

  it('cổng 0 / 70000 / abc → lỗi', () => {
    expect(parsePrinterConfig('192.168.1.50', '0').ok).toBe(false)
    expect(parsePrinterConfig('192.168.1.50', '70000').ok).toBe(false)
    expect(parsePrinterConfig('192.168.1.50', 'abc').ok).toBe(false)
  })
})

describe('readPrinterConfig', () => {
  it('chưa lưu gì → null', () => {
    expect(readPrinterConfig()).toBeNull()
  })

  it('JSON hỏng → null, không ném', () => {
    localStorage.setItem(PRINTER_CONFIG_KEY, '{host:')
    expect(readPrinterConfig()).toBeNull()
  })

  it('thiếu/sai kiểu trường → null', () => {
    localStorage.setItem(PRINTER_CONFIG_KEY, JSON.stringify({ host: '192.168.1.50' }))
    expect(readPrinterConfig()).toBeNull()
    localStorage.setItem(PRINTER_CONFIG_KEY, JSON.stringify({ host: 10, port: 9100 }))
    expect(readPrinterConfig()).toBeNull()
  })

  it('lưu rồi đọc lại → đúng cấu hình', () => {
    savePrinterConfig({ host: '10.0.0.9', port: 9100 })
    expect(readPrinterConfig()).toEqual({ host: '10.0.0.9', port: 9100 })
  })
})
