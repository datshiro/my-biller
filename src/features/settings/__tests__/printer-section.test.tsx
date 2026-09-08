// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrinterSection } from '../printer-section'
import { buildSampleRawbtHref } from '../../printer/rawbt-href'
import { PRINTER_CONFIG_KEY } from '../../printer/printer-config'

// Chụp lười cần canvas thật; jsdom không có. Trả ảnh 576 chấm hợp lệ để `buildSampleJob` chạy thật tới sink.
vi.mock('../../printer/thermal-capture', () => ({
  THERMAL_RATIO: 1.6,
  captureThermal: vi.fn(async () => ({ width: 576, height: 8, data: new Uint8ClampedArray(576 * 8 * 4).fill(255) })),
}))

// isNativeApp/nativeSink không lái được từ Robot trên web (native-only). Bật/tắt native qua cờ hoisted
// để kiểm cả nhánh web (IN THỬ khoá) lẫn nhánh native (gửi tới đúng IP đang gõ).
const shim = vi.hoisted(() => ({
  native: false,
  androidWeb: false,
  sink: vi.fn<(bytes: Uint8Array, cfg: { host: string; port: number }) => Promise<void>>(async () => {}),
}))
vi.mock('../../printer/printer-sink', () => ({
  isNativeApp: () => shim.native,
  isAndroidWeb: () => shim.androidWeb,
  nativeSink: shim.sink,
}))

// `buildSampleRawbtHref` chạy `CompressionStream` thật trong jsdom nếu không mock → treo.
vi.mock('../../printer/rawbt-href', () => ({
  buildSampleRawbtHref: vi.fn(async () => 'rawbt:data:image/png;base64,AAAA'),
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
  shim.native = false
  shim.androidWeb = false
  shim.sink.mockClear()
})

describe('mục MÁY IN trong Cài đặt', () => {
  it('IP sai → hiện lỗi, không ghi localStorage', async () => {
    render(<PrinterSection />)
    await userEvent.type(screen.getByLabelText(/Địa chỉ IP máy in/), '999.1.1.1')
    await userEvent.click(screen.getByRole('button', { name: 'LƯU' }))

    expect(screen.getByRole('alert').textContent).toMatch(/không hợp lệ/)
    expect(localStorage.getItem(PRINTER_CONFIG_KEY)).toBeNull()
  })

  it('IP đúng → ghi localStorage đúng JSON và báo đã lưu', async () => {
    render(<PrinterSection />)
    await userEvent.type(screen.getByLabelText(/Địa chỉ IP máy in/), '192.168.1.50')
    await userEvent.click(screen.getByRole('button', { name: 'LƯU' }))

    expect(JSON.parse(localStorage.getItem(PRINTER_CONFIG_KEY) as string)).toEqual({ host: '192.168.1.50', port: 9100 })
    expect(screen.getByText('Đã lưu 192.168.1.50:9100')).toBeDefined()
  })

  it('gõ lại IP sau khi đã lưu → dòng "Đã lưu" biến mất, không khẳng định giá trị chưa lưu', async () => {
    render(<PrinterSection />)
    const ô = screen.getByLabelText(/Địa chỉ IP máy in/)
    await userEvent.type(ô, '192.168.1.50')
    await userEvent.click(screen.getByRole('button', { name: 'LƯU' }))
    expect(screen.getByText('Đã lưu 192.168.1.50:9100')).toBeDefined()

    await userEvent.type(ô, '9')
    expect(screen.queryByText(/^Đã lưu/)).toBeNull()
  })

  it('trên web (không native): IN THỬ khoá và có dòng chú thích', () => {
    render(<PrinterSection />)
    expect(screen.getByRole('button', { name: 'IN THỬ' })).toHaveProperty('disabled', true)
    expect(screen.getByText(/^Chỉ in được trong app Android/)).toBeDefined()
  })

  it('trong app native: IN THỬ lưu IP đang gõ rồi gửi tờ mẫu tới đúng host', async () => {
    shim.native = true
    render(<PrinterSection />)
    await userEvent.clear(screen.getByLabelText(/Địa chỉ IP máy in/))
    await userEvent.type(screen.getByLabelText(/Địa chỉ IP máy in/), '10.0.0.9')
    await userEvent.click(screen.getByRole('button', { name: 'IN THỬ' }))
    await userEvent.click(screen.getByRole('button', { name: 'In thử' }))

    await waitFor(() => expect(shim.sink).toHaveBeenCalledOnce())
    // Đích gửi là IP đang gõ, không phải giá trị cũ trong kho.
    expect(shim.sink.mock.calls[0]?.[1]).toEqual({ host: '10.0.0.9', port: 9100 })
    expect(await screen.findByText('Đã gửi tờ mẫu tới 10.0.0.9:9100')).toBeDefined()
    // Xác nhận = lưu + thử.
    expect(JSON.parse(localStorage.getItem(PRINTER_CONFIG_KEY) as string)).toEqual({ host: '10.0.0.9', port: 9100 })
  })

  it('IN THỬ chỉ MỞ hộp xác nhận, chưa gửi; huỷ thì vẫn không gửi', async () => {
    shim.native = true
    render(<PrinterSection />)
    await userEvent.clear(screen.getByLabelText(/Địa chỉ IP máy in/))
    await userEvent.type(screen.getByLabelText(/Địa chỉ IP máy in/), '10.0.0.9')
    await userEvent.click(screen.getByRole('button', { name: 'IN THỬ' }))

    expect(screen.getByRole('alertdialog', { name: /In thử ra máy in nhiệt/ })).toBeDefined()
    expect(shim.sink).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(shim.sink).not.toHaveBeenCalled()
  })

  it('native: bấm-đúp nút "In thử" trong hộp → chỉ MỘT tờ mẫu gửi đi (khoá ref chống bấm-đúp)', async () => {
    shim.native = true
    shim.sink.mockResolvedValue(undefined)
    render(<PrinterSection />)
    await userEvent.clear(screen.getByLabelText(/Địa chỉ IP máy in/))
    await userEvent.type(screen.getByLabelText(/Địa chỉ IP máy in/), '10.0.0.9')
    await userEvent.click(screen.getByRole('button', { name: 'IN THỬ' }))
    const inBtn = screen.getByRole('button', { name: 'In thử' })

    // Hai cú chạm NỐI nhau vào nút "In thử" trong hộp: hộp chưa kịp đóng (React chưa render lại) — chỉ
    // khoá ref đồng bộ trong onTest chặn được cú thứ hai (bấm-đúp đã in HAI tờ trên SPR02 thật).
    await act(async () => {
      inBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      inBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await waitFor(() => expect(shim.sink).toHaveBeenCalledOnce())
    expect(shim.sink).toHaveBeenCalledOnce()
  })

  it('native: lỗi khi gửi giữ nguyên câu lỗi thật, không nuốt thành "kiểm tra WiFi"', async () => {
    shim.native = true
    shim.sink.mockRejectedValueOnce(new Error('Máy in từ chối kết nối cổng 9100.'))
    render(<PrinterSection />)
    await userEvent.clear(screen.getByLabelText(/Địa chỉ IP máy in/))
    await userEvent.type(screen.getByLabelText(/Địa chỉ IP máy in/), '10.0.0.9')
    await userEvent.click(screen.getByRole('button', { name: 'IN THỬ' }))
    await userEvent.click(screen.getByRole('button', { name: 'In thử' }))

    expect(await screen.findByText('Máy in từ chối kết nối cổng 9100.')).toBeDefined()
  })

  it('web Android: hiện khối IN QUA RAWBT với link Play và <a data-rawbt> IN THỬ', async () => {
    shim.androidWeb = true
    render(<PrinterSection />)
    expect(screen.getByRole('link', { name: 'Cài RawBT' }).getAttribute('href')).toContain('ru.a402d.rawbtprinter')
    const inThu = await screen.findByRole('link', { name: 'IN THỬ QUA RAWBT' })
    expect(inThu.getAttribute('href')?.startsWith('rawbt:data:image/png;base64,')).toBe(true)
    expect(document.querySelectorAll('a[data-rawbt]')).toHaveLength(1)
  })

  it('web Android: dựng tờ mẫu RawBT lỗi → báo lỗi, không kẹt ở "Đang chuẩn bị"', async () => {
    shim.androidWeb = true
    vi.mocked(buildSampleRawbtHref).mockRejectedValueOnce(new Error('CompressionStream thiếu'))
    render(<PrinterSection />)
    expect(await screen.findByText(/chưa tạo được tờ mẫu cho RawBT/)).toBeDefined()
    expect(document.querySelectorAll('a[data-rawbt]')).toHaveLength(0)
  })

  it('trong app native: không khối IN QUA RAWBT', () => {
    shim.native = true
    render(<PrinterSection />)
    expect(screen.queryByText('IN QUA RAWBT')).toBeNull()
    expect(document.querySelectorAll('a[data-rawbt]')).toHaveLength(0)
  })

  it('web thường (desktop): không khối RAWBT, khối IP vẫn có', () => {
    render(<PrinterSection />)
    expect(screen.queryByText('IN QUA RAWBT')).toBeNull()
    expect(document.querySelectorAll('a[data-rawbt]')).toHaveLength(0)
    expect(screen.getByLabelText(/Địa chỉ IP máy in/)).toBeDefined()
  })

  it('render đúng một tờ IN THỬ ẩn, rộng 360px, không nằm trong .receipt-view', () => {
    const { container } = render(<PrinterSection />)
    const sheets = container.querySelectorAll('[data-sample-sheet]')
    expect(sheets).toHaveLength(1)
    const sheet = sheets[0] as HTMLElement
    expect(sheet.closest('.receipt-view')).toBeNull()
    // Chốt chặn D14 tại chỗ: sheet phải rộng 360px thì chụp mới ra 576 chấm (buildSampleJob không lái từ web).
    expect(sheet.style.width).toBe('360px')
  })
})
