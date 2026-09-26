// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LabelPrinterSection } from '../label-printer-section'
import { LABEL_PRINTER_CONFIG_KEY } from '../../printer/label-config'

const shim = vi.hoisted(() => ({ native: false }))
vi.mock('../../printer/printer-sink', () => ({ isNativeApp: () => shim.native }))

afterEach(() => {
  cleanup()
  localStorage.clear()
  shim.native = false
})

describe('mục MÁY IN TEM trong Cài đặt', () => {
  it('khổ mặc định 60×40 khe 2 (cuộn tem của quán); nhập IP rồi LƯU → ghi đủ khổ vào khoá riêng', async () => {
    render(<LabelPrinterSection />)
    expect((screen.getByLabelText('Rộng tem (mm)') as HTMLInputElement).value).toBe('60')
    expect((screen.getByLabelText('Cao tem (mm)') as HTMLInputElement).value).toBe('40')
    expect((screen.getByLabelText('Khe hở (mm)') as HTMLInputElement).value).toBe('2')

    await userEvent.type(screen.getByLabelText('Địa chỉ IP máy in tem'), '192.168.1.60')
    await userEvent.click(screen.getByRole('button', { name: 'LƯU MÁY IN TEM' }))

    expect(screen.getByText('Đã lưu 192.168.1.60:9100 · tem 60×40 mm')).toBeDefined()
    expect(JSON.parse(localStorage.getItem(LABEL_PRINTER_CONFIG_KEY) ?? '')).toEqual({
      host: '192.168.1.60',
      port: 9100,
      widthMm: 60,
      heightMm: 40,
      gapMm: 2,
    })
  })

  it('khổ sai → hiện lỗi, không ghi gì', async () => {
    render(<LabelPrinterSection />)
    await userEvent.type(screen.getByLabelText('Địa chỉ IP máy in tem'), '192.168.1.60')
    await userEvent.clear(screen.getByLabelText('Rộng tem (mm)'))
    await userEvent.type(screen.getByLabelText('Rộng tem (mm)'), '90')
    await userEvent.click(screen.getByRole('button', { name: 'LƯU MÁY IN TEM' }))

    expect(screen.getByRole('alert').textContent).toMatch(/Chiều rộng tem/)
    expect(localStorage.getItem(LABEL_PRINTER_CONFIG_KEY)).toBeNull()
  })

  it('mở lại mục → hiện cấu hình đã lưu; gõ lại thì dòng "Đã lưu" biến mất', async () => {
    localStorage.setItem(
      LABEL_PRINTER_CONFIG_KEY,
      JSON.stringify({ host: '192.168.1.60', port: 9100, widthMm: 50, heightMm: 25, gapMm: 3 }),
    )
    render(<LabelPrinterSection />)
    expect((screen.getByLabelText('Rộng tem (mm)') as HTMLInputElement).value).toBe('50')
    expect(screen.getByText('Đã lưu 192.168.1.60:9100 · tem 50×25 mm')).toBeDefined()

    await userEvent.type(screen.getByLabelText('Cao tem (mm)'), '0')
    expect(screen.queryByText(/Đã lưu/)).toBeNull()
  })

  it('ghi chú "chỉ có trong app Android" hiện trên web, ẩn trong APK', () => {
    const { unmount } = render(<LabelPrinterSection />)
    expect(screen.getByText(/In tem chỉ có trong app Android/)).toBeDefined()
    unmount()
    shim.native = true
    render(<LabelPrinterSection />)
    expect(screen.queryByText(/In tem chỉ có trong app Android/)).toBeNull()
  })
})
