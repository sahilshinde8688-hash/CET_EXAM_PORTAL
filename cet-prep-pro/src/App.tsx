import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import SignIn from './components/SignIn'
import { clearAdminCredentials } from './adminAuth'
import { authAPI, session, type AuthUser } from './lib/api'
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
  const authenticatedUserRef = useRef<AuthUser | null>(null)
  const [transitioning, setTransitioning] = useState(false)
  const [nextPage, setNextPage] = useState<Page | null>(null)

  useEffect(() => {
    const requestedPage = pathToPage(window.location.pathname)
    let active = true

    const initializeAuth = async () => {
      try {
        const user = await authAPI.me()
        if (!active) return
        session.save(user)
        authenticatedUserRef.current = user
        if (requestedPage === 'admin' && user.role !== 'admin') {
          window.history.replaceState(null, '', '/unauthorized')
          setPage('unauthorized')
        } else if (requestedPage === 'signin') {
          const destination = user.role === 'admin' ? 'admin' : 'dashboard'
          window.history.replaceState(null, '', pageToPath(destination))
          setPage(destination)
        } else {
          setPage(requestedPage)
        }
      } catch {
        session.clear()
        authenticatedUserRef.current = null
        if (requestedPage !== 'signin') {
          window.history.replaceState(null, '', '/login')
          setPage('signin')
        } else {
          setPage('signin')
        }
      } finally {
        if (active) setAuthLoading(false)
      }
    }

    void initializeAuth()

    const handlePopState = () => {
      const next = pathToPage(window.location.pathname)
      if (next === 'admin' && authenticatedUserRef.current?.role !== 'admin') {
        window.history.replaceState(null, '', '/unauthorized')
        setPage('unauthorized')
        return
      }
      setPage(next)
    }
    window.addEventListener('popstate', handlePopState)
    return () => { active = false; window.removeEventListener('popstate', handlePopState) }
  }, [])

  const navigate = (target: Page | string) => {
    const resolvedTarget = (target === 'admin-dashboard' ? 'admin' : target) as Page
    if (resolvedTarget === page) return
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
  if (transitioning && nextPage) return <PageLoader target={nextPage} />
  return (
    <Suspense fallback={<PageLoader target={page} />}>
      {page === 'signin' && (
        <SignIn
          onSuccess={() => navigate('dashboard')}
          onAdminLogin={() => {
            void authAPI.me().then(user => {
              authenticatedUserRef.current = user
              navigate('admin')
            }).catch(() => {
              session.clear()
              window.history.replaceState(null, '', '/login')
              setPage('signin')
            })
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
            window.history.replaceState(null, '', '/login')
            setPage('signin')
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
            <button type="button" onClick={() => { session.clear(); window.history.replaceState(null, '', '/login'); setPage('signin') }}>Logout</button>
          </div>
        </div>
      )}
    </Suspense>
  )
}
