// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LabelPreview } from '../label-preview'
import { bytesPerRow, type Bitmap } from '@/domain/escpos/bitmap'
import type { LabelWatermark } from '@/domain/schema'

const shim = vi.hoisted(() => ({
  render: vi.fn(),
  decode: vi.fn(),
  put: vi.fn(),
  clear: vi.fn(),
}))
vi.mock('../../printer/label-job', () => ({ renderLabelPreview: shim.render }))
vi.mock('../shop-logo', () => ({ decodeLogo: shim.decode }))

const LOGO = 'data:image/png;base64,iVBORw0KGgo='
const bitmap: Bitmap = { width: 400, height: 240, data: new Uint8Array(bytesPerRow(400) * 240) }
const watermark = (patch: Partial<LabelWatermark> = {}): LabelWatermark => ({
  enabled: true,
  position: 'center',
  strength: 'medium',
  align: 'right',
  ...patch,
})

beforeEach(() => {
  shim.render.mockReset().mockResolvedValue(bitmap)
  shim.decode.mockReset().mockResolvedValue({ width: 1, height: 1, data: new Uint8Array([0x80]) })
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve(), load: vi.fn(async () => []) },
  })
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    },
  )
  shim.put.mockReset()
  shim.clear.mockReset()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    putImageData: shim.put,
    fillRect: shim.clear,
    fillStyle: '',
  } as never)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const canvas = () => document.querySelector<HTMLCanvasElement>('canvas[data-label-preview]')

describe('tem xem trước ở Thông tin cửa hàng', () => {
  it('vẽ ảnh đúng khổ tem mặc định 50×30 rồi báo xong', async () => {
    render(<LabelPreview name="Quán" logo={null} watermark={watermark({ enabled: false })} />)
    await waitFor(() => expect(canvas()?.getAttribute('data-ready')).toBe('true'))
    expect([canvas()?.width, canvas()?.height]).toEqual([400, 240])
    expect(shim.render).toHaveBeenCalledOnce()
    // Chưa có logo thì không giải mã gì và không có lớp logo.
    expect(shim.decode).not.toHaveBeenCalled()
    expect(shim.render.mock.calls[0]?.[2]).toBeNull()
  })

  it('bật hình chìm: giải mã logo và đưa đúng cấu hình vào đường dựng ảnh', async () => {
    render(<LabelPreview name="Quán" logo={LOGO} watermark={watermark()} />)
    await waitFor(() => expect(canvas()?.getAttribute('data-ready')).toBe('true'))
    expect(shim.decode).toHaveBeenCalledWith(LOGO)
    expect(shim.render.mock.calls[0]?.[2]).toMatchObject({ config: watermark() })
  })

  it('đổi vị trí thì dựng lại với cấu hình mới', async () => {
    const view = render(<LabelPreview name="Quán" logo={LOGO} watermark={watermark({ align: 'center' })} />)
    await waitFor(() => expect(canvas()?.getAttribute('data-ready')).toBe('true'))
    view.rerender(<LabelPreview name="Quán" logo={LOGO} watermark={watermark({ align: 'right' })} />)
    await waitFor(() => expect(shim.render).toHaveBeenCalledTimes(2))
    expect(shim.render.mock.calls[1]?.[2]).toMatchObject({ config: { align: 'right' } })
  })

  it('dựng hỏng thì báo bằng tiếng Việt và xoá ảnh cũ, không để ảnh của cấu hình trước nằm cạnh lời báo lỗi', async () => {
    shim.render.mockRejectedValue(new Error('boom'))
    render(<LabelPreview name="Quán" logo={LOGO} watermark={watermark()} />)
    expect(await screen.findByText('Không dựng được ảnh xem trước.')).toBeDefined()
    expect(shim.clear).toHaveBeenCalledWith(0, 0, 400, 240)
  })

  it('logo trong sổ hỏng: vẫn vẽ tem không logo và nói rõ, như khi in', async () => {
    shim.decode.mockRejectedValue(new DOMException('The source image could not be decoded.', 'InvalidStateError'))
    render(<LabelPreview name="Quán" logo={LOGO} watermark={watermark()} />)
    expect(await screen.findByText(/Logo không đọc được nên tem in không có logo/)).toBeDefined()
    await waitFor(() => expect(canvas()?.getAttribute('data-ready')).toBe('true'))
    expect(shim.render.mock.calls[0]?.[2]).toBeNull()
    expect(screen.queryByText(/could not be decoded/)).toBeNull()
  })

  it('lần dựng chậm của cấu hình cũ về muộn không đè lên ảnh của cấu hình mới', async () => {
    let finishFirst: (b: Bitmap) => void = () => {}
    const stale: Bitmap = { ...bitmap, data: new Uint8Array(bitmap.data.length).fill(0xff) }
    shim.render
      .mockImplementationOnce(() => new Promise<Bitmap>((resolve) => (finishFirst = resolve)))
      .mockResolvedValue(bitmap)
    const view = render(<LabelPreview name="Quán" logo={LOGO} watermark={watermark({ align: 'center' })} />)
    await waitFor(() => expect(shim.render).toHaveBeenCalledTimes(1))
    view.rerender(<LabelPreview name="Quán" logo={LOGO} watermark={watermark({ align: 'right' })} />)
    await waitFor(() => expect(canvas()?.getAttribute('data-ready')).toBe('true'))
    expect(shim.put).toHaveBeenCalledOnce()

    finishFirst(stale)
    await Promise.resolve()
    await Promise.resolve()
    expect(shim.put).toHaveBeenCalledOnce()
  })
})
