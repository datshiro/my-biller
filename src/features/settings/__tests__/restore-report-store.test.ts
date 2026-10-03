// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { clearRestoreReport, readRestoreReport, saveRestoreReport, type StoredRestoreReport } from '../restore-report-store'

const stored: StoredRestoreReport = {
  mode: 'overwrite',
  sourceName: 'my-biller-backup-261001-1000.json',
  safety: { savedAs: 'my-biller-backup-261004-0900.json', location: 'Tải về (Download)', verified: false },
  codeChanges: 0,
  report: {
    ok: true,
    overpaidOrders: 0,
    rows: [{ key: 'orders', label: 'Đơn', expected: 2, actual: 2, matches: true }],
  },
}

beforeEach(() => sessionStorage.clear())

describe('restore-report-store', () => {
  it('ghi rồi đọc lại đúng nội dung; xoá thì không còn', () => {
    saveRestoreReport(stored)

    expect(readRestoreReport()).toEqual(stored)
    clearRestoreReport()
    expect(readRestoreReport()).toBeNull()
  })

  it('khoá hỏng (không phải JSON hoặc sai dạng) ⇒ bỏ qua im lặng và xoá khoá', () => {
    sessionStorage.setItem('my-biller.restore-report', '{không phải json')
    expect(readRestoreReport()).toBeNull()
    expect(sessionStorage.getItem('my-biller.restore-report')).toBeNull()

    sessionStorage.setItem('my-biller.restore-report', JSON.stringify({ mode: 'khác' }))
    expect(readRestoreReport()).toBeNull()
    expect(sessionStorage.getItem('my-biller.restore-report')).toBeNull()
  })
})
