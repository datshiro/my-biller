import { describe, expect, it, vi } from 'vitest'
import { logoDataUrlFromFile, SHOP_LOGO_MAX_FILE_BYTES } from '../shop-logo'

describe('chọn ảnh logo', () => {
  it('ảnh quá 5 MB bị từ chối trước khi giải mã — giải mã ảnh camera cỡ gốc làm treo máy yếu', async () => {
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    const big = new Blob([new Uint8Array(SHOP_LOGO_MAX_FILE_BYTES + 1)], { type: 'image/jpeg' })
    await expect(logoDataUrlFromFile(big)).rejects.toThrow(/quá lớn/)
    expect(decode).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
