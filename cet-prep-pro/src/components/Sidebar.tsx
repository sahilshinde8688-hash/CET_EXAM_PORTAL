export type Page = 'signin' | 'dashboard' | 'mocktests' | 'results' | 'analytics' | 'settings' | 'admin-dashboard'

import { authAPI, session } from '../lib/api'

interface SidebarProps {
  activePage: Page
  onNavigate?: (page: Page) => void
  onStartTest?: () => void
}

const NAV_ITEMS = [
  { icon: 'dashboard', label: 'Dashboard', page: 'dashboard' as Page },
  { icon: 'quiz', label: 'Mock Tests', page: 'mocktests' as Page },
  { icon: 'bar_chart', label: 'Result', page: 'results' as Page },
  { icon: 'analytics', label: 'Analytics', page: 'analytics' as Page },
  { icon: 'settings', label: 'Settings', page: 'settings' as Page },
  { icon: 'admin_panel_settings', label: 'Admin', page: 'admin-dashboard' as Page },
]

export default function Sidebar({ activePage, onNavigate, onStartTest }: SidebarProps) {
  const user = session.get<{ role: string }>()
  const isAdmin = user?.role === 'admin'
  const navItems = isAdmin ? NAV_ITEMS : NAV_ITEMS.filter(item => item.page !== 'admin-dashboard')

  return (
    <aside className="db-sidebar">
      <div className="db-sidebar-brand">
        <div className="db-sidebar-logo">
          <span className="material-symbols-outlined">school</span>
        </div>
        <span className="db-sidebar-title">CET Prep Pro</span>
      </div>

      <nav className="db-sidebar-nav">
        {navItems.map(item => (
          <a
            key={item.label}
            href="#"
            className={`db-nav-item${activePage === item.page ? ' db-nav-item--active' : ''}`}
            onClick={e => {
              e.preventDefault()
              onNavigate?.(item.page)
            }}
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            <span>{item.label}</span>
          </a>
        ))}
      </nav>

      <div className="db-sidebar-bottom">
        <button className="db-start-btn" onClick={() => onStartTest?.()}>
          <span className="material-symbols-outlined">add</span>
          Start New Test
        </button>
        <a
          href="#"
          className="db-nav-item db-logout"
          onClick={async e => {
            e.preventDefault()
            window.dispatchEvent(new CustomEvent('app:loading', { detail: true }))
            try {
              await authAPI.logout()
            } catch (error) {
              console.warn('Logout failed, clearing local session anyway', error)
            }
            session.clear()
            window.dispatchEvent(new CustomEvent('app:loading', { detail: false }))
            onNavigate?.('signin')
          }}
        >
          <span className="material-symbols-outlined">logout</span>
          <span>Logout</span>
        </a>
      </div>
    </aside>
  )
}
