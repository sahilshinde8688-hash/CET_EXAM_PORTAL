import { useState, useEffect } from 'react'
import SignIn from './components/SignIn'
import Dashboard from './components/Dashboard'
import MockTests from './components/MockTests'
import Results from './components/Results'
import Analysis from './components/Analysis'
import Settings from './components/Settings'
import AdminDashboard from './components/AdminDashboard'
import GlobalLoader from './components/GlobalLoader'
import { authAPI, session, type AuthUser, TokenRefreshedError } from './lib/api'
import './dashboard.css'
import './mocktests.css'
import './results.css'
import './analysis.css'
import './settings.css'
import './admin.css'
import './testInterface.css'
import './global-loader.css'

export type Page = 'signin' | 'dashboard' | 'mocktests' | 'results' | 'analytics' | 'settings' | 'admin-dashboard'

const PAGE_PATHS: Record<Page, string> = {
  signin: '/signin',
  dashboard: '/dashboard',
  mocktests: '/tests',
  results: '/results',
  analytics: '/analytics',
  settings: '/settings',
  'admin-dashboard': '/admin-dashboard',
}

function pageFromPath(pathname: string): Page | null {
  if (pathname === '/' || pathname === '/signin' || pathname === '/login') return pathname === '/' ? null : 'signin'
  if (pathname === '/dashboard') return 'dashboard'
  if (pathname === '/tests' || /^\/test\/[^/]+$/.test(pathname)) return 'mocktests'
  if (pathname === '/results' || /^\/results\/[^/]+$/.test(pathname)) return 'results'
  if (pathname === '/analytics') return 'analytics'
  if (pathname === '/settings' || pathname === '/profile') return 'settings'
  if (pathname === '/admin-dashboard') return 'admin-dashboard'
  return null
}

function currentPage(): Page | null {
  return pageFromPath(window.location.pathname)
}

/* ── Boot loader ── */
/* ── App ── */
export default function App() {
  const [booting, setBooting]           = useState(true)
  const [page, setPage]                 = useState<Page>(() => currentPage() || 'signin')
  const [globalLoading, setGlobalLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    const handlePopState = () => {
      const requestedPage = currentPage()
      if (requestedPage) {
        setPage(requestedPage)
      } else {
        const fallback = session.get<AuthUser>()?._id ? 'dashboard' : 'signin'
        window.history.replaceState(null, '', PAGE_PATHS[fallback])
        setPage(fallback)
      }
    }
    window.addEventListener('popstate', handlePopState)
    const handleGlobalLoading = (event: Event) => setGlobalLoading((event as CustomEvent<boolean>).detail)
    window.addEventListener('app:loading', handleGlobalLoading)

    const restoreSession = async () => {
      const loaderStartedAt = Date.now()
      try {
        // Try to get current user - handle() will auto-refresh token if needed
        const me = await authAPI.me()
        if (!cancelled && me?._id) {
          session.save(me)
          const requestedPage = currentPage()
          const destination = requestedPage && requestedPage !== 'signin' ? requestedPage : me.role === 'admin' ? 'admin-dashboard' : 'dashboard'
          if (!requestedPage || requestedPage === 'signin') window.history.replaceState(null, '', PAGE_PATHS[destination])
          setPage(destination)
        }
      } catch (err) {
        // Check if error is a signal to retry (token was refreshed)
        if (err instanceof TokenRefreshedError) {
          // Token was refreshed, retry the original request without going through handle()
          try {
            const me = await authAPI.meAfterRefresh()
            if (!cancelled && me?._id) {
              session.save(me)
              const requestedPage = currentPage()
              const destination = requestedPage && requestedPage !== 'signin' ? requestedPage : me.role === 'admin' ? 'admin-dashboard' : 'dashboard'
              if (!requestedPage || requestedPage === 'signin') window.history.replaceState(null, '', PAGE_PATHS[destination])
              setPage(destination)
              return
            }
          } catch {
            // Retry failed, continue to catch block below
          }
        }
        
        if (!cancelled) {
          session.clear()
          if (currentPage() !== 'signin') {
            window.history.replaceState(null, '', '/signin')
            setPage('signin')
          }
        }
      } finally {
        if (!cancelled) {
          const remaining = Math.max(0, 600 - (Date.now() - loaderStartedAt))
          window.setTimeout(() => {
            if (!cancelled) setBooting(false)
          }, remaining)
        }
      }
    }

    const t = setTimeout(restoreSession, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('app:loading', handleGlobalLoading)
    }
  }, [])

  const navigate = (target: Page) => {
    if (target === page) return
    const path = PAGE_PATHS[target]
    if (target === 'signin') window.history.replaceState(null, '', path)
    else window.history.pushState(null, '', path)
    setGlobalLoading(true)
    setPage(target)
    window.setTimeout(() => setGlobalLoading(false), 600)
  }

  if (booting) return <GlobalLoader message="Checking your session" />
  if (globalLoading) return <GlobalLoader message="Loading page" />

  if (page === 'signin')          return <SignIn onSuccess={() => navigate('dashboard')} onAdminLogin={() => navigate('admin-dashboard')} />
  if (page === 'mocktests')       return <MockTests onNavigate={navigate} />
  if (page === 'results')         return <Results onNavigate={navigate} />
  if (page === 'analytics')       return <Analysis onNavigate={navigate} />
  if (page === 'settings')        return <Settings onNavigate={navigate} />
  if (page === 'admin-dashboard') return <AdminDashboard onNavigate={navigate} />
  return <Dashboard onNavigate={navigate} />
}
