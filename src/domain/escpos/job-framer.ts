import { scanStream } from './stream.ts'

/**
 * SPP là một dòng byte liền, không có ranh giới job. Framer cắt job ở ba chỗ: ngay sau lệnh cắt giấy
 * (`push` trả về), và khi nối đóng hoặc người gửi im lặng (bên gọi gọi `flush`). Lệnh cắt chỉ được nhận
 * ra qua tokenizer — byte `GS V` nằm giữa dữ liệu ảnh không phải lệnh cắt.
 */
export class JobFramer {
  private buffer = new Uint8Array(0)
  private scanned = 0
  /** Gặp lệnh lạ thì không tìm được lệnh cắt nữa: gom hết tới `flush`, để `parseJob` báo lại đúng lỗi. */
  private broken = false

  push(chunk: Uint8Array): Uint8Array[] {
    const next = new Uint8Array(this.buffer.length + chunk.length)
    next.set(this.buffer)
    next.set(chunk, this.buffer.length)
    this.buffer = next

    const jobs: Uint8Array[] = []
    while (!this.broken) {
      const { tokens, consumed, error } = scanStream(this.buffer, this.scanned)
      // Job đã cắt xong trước lệnh lạ vẫn in: cách khúc đọc Bluetooth chia byte không được đổi kết quả.
      const cut = tokens.find(({ token }) => token.kind === 'cut')
      if (cut) {
        jobs.push(this.buffer.slice(0, cut.end))
        this.buffer = this.buffer.slice(cut.end)
        this.scanned = 0
        continue
      }
      this.scanned = consumed
      if (error) this.broken = true
      break
    }
    return jobs
  }

  /** Đang chờ nốt byte của một lệnh (ảnh, tham số): im lặng lúc này không phải hết job. */
  get midCommand(): boolean {
    return !this.broken && this.scanned < this.buffer.length
  }

  flush(): Uint8Array | null {
    const rest = this.buffer
    this.buffer = new Uint8Array(0)
    this.scanned = 0
    this.broken = false
    return rest.length > 0 ? rest : null
  }
}
