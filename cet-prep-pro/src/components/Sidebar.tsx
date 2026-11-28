export type Page = 'landing' | 'signin' | 'dashboard' | 'mocktests' | 'results' | 'analytics' | 'settings' | 'admin' | 'unauthorized'

import { useEffect, useState } from 'react'
import {
  BarChart3,
  BookOpen,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  QrCode,
  Settings,
  Trophy,
  X,
  Plus,
  type LucideIcon,
} from 'lucide-react'
import { authAPI, session } from '../lib/api'
import '../dashboard.css'

interface SidebarProps {
  activePage: Page
  onNavigate?: (page: Page) => void
  onStartTest?: () => void
  mobileOpen?: boolean
  onCloseMobile?: () => void
}

type AnimatedPage = Exclude<Page, 'landing' | 'signin' | 'admin' | 'unauthorized'>
type NavItem = { icon: LucideIcon; label: string; page?: Page; secondary?: boolean; disabled?: boolean }

const NAV_ITEMS: NavItem[] = [
  { icon: LayoutDashboard, label: 'Dashboard', page: 'dashboard' },
  { icon: ClipboardList, label: 'Mock Tests', page: 'mocktests' },
  { icon: BarChart3, label: 'Results', page: 'results' },
  { icon: BarChart3, label: 'Analytics', page: 'analytics' },
  { icon: BookOpen, label: 'Study Resources', page: 'mocktests', secondary: true },
  { icon: Trophy, label: 'Leaderboard', disabled: true },
  { icon: Settings, label: 'Settings', page: 'settings' },
  { icon: Settings, label: 'Admin', page: 'admin' },
]

const BOTTOM_NAV_ITEMS: Array<NavItem & { page: AnimatedPage }> = [
  { icon: LayoutDashboard, label: 'Home', page: 'dashboard' },
  { icon: ClipboardList, label: 'Tests', page: 'mocktests' },
  { icon: BarChart3, label: 'Results', page: 'results' },
  { icon: Settings, label: 'Profile', page: 'settings' },
]

export default function Sidebar({ activePage, onNavigate, onStartTest, mobileOpen: controlledOpen, onCloseMobile }: SidebarProps) {
  const [internalMobileOpen, setInternalMobileOpen] = useState(false)
  const isMobileOpen = controlledOpen !== undefined ? controlledOpen : internalMobileOpen

  const closeDrawer = () => {
    if (onCloseMobile) onCloseMobile()
    setInternalMobileOpen(false)
  }

  useEffect(() => {
    const handleToggle = () => setInternalMobileOpen(prev => !prev)
    const handleOpen = () => setInternalMobileOpen(true)
    const handleClose = () => setInternalMobileOpen(false)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInternalMobileOpen(false)
    }

    window.addEventListener('cet:toggle-nav', handleToggle)
    window.addEventListener('cet:open-nav', handleOpen)
    window.addEventListener('cet:close-nav', handleClose)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('cet:toggle-nav', handleToggle)
      window.removeEventListener('cet:open-nav', handleOpen)
      window.removeEventListener('cet:close-nav', handleClose)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const user = session.get<{ role: string }>()
  const isAdmin = user?.role === 'admin'
  const navItems = isAdmin ? NAV_ITEMS : NAV_ITEMS.filter(item => item.page !== 'admin')

  const handleNavClick = (page: Page) => {
    closeDrawer()
    onNavigate?.(page)
  }

  const handleStartTest = () => {
    closeDrawer()
    if (onStartTest) {
      onStartTest()
      return
    }
    onNavigate?.('mocktests')
  }

  const handleLogout = async () => {
    closeDrawer()
    window.dispatchEvent(new CustomEvent('app:loading', { detail: true }))
    try {
      await authAPI.logout()
    } catch (error) {
      console.warn('Logout failed, clearing local session anyway', error)
    }
    session.clear()
    window.dispatchEvent(new CustomEvent('app:loading', { detail: false }))
    onNavigate?.('signin')
  }

  return (
    <>
      {/* ── Desktop Sidebar ──────────────────────────────── */}
      <aside className="db-sidebar">
        <a
          className="db-sidebar-brand"
          href="/"
          aria-label="CET Nova home"
          onClick={event => {
            event.preventDefault()
            handleNavClick('landing')
          }}
        >
          <div className="db-sidebar-logo">
            <img src="/logo.png" alt="CET NOVA" />
          </div>
          <span className="db-sidebar-title">CET NOVA</span>
        </a>

        <nav className="db-sidebar-nav" aria-label="Main navigation">
          {navItems.map(item => {
            const Icon = item.icon
            const isActive = !item.secondary && item.page === activePage
            return (
              <button
                key={item.label}
                type="button"
                className={`db-nav-item${isActive ? ' db-nav-item--active' : ''}${item.disabled ? ' db-nav-item--disabled' : ''}`}
                onClick={() => item.page && !item.disabled && onNavigate?.(item.page)}
                disabled={item.disabled}
                title={item.disabled ? 'Student leaderboard is not available yet.' : item.secondary ? 'Practice sets and previous-year papers' : undefined}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
                {item.disabled && <small className="db-nav-soon">Soon</small>}
              </button>
            )
          })}
        </nav>

        <div className="db-sidebar-bottom">
          <button
            type="button"
            className="db-nav-item"
            style={{ width: '100%', justifyContent: 'flex-start', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit', marginBottom: 4 }}
            onClick={() => window.dispatchEvent(new CustomEvent('cet:open-qr'))}
            title="Scan QR to open portal on your mobile phone or scan codes"
          >
            <QrCode size={18} aria-hidden="true" />
            <span>Phone QR</span>
          </button>
          <button className="db-start-btn" onClick={handleStartTest}>
            <Plus size={17} aria-hidden="true" />
            Start New Test
          </button>
          <a
            href="#"
            className="db-nav-item db-logout"
            onClick={async e => {
              e.preventDefault()
              await handleLogout()
            }}
          >
            <LogOut size={17} aria-hidden="true" />
            <span>Logout</span>
          </a>
        </div>
      </aside>

      {/* ── Mobile Overlay & Drawer ──────────────────────── */}
      {isMobileOpen && (
        <div
          className="db-mobile-overlay"
          onClick={closeDrawer}
          role="presentation"
        >
          <div
            className="db-mobile-nav"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Student Navigation Menu"
          >
            <div className="db-mobile-drawer-header">
              <a
                className="db-sidebar-brand"
                href="/"
                aria-label="CET Nova home"
                style={{ marginBottom: 0, padding: 0, textDecoration: 'none' }}
                onClick={event => {
                  event.preventDefault()
                  handleNavClick('landing')
                }}
              >
                <div className="db-sidebar-logo" style={{ width: 42, height: 42 }}>
                  <img src="/logo.png" alt="CET NOVA" style={{ width: 32, height: 32 }} />
                </div>
                <span className="db-sidebar-title" style={{ fontSize: 18 }}>CET NOVA</span>
              </a>
              <button
                type="button"
                className="db-drawer-close-btn"
                onClick={closeDrawer}
                aria-label="Close navigation menu"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <nav className="db-mobile-drawer-items">
              {navItems.map(item => {
                const Icon = item.icon
                const isActive = !item.secondary && item.page === activePage
                return (
                  <button
                    key={item.label}
                    type="button"
                    className={`db-nav-item${isActive ? ' db-nav-item--active' : ''}${item.disabled ? ' db-nav-item--disabled' : ''}`}
                    onClick={() => item.page && !item.disabled && handleNavClick(item.page)}
                    disabled={item.disabled}
                    title={item.disabled ? 'Student leaderboard is not available yet.' : item.secondary ? 'Practice sets and previous-year papers' : undefined}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{item.label}</span>
                    {item.disabled && <small className="db-nav-soon">Soon</small>}
                  </button>
                )
              })}
            </nav>

            <div className="db-mobile-drawer-footer">
              <button
                type="button"
                className="db-nav-item"
                style={{ width: '100%', justifyContent: 'flex-start', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit', marginBottom: 4 }}
                onClick={() => {
                  closeDrawer()
                  window.dispatchEvent(new CustomEvent('cet:open-qr'))
                }}
              >
                <QrCode size={18} aria-hidden="true" />
                <span>Phone QR / Scanner</span>
              </button>
              <button
                type="button"
                className="db-start-btn"
                onClick={handleStartTest}
              >
                <Plus size={17} aria-hidden="true" />
                Start New Test
              </button>
              <button
                type="button"
                className="db-nav-item db-logout"
                style={{ width: '100%', justifyContent: 'flex-start' }}
                onClick={handleLogout}
              >
                <LogOut size={17} aria-hidden="true" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Mobile Bottom Navigation Bar ─────────────────── */}
      <nav className="db-mobile-nav-bar" aria-label="Quick Navigation">
        {BOTTOM_NAV_ITEMS.map(item => {
          const isActive = activePage === item.page
          const Icon = item.icon
          return (
            <button
              key={item.label}
              type="button"
              className={`db-mobile-nav-item${isActive ? ' db-mobile-nav-item--active' : ''}`}
              onClick={() => onNavigate?.(item.page)}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon size={19} aria-hidden="true" />
              <span className="db-mobile-nav-label">{item.label}</span>
              {isActive && <span className="db-mobile-nav-dot" />}
            </button>
          )
        })}
      </nav>
      <div className="db-mobile-spacer" aria-hidden="true" />
    </>
  )
}
