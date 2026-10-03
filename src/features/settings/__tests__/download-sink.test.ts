// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `registerPlugin` chạy lúc nạp module → mock trả một object ổn định mà ca test điều khiển được.
const cap = vi.hoisted(() => ({
  saveToDownloads: vi.fn<
    (o: { filename: string; mimeType: string; text: string }) => Promise<{ displayName: string; relativePath: string }>
  >(),
  native: true,
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => cap.native },
  registerPlugin: () => ({ saveToDownloads: cap.saveToDownloads }),
}))

import { describeSavedFile, saveToDownloads } from '../download-sink'

let blobs: Blob[] = []
let clicked: HTMLAnchorElement[] = []

beforeEach(() => {
  blobs = []
  clicked = []
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob)
    return 'blob:test'
  })
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this)
  })
})

afterEach(() => {
  cap.saveToDownloads.mockReset()
  cap.native = true
  vi.restoreAllMocks()
})

describe('saveToDownloads trong APK', () => {
  it.each(['application/json', 'text/csv;charset=utf-8'])(
    'truyền nguyên tên, MIME %s và nội dung xuống plugin; trả tên thật plugin báo, verified=true',
    async (mimeType) => {
      cap.saveToDownloads.mockResolvedValue({ displayName: 'sao-luu (1).json', relativePath: 'Download/' })

      const saved = await saveToDownloads({ filename: 'sao-luu.json', mimeType, text: '{"a":1}' })

      expect(cap.saveToDownloads).toHaveBeenCalledWith({ filename: 'sao-luu.json', mimeType, text: '{"a":1}' })
      expect(saved).toEqual({ savedAs: 'sao-luu (1).json', location: 'Download/', verified: true })
      expect(clicked).toEqual([])
    },
  )

  it('plugin báo lỗi ⇒ ném câu tiếng Việt, không giả vờ đã lưu', async () => {
    cap.saveToDownloads.mockRejectedValue(new Error('Chưa cho phép ghi vào bộ nhớ, nên chưa lưu được file.'))

    await expect(saveToDownloads({ filename: 'x.json', mimeType: 'application/json', text: '{}' })).rejects.toThrow(
      'Chưa cho phép ghi vào bộ nhớ, nên chưa lưu được file.',
    )
  })
})

describe('saveToDownloads trên web', () => {
  it('bấm <a download> đúng tên, Blob đúng MIME và nội dung; verified=false vì trình duyệt không báo lại', async () => {
    cap.native = false

    const saved = await saveToDownloads({ filename: 'mau.csv', mimeType: 'text/csv;charset=utf-8', text: 'a,b' })

    expect(clicked.map((link) => link.download)).toEqual(['mau.csv'])
    expect(blobs[0]?.type).toBe('text/csv;charset=utf-8')
    expect(await blobs[0]?.text()).toBe('a,b')
    expect(saved).toEqual({ savedAs: 'mau.csv', location: 'Tải về (Download)', verified: false })
    expect(cap.saveToDownloads).not.toHaveBeenCalled()
  })
})

describe('describeSavedFile', () => {
  it('APK đã lưu chắc ⇒ nói "Đã lưu" kèm nơi và tên thật', () => {
    expect(describeSavedFile({ savedAs: 'a (1).json', location: 'Download/', verified: true })).toBe(
      'Đã lưu: Download/a (1).json.',
    )
  })

  it('web chỉ mới yêu cầu tải ⇒ không bao giờ nói "Đã lưu"', () => {
    const sentence = describeSavedFile({ savedAs: 'a.json', location: 'Tải về (Download)', verified: false })

    expect(sentence).toMatch(/^Đã yêu cầu tải file "a\.json" về thư mục Tải về \(Download\)\./)
    expect(sentence).not.toMatch(/Đã lưu/)
  })
})
