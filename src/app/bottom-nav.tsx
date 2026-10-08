import { NavLink } from 'react-router'
import { TABS } from './tabs'

export function BottomNav() {
  return (
    <nav className="safe-bottom flex shrink-0 border-t border-line bg-white pt-1.5">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          className={({ isActive }) =>
            `flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${
              isActive ? 'font-bold text-brand' : 'text-muted'
            }`
          }
        >
          <span className="size-[22px]">{tab.icon}</span>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
