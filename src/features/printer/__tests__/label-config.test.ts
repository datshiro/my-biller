// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  LABEL_PRINTER_CONFIG_KEY,
  parseLabelPrinterConfig,
  readLabelPrinterConfig,
  saveLabelPrinterConfig,
} from '../label-config'

const raw = { host: '192.168.1.60', port: '9100', widthMm: '40', heightMm: '30', gapMm: '2' }

afterEach(() => localStorage.clear())

describe('parseLabelPrinterConfig', () => {
  it('đủ trường hợp lệ → số nguyên mm, cổng trống dùng 9100', () => {
    expect(parseLabelPrinterConfig({ ...raw, port: '' })).toEqual({
      ok: true,
      value: { host: '192.168.1.60', port: 9100, widthMm: 40, heightMm: 30, gapMm: 2 },
    })
  })

  it('IP sai → dùng đúng câu lỗi của máy in phiếu', () => {
    expect(parseLabelPrinterConfig({ ...raw, host: '999.1.1.1' })).toEqual({
      ok: false,
      error: 'Địa chỉ IP không hợp lệ (ví dụ 192.168.1.50).',
    })
  })

  it('khổ ngoài tầm XP-365B hoặc mm lẻ → lỗi, không làm tròn hộ', () => {
    expect(parseLabelPrinterConfig({ ...raw, widthMm: '80' }).ok).toBe(false)
    expect(parseLabelPrinterConfig({ ...raw, widthMm: '40.5' }).ok).toBe(false)
    expect(parseLabelPrinterConfig({ ...raw, heightMm: '15' }).ok).toBe(false)
    expect(parseLabelPrinterConfig({ ...raw, gapMm: '11' }).ok).toBe(false)
    expect(parseLabelPrinterConfig({ ...raw, gapMm: '0' }).ok).toBe(true)
  })
})

describe('đọc/ghi cấu hình máy in tem', () => {
  it('ghi rồi đọc lại được đúng bản ghi, dưới khoá riêng khác máy in phiếu', () => {
    const cfg = { host: '192.168.1.60', port: 9100, widthMm: 50, heightMm: 30, gapMm: 2 }
    saveLabelPrinterConfig(cfg)
    expect(readLabelPrinterConfig()).toEqual(cfg)
    expect(localStorage.getItem('may-in')).toBeNull()
  })

  it('khoá rác, thiếu trường hoặc khổ sai → null (xử như chưa cài)', () => {
    expect(readLabelPrinterConfig()).toBeNull()
    localStorage.setItem(LABEL_PRINTER_CONFIG_KEY, '{hỏng')
    expect(readLabelPrinterConfig()).toBeNull()
    localStorage.setItem(LABEL_PRINTER_CONFIG_KEY, JSON.stringify({ host: '192.168.1.60', port: 9100 }))
    expect(readLabelPrinterConfig()).toBeNull()
    localStorage.setItem(
      LABEL_PRINTER_CONFIG_KEY,
      JSON.stringify({ host: '192.168.1.60', port: 9100, widthMm: 200, heightMm: 30, gapMm: 2 }),
    )
    expect(readLabelPrinterConfig()).toBeNull()
  })
})
