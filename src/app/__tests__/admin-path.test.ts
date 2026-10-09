import { describe, expect, it } from 'vitest'
import { isAdminPath } from '../admin-path'

describe('isAdminPath', () => {
  it('chỉ nhận /admin và các trang con của nó, không nhận màn bán hàng hay đường trùng tiền tố', () => {
    expect(isAdminPath('/admin')).toBe(true)
    expect(isAdminPath('/admin/')).toBe(true)
    expect(isAdminPath('/admin/so/abc')).toBe(true)
    expect(isAdminPath('/')).toBe(false)
    expect(isAdminPath('/them/cai-dat')).toBe(false)
    expect(isAdminPath('/administrator')).toBe(false)
  })
})
