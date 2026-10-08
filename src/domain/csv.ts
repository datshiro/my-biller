/** Một hàng dữ liệu thô từ file CSV. `line` là số dòng Excel hiển thị (tiêu đề = 1). */
export type CsvRecord = { line: number; cells: string[] }

/** Lỗi cấp file — chưa đọc được nội dung, message đã bằng tiếng Việt cho người bán. */
export class CsvFileError extends Error {
  override name = 'CsvFileError'
}

export const MAX_CSV_BYTES = 1_000_000
export const MAX_CSV_ROWS = 2_000

export function decodeCsvBytes(bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_CSV_BYTES) {
    throw new CsvFileError('File quá lớn. Chia nhỏ file rồi nhập từng phần.')
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new CsvFileError(
      'File không phải dạng UTF-8. Trong Excel chọn Lưu thành › "CSV UTF-8 (phân cách bằng dấu phẩy)" rồi chọn lại.',
    )
  }
}

const BOM = '﻿'

/** Đếm dấu phân cách trong dòng tiêu đề, bỏ qua phần nằm trong ngoặc kép. */
function countOutsideQuotes(line: string, needle: string): number {
  let count = 0
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (!inQuotes && ch === needle) {
      count++
    }
  }
  return count
}

function detectDelimiter(text: string): ',' | ';' {
  const headerEnd = text.search(/\r\n|\r|\n/)
  const header = headerEnd === -1 ? text : text.slice(0, headerEnd)
  return countOutsideQuotes(header, ';') > countOutsideQuotes(header, ',') ? ';' : ','
}

/**
 * Máy trạng thái một lượt: không regex cả file, không đệ quy, để không bậc hai với file lớn.
 * Mỗi hàng chiếm đúng một số `line` kể cả khi ô bên trong có xuống dòng (đếm theo ký tự xuống dòng
 * ở ngoài ngoặc kép, không theo số hàng `cells` sinh ra).
 */
export function parseCsv(text: string): CsvRecord[] {
  const body = text.startsWith(BOM) ? text.slice(1) : text
  const delimiter = detectDelimiter(body)

  const records: CsvRecord[] = []
  let cells: string[] = []
  let cell = ''
  let inQuotes = false
  // `line` đếm theo hàng CSV logic (tiêu đề = 1), không theo dòng vật lý: một ô xuống dòng bên trong
  // ngoặc kép không làm hàng kế "nhảy số", đúng như Excel đánh số hàng của nó (không phải số dòng file).
  let line = 1
  let rowHasContent = false
  let i = 0

  function endCell(): void {
    cells.push(cell)
    cell = ''
  }

  function endRow(): void {
    endCell()
    if (records.length >= MAX_CSV_ROWS) {
      throw new CsvFileError(`File có hơn ${MAX_CSV_ROWS} dòng. Chia nhỏ file rồi nhập từng phần.`)
    }
    records.push({ line, cells })
    cells = []
    rowHasContent = false
    line++
  }

  while (i < body.length) {
    const ch = body[i]
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      cell += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      rowHasContent = true
      i++
      continue
    }
    if (ch === delimiter) {
      endCell()
      rowHasContent = true
      i++
      continue
    }
    if (ch === '\r' || ch === '\n') {
      endRow()
      if (ch === '\r' && body[i + 1] === '\n') i += 2
      else i++
      continue
    }
    cell += ch
    rowHasContent = true
    i++
  }

  if (inQuotes) {
    throw new CsvFileError(`File lỗi: dòng ${line} có ngoặc kép chưa đóng.`)
  }
  if (rowHasContent || cell !== '' || cells.length > 0) {
    endRow()
  }

  return records
}
