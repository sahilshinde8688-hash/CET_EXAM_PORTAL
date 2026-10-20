export type Page = 'signin' | 'dashboard' | 'mocktests' | 'results' | 'analytics' | 'settings' | 'admin-dashboard'

import { useEffect, useState } from 'react'
import { Lottie } from 'lottie-react'
import { authAPI, session } from '../lib/api'

interface SidebarProps {
  activePage: Page
  onNavigate?: (page: Page) => void
  onStartTest?: () => void
  mobileOpen?: boolean
  onCloseMobile?: () => void
}

type AnimatedPage = Exclude<Page, 'signin' | 'admin-dashboard'>
type NavItem = { icon: string; label: string; page: Page; animation?: string }
type AnimatedNavItem = NavItem & { page: AnimatedPage; animation: string }

const NAV_ANIMATIONS: Record<AnimatedPage, string> = {
  dashboard: '/icon-animation/DASHBOARD.json',
  mocktests: '/icon-animation/Test.json',
  results: '/icon-animation/result.json',
  analytics: '/icon-animation/Analysis.json',
  settings: '/icon-animation/PROFILE.json',
}

const NAV_ITEMS: NavItem[] = [
  { icon: 'dashboard', animation: NAV_ANIMATIONS.dashboard, label: 'Dashboard', page: 'dashboard' },
  { icon: 'quiz', animation: NAV_ANIMATIONS.mocktests, label: 'Mock Tests', page: 'mocktests' },
  { icon: 'bar_chart', animation: NAV_ANIMATIONS.results, label: 'Result', page: 'results' },
  { icon: 'analytics', animation: NAV_ANIMATIONS.analytics, label: 'Analytics', page: 'analytics' },
  { icon: 'settings', animation: NAV_ANIMATIONS.settings, label: 'Settings', page: 'settings' },
  { icon: 'admin_panel_settings', label: 'Admin', page: 'admin-dashboard' as Page },
]

const BOTTOM_NAV_ITEMS: AnimatedNavItem[] = [
  { icon: 'dashboard', animation: NAV_ANIMATIONS.dashboard, label: 'Home', page: 'dashboard' },
  { icon: 'quiz', animation: NAV_ANIMATIONS.mocktests, label: 'Tests', page: 'mocktests' },
  { icon: 'bar_chart', animation: NAV_ANIMATIONS.results, label: 'Result', page: 'results' },
  { icon: 'analytics', animation: NAV_ANIMATIONS.analytics, label: 'Analytics', page: 'analytics' },
  { icon: 'person', animation: NAV_ANIMATIONS.settings, label: 'Profile', page: 'settings' },
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
  const navItems = isAdmin ? NAV_ITEMS : NAV_ITEMS.filter(item => item.page !== 'admin-dashboard')

  const handleNavClick = (page: Page) => {
    closeDrawer()
    onNavigate?.(page)
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
        <div className="db-sidebar-brand">
          <div className="db-sidebar-logo">
            <img src="/logo.png" alt="CET NOVA" />
          </div>
          <span className="db-sidebar-title">CET NOVA</span>
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
          <button
            type="button"
            className="db-nav-item"
            style={{ width: '100%', justifyContent: 'flex-start', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit', marginBottom: 4 }}
            onClick={() => window.dispatchEvent(new CustomEvent('cet:open-qr'))}
            title="Scan QR to open portal on your mobile phone or scan codes"
          >
            <span className="material-symbols-outlined" style={{ color: '#2563eb' }}>qr_code_2</span>
            <span>Phone QR</span>
          </button>
          <button className="db-start-btn" onClick={() => onStartTest?.()}>
            <span className="material-symbols-outlined">add</span>
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
            <span className="material-symbols-outlined">logout</span>
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
              <div className="db-sidebar-brand" style={{ marginBottom: 0, padding: 0 }}>
                <div className="db-sidebar-logo" style={{ width: 42, height: 42 }}>
                  <img src="/logo.png" alt="CET NOVA" style={{ width: 32, height: 32 }} />
                </div>
                <span className="db-sidebar-title" style={{ fontSize: 18 }}>CET NOVA</span>
              </div>
              <button
                type="button"
                className="db-drawer-close-btn"
                onClick={closeDrawer}
                aria-label="Close navigation menu"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <nav className="db-mobile-drawer-items">
              {navItems.map(item => {
                const isActive = activePage === item.page
                return (
                  <button
                    key={item.label}
                    type="button"
                    className={`db-nav-item${isActive ? ' db-nav-item--active' : ''}`}
                    onClick={() => handleNavClick(item.page)}
                  >
                    {isActive && item.animation ? (
                      <Lottie
                        className="db-mobile-nav-animation"
                        src={item.animation}
                        loop
                        autoplay
                        aria-hidden="true"
                        rendererSettings={{ preserveAspectRatio: 'xMidYMid meet' }}
                      />
                    ) : (
                      <span className="material-symbols-outlined">{item.icon}</span>
                    )}
                    <span>{item.label}</span>
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
                <span className="material-symbols-outlined" style={{ color: '#2563eb' }}>qr_code_2</span>
                <span>Phone QR / Scanner</span>
              </button>
              <button
                type="button"
                className="db-start-btn"
                onClick={() => {
                  closeDrawer()
                  onStartTest?.()
                }}
              >
                <span className="material-symbols-outlined">add</span>
                Start New Test
              </button>
              <button
                type="button"
                className="db-nav-item db-logout"
                style={{ width: '100%', justifyContent: 'flex-start' }}
                onClick={handleLogout}
              >
                <span className="material-symbols-outlined">logout</span>
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
          return (
            <button
              key={item.label}
              type="button"
              className={`db-mobile-nav-item${isActive ? ' db-mobile-nav-item--active' : ''}`}
              onClick={() => onNavigate?.(item.page)}
              aria-current={isActive ? 'page' : undefined}
            >
              {isActive ? (
                <Lottie
                  className="db-mobile-nav-animation"
                  src={item.animation}
                  loop
                  autoplay
                  aria-hidden="true"
                  rendererSettings={{ preserveAspectRatio: 'xMidYMid meet' }}
                />
              ) : (
                <span className="material-symbols-outlined">{item.icon}</span>
              )}
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
