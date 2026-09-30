import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import SignIn from './components/SignIn'
import { clearAdminCredentials } from './adminAuth'
import { authAPI, SessionExpiredError, session, type AuthUser } from './lib/api'
import './dashboard.css'
import './mocktests.css'
import './results.css'
import './analysis.css'
import './settings.css'

const Dashboard = lazy(() => import('./components/Dashboard'))
const MockTests = lazy(() => import('./components/MockTests'))
const Results = lazy(() => import('./components/Results'))
const Analysis = lazy(() => import('./components/Analysis'))
const Settings = lazy(() => import('./components/Settings'))
const AdminDashboard = lazy(() => import('./components/AdminDashboard'))

export type Page = 'signin' | 'dashboard' | 'mocktests' | 'results' | 'analytics' | 'settings' | 'admin' | 'unauthorized'

const pathToPage = (pathname: string): Page => {
  if (pathname.startsWith('/admin')) return 'admin'
  if (pathname === '/dashboard' || pathname === '/') return 'dashboard'
  if (pathname === '/mock-tests') return 'mocktests'
  if (pathname === '/results') return 'results'
  if (pathname === '/analytics') return 'analytics'
  if (pathname === '/settings') return 'settings'
  if (pathname === '/unauthorized') return 'unauthorized'
  return 'signin'
}

const pageToPath = (page: Page) => {
  if (page === 'admin') return '/admin/dashboard'
  if (page === 'signin') return '/login'
  if (page === 'unauthorized') return '/unauthorized'
  return `/${page === 'mocktests' ? 'mock-tests' : page}`
}

  const PAGE_ICONS: Record<string, string> = {
  dashboard: 'dashboard',
  mocktests: 'quiz',
  results:   'history',
  analytics: 'analytics',
  settings:  'settings',
  unauthorized: 'lock',
}
const PAGE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  mocktests: 'Mock Tests',
  results:   'Results',
  analytics: 'Analytics',
  settings:  'Settings',
  unauthorized: 'Access denied',
}

/* ── Page transition loader ── */
function PageLoader({ target }: { target: Page }) {
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const steps = [10, 25, 40, 58, 72, 85]
    let i = 0
    const interval = setInterval(() => {
      if (i < steps.length) { setProgress(steps[i]); i++ }
      else clearInterval(interval)
    }, 100)
    return () => clearInterval(interval)
  }, [])
  const icon = PAGE_ICONS[target] ?? 'school'
  const label = PAGE_LABELS[target] ?? 'Loading'
  return (
    <div className="ld-root">
      <div className="ld-progress-track">
        <div className="ld-progress-bar" style={{ width: `${progress}%` }} />
      </div>
      <div className="ld-card">
        <div className="ld-icon-bubble">
          <span className="material-symbols-outlined ld-icon">{icon}</span>
          <div className="ld-icon-ring ld-ring-1" />
          <div className="ld-icon-ring ld-ring-2" />
          <div className="ld-icon-ring ld-ring-3" />
        </div>
        <p className="ld-label">{label}</p>
        <div className="ld-shimmer-wrap">
          <div className="ld-shimmer ld-shimmer--w80" />
          <div className="ld-shimmer ld-shimmer--w60" />
          <div className="ld-shimmer ld-shimmer--w70" />
        </div>
        <div className="ld-dots">
          <span className="ld-dot" style={{ animationDelay: '0s' }} />
          <span className="ld-dot" style={{ animationDelay: '0.18s' }} />
          <span className="ld-dot" style={{ animationDelay: '0.36s' }} />
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [page, setPage] = useState<Page>(() => pathToPage(window.location.pathname))
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState(false)
  const [authenticatedUser, setAuthenticatedUser] = useState<AuthUser | null>(null)
  const authenticatedUserRef = useRef<AuthUser | null>(null)
  const [transitioning, setTransitioning] = useState(false)
  const [nextPage, setNextPage] = useState<Page | null>(null)

  const restoreSession = async (requestedPage: Page) => {
    setAuthLoading(true)
    setAuthError(false)
    try {
      const user = await authAPI.me()
      session.save(user)
      authenticatedUserRef.current = user
      setAuthenticatedUser(user)

      const destination = requestedPage === 'signin'
        ? user.role === 'admin' ? 'admin' : 'dashboard'
        : requestedPage === 'admin' && user.role !== 'admin'
          ? 'unauthorized'
          : requestedPage

      if (destination !== requestedPage) {
        window.history.replaceState({ page: destination }, '', pageToPath(destination))
      }
      setPage(destination)
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) {
        setAuthError(true)
        setAuthLoading(false)
        return
      }

      session.clear()
      authenticatedUserRef.current = null
      setAuthenticatedUser(null)
      if (requestedPage !== 'signin') {
        window.history.replaceState({ page: 'signin' }, '', pageToPath('signin'))
      }
      setPage('signin')
    } finally {
      setAuthLoading(false)
    }
  }

  useEffect(() => {
    const handlePopState = () => { void restoreSession(pathToPage(window.location.pathname)) }
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void restoreSession(pathToPage(window.location.pathname))
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === session.KEY) void restoreSession(pathToPage(window.location.pathname))
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && pathToPage(window.location.pathname) !== 'signin') {
        void restoreSession(pathToPage(window.location.pathname))
      }
    }
    const handleSessionExpired = () => {
      authenticatedUserRef.current = null
      setAuthenticatedUser(null)
      setAuthError(false)
      setAuthLoading(false)
      setTransitioning(false)
      setNextPage(null)
      window.history.replaceState({ page: 'signin' }, '', pageToPath('signin'))
      setPage('signin')
    }

    void restoreSession(pathToPage(window.location.pathname))
    window.addEventListener('popstate', handlePopState)
    window.addEventListener('pageshow', handlePageShow)
    window.addEventListener('storage', handleStorage)
    window.addEventListener('auth:expired', handleSessionExpired)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('pageshow', handlePageShow)
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('auth:expired', handleSessionExpired)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  const navigate = (target: Page | string) => {
    const resolvedTarget = (target === 'admin-dashboard' ? 'admin' : target) as Page
    if (resolvedTarget === page) return
    if (resolvedTarget === 'signin') {
      authenticatedUserRef.current = null
      setAuthenticatedUser(null)
      setAuthError(false)
      setTransitioning(false)
      setNextPage(null)
      window.history.replaceState({ page: 'signin' }, '', pageToPath('signin'))
      setPage('signin')
      return
    }
    if (resolvedTarget === 'admin' && authenticatedUser?.role !== 'admin') {
      window.history.replaceState({ page: 'unauthorized' }, '', pageToPath('unauthorized'))
      setPage('unauthorized')
      return
    }
    window.history.pushState({ page: resolvedTarget }, '', pageToPath(resolvedTarget))
    setNextPage(resolvedTarget)
    setTransitioning(true)
  }

  useEffect(() => {
    if (!transitioning || !nextPage) return
    const t = setTimeout(() => {
      setPage(nextPage)
      setNextPage(null)
      setTransitioning(false)
    }, 250)
    return () => clearTimeout(t)
  }, [transitioning, nextPage])

  if (authLoading) return <PageLoader target={page} />
  if (authError) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1>Unable to verify your session</h1>
          <p>Please check your connection and try again.</p>
          <button type="button" onClick={() => void restoreSession(pathToPage(window.location.pathname))}>Retry</button>
        </div>
      </div>
    )
  }
  if (transitioning && nextPage) return <PageLoader target={nextPage} />
  return (
    <Suspense fallback={<PageLoader target={page} />}>
      {page === 'signin' && (
        <SignIn
          onSuccess={user => {
            session.save(user)
            authenticatedUserRef.current = user
            setAuthenticatedUser(user)
            const destination = user.role === 'admin' ? 'admin' : 'dashboard'
            window.history.replaceState({ page: destination }, '', pageToPath(destination))
            setPage(destination)
          }}
        />
      )}
      {page === 'mocktests' && <MockTests onNavigate={navigate} />}
      {page === 'results' && <Results onNavigate={navigate} />}
      {page === 'analytics' && <Analysis onNavigate={navigate} />}
      {page === 'settings' && <Settings onNavigate={navigate} />}
      {page === 'admin' && (
        <AdminDashboard
          onNavigate={navigate}
          onLogout={() => {
            clearAdminCredentials()
            navigate('signin')
          }}
        />
      )}
      {page === 'dashboard' && <Dashboard onNavigate={navigate} />}
      {page === 'unauthorized' && (
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f8fafc' }}>
          <div style={{ maxWidth: 420, textAlign: 'center', padding: 32, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16 }}>
            <h1>403</h1>
            <h2>Access Denied</h2>
            <p>You don't have permission to access this area.</p>
            <button type="button" onClick={() => navigate('dashboard')}>Back to Dashboard</button>
            <button type="button" onClick={() => {
              void authAPI.logout().catch(() => {}).finally(() => {
                session.clear()
                navigate('signin')
              })
            }}>Logout</button>
          </div>
        </div>
      )}
    </Suspense>
  )
}
