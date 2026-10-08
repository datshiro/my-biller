import type { ReactNode } from 'react'

type Tab = { to: string; label: string; icon: ReactNode }

const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export const TABS: Tab[] = [
  {
    to: '/',
    label: 'Bán',
    icon: (
      <svg viewBox="0 0 24 24" {...s}>
        <path d="M3 7h18l-1.5 12.5a2 2 0 0 1-2 1.5H6.5a2 2 0 0 1-2-1.5Z" />
        <path d="M8.5 7V5.5a3.5 3.5 0 0 1 7 0V7" />
      </svg>
    ),
  },
  {
    to: '/don',
    label: 'Đơn',
    icon: (
      <svg viewBox="0 0 24 24" {...s}>
        <path d="M5 3.5h14v17l-2.3-1.6-2.4 1.6-2.3-1.6-2.4 1.6L7.3 19 5 20.5Z" />
        <path d="M9 8.5h6M9 12.5h6" />
      </svg>
    ),
  },
  {
    to: '/chi-phi',
    label: 'Chi phí',
    icon: (
      <svg viewBox="0 0 24 24" {...s}>
        <rect x="2.5" y="6" width="19" height="12.5" rx="2.5" />
        <path d="M2.5 10.5h19M6.5 15h3" />
      </svg>
    ),
  },
  {
    to: '/bao-cao',
    label: 'Báo cáo',
    icon: (
      <svg viewBox="0 0 24 24" {...s}>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
    ),
  },
  {
    to: '/them',
    label: 'Thêm',
    icon: (
      <svg viewBox="0 0 24 24" {...s}>
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    ),
  },
]

export const TAB_PATHS = TABS.map((tab) => tab.to)
