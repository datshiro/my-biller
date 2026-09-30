import { describe, expect, it } from 'vitest'
import { paginateBlocks, type LabelBlock } from '../label-pages'

const chars = (page: readonly LabelBlock[]) => page.reduce((n, b) => n + b.text.length, 0)
const maxChars = (limit: number) => (page: readonly LabelBlock[]) => chars(page) <= limit
const words = (pages: LabelBlock[][]) => pages.flatMap((p) => p.flatMap((b) => b.text.split(' '))).join(' ')

describe('paginateBlocks', () => {
  it('vừa một trang thì giữ nguyên một trang, các khối không bị gộp', () => {
    const blocks = [
      { kind: 'options', text: 'Ít đường' },
      { kind: 'note', text: 'mang về' },
    ]
    expect(paginateBlocks(blocks, maxChars(100))).toEqual([blocks])
  })

  it('không có chữ nào → đúng một trang trống, tem vẫn in một tờ', () => {
    expect(paginateBlocks([], maxChars(10))).toEqual([[]])
    expect(paginateBlocks([{ kind: 'note', text: '   ' }], maxChars(10))).toEqual([[]])
  })

  it('ghi chú dài cắt ở ranh giới từ, mỗi trang nhận nhiều từ nhất có thể, ghép lại đủ chữ', () => {
    const note = 'không lấy ống hút để đá riêng ra túi nhé'
    const pages = paginateBlocks([{ kind: 'note', text: note }], maxChars(16))

    expect(pages).toEqual([
      [{ kind: 'note', text: 'không lấy ống' }],
      [{ kind: 'note', text: 'hút để đá riêng' }],
      [{ kind: 'note', text: 'ra túi nhé' }],
    ])
    expect(words(pages)).toBe(note)
  })

  it('khối đứng trước tràn sang trang sau kéo theo khối đứng sau, giữ thứ tự và loại khối', () => {
    const pages = paginateBlocks(
      [
        { kind: 'options', text: 'Ít đường Không đá' },
        { kind: 'toppings', text: 'Trân châu x2' },
        { kind: 'note', text: 'gói kỹ' },
      ],
      maxChars(20),
    )

    expect(pages).toEqual([
      [{ kind: 'options', text: 'Ít đường Không đá' }],
      [
        { kind: 'toppings', text: 'Trân châu x2' },
        { kind: 'note', text: 'gói kỹ' },
      ],
    ])
  })

  it('một khối bị cắt giữa chừng vẫn mang loại khối của nó ở trang sau', () => {
    const pages = paginateBlocks([{ kind: 'note', text: 'aaaa bbbb cccc' }], maxChars(9))
    expect(pages.map((p) => p.map((b) => b.kind))).toEqual([['note'], ['note']])
  })

  it('từ dài hơn cả trang thì cắt theo ký tự, không mất ký tự nào', () => {
    const pages = paginateBlocks([{ kind: 'note', text: 'abcdefghij' }], maxChars(4))
    expect(pages.map((p) => p[0]?.text)).toEqual(['abcd', 'efgh', 'ij'])
  })

  it('không chỗ nào vừa → mỗi trang một ký tự và vẫn kết thúc', () => {
    const pages = paginateBlocks([{ kind: 'note', text: 'abc' }], () => false)
    expect(pages.map((p) => p[0]?.text)).toEqual(['a', 'b', 'c'])
  })
})
