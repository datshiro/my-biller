/** Một khối chữ trong thân tem (tuỳ chọn, topping, ghi chú khách). `kind` giữ nguyên qua các trang. */
export interface LabelBlock {
  kind: string
  text: string
}

type Token = { block: number; kind: string; word: string }

/** Số k lớn nhất trong [0, max] mà `ok(k)` đúng, với `ok` đơn điệu: thêm chữ chỉ có thể làm tràn thêm. */
function largest(max: number, ok: (k: number) => boolean): number {
  let lo = 0
  let hi = max
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ok(mid)) lo = mid
    else hi = mid - 1
  }
  return lo
}

function toPage(tokens: readonly Token[]): LabelBlock[] {
  const page: (LabelBlock & { block: number })[] = []
  for (const { block, kind, word } of tokens) {
    const last = page.at(-1)
    if (last && last.block === block) last.text += ` ${word}`
    else page.push({ block, kind, text: word })
  }
  return page.map(({ kind, text }) => ({ kind, text }))
}

/**
 * Chia thân tem thành các trang theo thứ tự đọc, mỗi trang nhét được nhiều chữ nhất mà `fits` còn chịu.
 * Cắt ở ranh giới từ; từ dài hơn cả một trang thì cắt theo ký tự. Không bao giờ bỏ chữ: ghép lại các
 * trang ra đúng chuỗi từ ban đầu. `fits` do nơi gọi đo trên DOM thật — đếm ký tự luôn lệch với chữ
 * tiếng Việt và font thật.
 *
 * Nếu ngay một ký tự cũng không vừa (thân tem không còn chỗ), mỗi trang vẫn nhận một ký tự để vòng lặp
 * kết thúc; khi đó tem xấu nhưng không treo.
 */
export function paginateBlocks(
  blocks: readonly LabelBlock[],
  fits: (page: readonly LabelBlock[]) => boolean,
): LabelBlock[][] {
  let rest: Token[] = blocks.flatMap((b, block) =>
    b.text
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => ({ block, kind: b.kind, word })),
  )
  if (rest.length === 0) return [[]]

  const pages: LabelBlock[][] = []
  while (rest.length > 0) {
    const count = largest(rest.length, (k) => fits(toPage(rest.slice(0, k))))
    if (count > 0) {
      pages.push(toPage(rest.slice(0, count)))
      rest = rest.slice(count)
      continue
    }
    const [head, ...tail] = rest as [Token, ...Token[]]
    const chars = Array.from(head.word)
    const take = Math.max(1, largest(chars.length, (k) => fits(toPage([{ ...head, word: chars.slice(0, k).join('') }]))))
    pages.push(toPage([{ ...head, word: chars.slice(0, take).join('') }]))
    rest = take >= chars.length ? tail : [{ ...head, word: chars.slice(take).join('') }, ...tail]
  }
  return pages
}
