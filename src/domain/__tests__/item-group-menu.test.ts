import { describe, expect, it } from 'vitest'
import { buildMenu } from '../item-group-menu'

describe('buildMenu', () => {
  it('cắt lựa chọn theo dấu phẩy, bỏ hàng trống hoàn toàn', () => {
    const result = buildMenu(
      [
        { name: ' Đường ', choicesText: 'Ít đường, Không đường,  Nhiều đường ' },
        { name: '', choicesText: '' },
      ],
      [{ name: 'Trân châu', price: 5_000 }, { name: '', price: null }],
    )

    expect(result).toEqual({
      ok: true,
      optionGroups: [{ name: 'Đường', choices: ['Ít đường', 'Không đường', 'Nhiều đường'] }],
      toppingMenu: [{ name: 'Trân châu', price: 5_000 }],
    })
  })

  it('topping giá 0 là hợp lệ (miễn phí), thiếu giá thì chặn', () => {
    expect(buildMenu([], [{ name: 'Đá viên', price: 0 }])).toMatchObject({ ok: true })
    expect(buildMenu([], [{ name: 'Thạch', price: null }])).toEqual({
      ok: false,
      error: 'Nhập giá cho topping “Thạch” (0 nếu miễn phí).',
    })
  })

  it('một nhãn chỉ thuộc một nhóm: trùng giữa hai nhóm hoặc với nhóm Đá có sẵn đều bị chặn', () => {
    expect(
      buildMenu(
        [
          { name: 'Đường', choicesText: 'Ít' },
          { name: 'Sữa', choicesText: 'ít' },
        ],
        [],
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining('chỉ thuộc một nhóm') })
    expect(buildMenu([{ name: 'Kiểu đá', choicesText: 'Đá riêng' }], [])).toMatchObject({ ok: false })
  })

  it('tên nhóm không được trùng nhau hay trùng nhóm Đá; tên topping không trùng', () => {
    expect(buildMenu([{ name: 'đá', choicesText: 'Ít' }], [])).toMatchObject({ ok: false })
    expect(
      buildMenu([], [{ name: 'Thạch', price: 1 }, { name: ' thạch ', price: 2 }]),
    ).toMatchObject({ ok: false })
  })

  it('nhóm có tên mà không có lựa chọn, hoặc ngược lại, bị chặn kèm lý do', () => {
    expect(buildMenu([{ name: 'Đường', choicesText: '' }], [])).toEqual({
      ok: false,
      error: 'Nhóm “Đường” chưa có lựa chọn nào.',
    })
    expect(buildMenu([{ name: '', choicesText: 'Ít' }], [])).toMatchObject({ ok: false })
  })
})
