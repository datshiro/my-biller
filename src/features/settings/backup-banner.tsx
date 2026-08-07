import { useState } from 'react'
import { differenceInCalendarDays } from 'date-fns'
import { Link } from 'react-router'
import { useAppState } from './use-settings'

const REMIND_AFTER_DAYS = 7
const SNOOZE_KEY = 'my-biller.backup-snoozed-at'
const SNOOZE_MS = 24 * 60 * 60 * 1000

/**
 * Nhắc sao lưu khi đã quá 7 ngày. Không có backend nên file sao lưu là bản sao duy nhất — đóng được
 * banner, nhưng nó quay lại sau 24 giờ chứ không tắt hẳn.
 */
export function BackupBanner() {
  const state = useAppState()
  const [snoozedAt, setSnoozedAt] = useState(() => Number(localStorage.getItem(SNOOZE_KEY) ?? 0))

  if (!state) return null

  const { lastBackupAt, now } = state
  const days = lastBackupAt === null ? null : differenceInCalendarDays(now, lastBackupAt)
  if (days !== null && days < REMIND_AFTER_DAYS) return null
  if (now - snoozedAt < SNOOZE_MS) return null

  const snooze = () => {
    localStorage.setItem(SNOOZE_KEY, String(now))
    setSnoozedAt(now)
  }

  return (
    <div className="flex items-center gap-3 bg-warn-tint px-4 py-2.5 text-[13px] text-warn">
      <p className="min-w-0 flex-1 font-semibold">
        {days === null ? 'Chưa sao lưu lần nào.' : `Đã ${days} ngày chưa sao lưu.`} Mất máy là mất
        sạch dữ liệu.{' '}
        <Link to="/them/cai-dat" className="underline">
          Sao lưu ngay
        </Link>
      </p>
      <button
        type="button"
        onClick={snooze}
        aria-label="Ẩn nhắc sao lưu"
        className="grid size-8 shrink-0 place-items-center rounded-full text-[15px]"
      >
        ✕
      </button>
    </div>
  )
}
