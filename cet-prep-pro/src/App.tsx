import { lazy, startTransition, Suspense, useEffect, useRef, useState } from 'react'
import SignIn from './components/SignIn'
import { clearAdminCredentials } from './adminAuth'
import { ApiResponseError, authAPI, SessionExpiredError, session, type AuthUser } from './lib/api'
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

const getLoginDestination = (user: AuthUser): { page: Page; path: string } => {
  if (user.role === 'admin') {
    const isSuperAdmin = user.adminRole === 'Super Admin'
    return {
      page: 'admin',
      path: isSuperAdmin ? '/admin/super-admin' : '/admin/dashboard',
    }
  }
  return { page: 'dashboard', path: '/dashboard' }
}

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

const getSessionCheckErrorMessage = (error: unknown): string => {
  if (error instanceof ApiResponseError) {
    return `Authentication service returned HTTP ${error.status}: ${error.message}`
  }
  if (error instanceof TypeError) {
    return `Could not reach the authentication service (${error.message}). Check that the API server is running and the /api proxy is configured.`
  }
  if (error instanceof Error) {
    return `Session check failed: ${error.message}`
  }
  return 'Session check failed because of an unexpected error. Check the API server and retry.'
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
  const [sessionExpired, setSessionExpired] = useState(false)
  const [sessionCheckError, setSessionCheckError] = useState<string | null>(null)
  const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null)
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null)
  const [sessionInactivityTimeoutSeconds, setSessionInactivityTimeoutSeconds] = useState<number | null>(null)
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState('Your session expired because you were inactive. Please sign in again.')
  const [showSessionWarning, setShowSessionWarning] = useState(false)
  const lastClientActivityRef = useRef(Date.now())
  const lastActivityProjectionRef = useRef(0)
  const activityRequestInProgressRef = useRef(false)
  const restoreSessionRef = useRef<(requestedPage: Page) => Promise<void>>(async () => {})

  const restoreSession = async (requestedPage: Page, showLoader = true) => {
    const hadClientSession = Boolean(session.get())
    if (showLoader) setAuthLoading(true)
    setSessionExpired(false)
    setSessionCheckError(null)
    try {
      const checkedSession = await authAPI.checkSession()
      if (!checkedSession.authenticated || !checkedSession.user) throw new SessionExpiredError()
      const user = checkedSession.user
      session.save(user)
      setSessionExpiresAt(checkedSession.expiresAt)
      setSessionInactivityTimeoutSeconds(checkedSession.inactivityTimeoutSeconds)
      lastClientActivityRef.current = Date.now()
      setShowSessionWarning(false)

      const loginDestination = requestedPage === 'signin' ? getLoginDestination(user) : null
      const destination = loginDestination
        ? loginDestination.page
        : requestedPage === 'admin' && user.role !== 'admin'
          ? 'unauthorized'
          : requestedPage

      if (destination !== requestedPage) {
        window.history.replaceState(
          { page: destination },
          '',
          loginDestination?.path ?? pageToPath(destination),
        )
      }
      startTransition(() => setPage(destination))
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) {
        setSessionCheckError(getSessionCheckErrorMessage(error))
        if (requestedPage !== 'signin') {
          window.history.replaceState({ page: 'signin' }, '', pageToPath('signin'))
        }
        setPage('signin')
        return
      }

      setSessionExpired(hadClientSession)
      setSessionExpiredMessage(error instanceof SessionExpiredError ? error.message : 'Your session expired because you were inactive. Please sign in again.')
      setSessionCheckError(null)
      setSessionExpiresAt(null)
      setSessionInactivityTimeoutSeconds(null)
      session.clear()
      if (requestedPage !== 'signin') {
        window.history.replaceState({ page: 'signin' }, '', pageToPath('signin'))
      }
      setPage('signin')
    } finally {
      if (showLoader) setAuthLoading(false)
    }
  }
  restoreSessionRef.current = restoreSession

  useEffect(() => {
    if (!sessionExpiresAt || !sessionInactivityTimeoutSeconds) return
    const expiresAt = Date.parse(sessionExpiresAt)
    if (!Number.isFinite(expiresAt)) return
    const warningLeadMs = Math.min(2 * 60 * 1000, sessionInactivityTimeoutSeconds * 1000 / 3)
    let validationRetryTimer: number | null = null
    const validateExpiry = () => {
      void authAPI.checkSession().then(checkedSession => {
        if (!checkedSession.authenticated) throw new SessionExpiredError()
        if (Date.parse(checkedSession.expiresAt) <= Date.now()) {
          validationRetryTimer = window.setTimeout(validateExpiry, 1000)
          return
        }
        setSessionExpiresAt(checkedSession.expiresAt)
        setSessionInactivityTimeoutSeconds(checkedSession.inactivityTimeoutSeconds)
        setShowSessionWarning(false)
      }).catch(error => {
        if (!(error instanceof SessionExpiredError)) {
          setSessionCheckError(getSessionCheckErrorMessage(error))
          window.setTimeout(() => {
            void restoreSessionRef.current(pathToPage(window.location.pathname), false)
          }, 15000)
        }
      })
    }
    const warningTimer = window.setTimeout(
      () => setShowSessionWarning(true),
      Math.max(0, expiresAt - Date.now() - warningLeadMs),
    )
    const expiryTimer = window.setTimeout(validateExpiry, Math.max(0, expiresAt - Date.now()))
    return () => {
      window.clearTimeout(warningTimer)
      window.clearTimeout(expiryTimer)
      if (validationRetryTimer !== null) window.clearTimeout(validationRetryTimer)
    }
  }, [sessionExpiresAt, sessionInactivityTimeoutSeconds])

  useEffect(() => {
    if (!session.get() || !sessionInactivityTimeoutSeconds || page === 'signin') return

    const recordLocalActivity = () => {
      const now = Date.now()
      lastClientActivityRef.current = now
      setShowSessionWarning(false)
      if (now - lastActivityProjectionRef.current >= 5000) {
        lastActivityProjectionRef.current = now
        setSessionExpiresAt(new Date(now + sessionInactivityTimeoutSeconds * 1000).toISOString())
      }
    }
    const activityEvents: Array<keyof DocumentEventMap> = [
      'click', 'keydown', 'input', 'change', 'submit', 'scroll', 'wheel',
      'pointerdown', 'touchstart', 'mousemove',
    ]
    activityEvents.forEach(eventName => document.addEventListener(eventName, recordLocalActivity, { passive: true }))
    window.addEventListener('auth:activity', recordLocalActivity)
    window.addEventListener('popstate', recordLocalActivity)

    const heartbeatMs = Math.min(60 * 1000, Math.max(15 * 1000, sessionInactivityTimeoutSeconds * 1000 / 3))
    const heartbeat = window.setInterval(() => {
      const now = Date.now()
      if (now - lastClientActivityRef.current > heartbeatMs || activityRequestInProgressRef.current) return
      activityRequestInProgressRef.current = true
      void authAPI.recordActivity().then(result => {
        setSessionExpiresAt(result.expiresAt)
        setSessionInactivityTimeoutSeconds(result.inactivityTimeoutSeconds)
        setSessionCheckError(null)
        setShowSessionWarning(false)
      }).catch(error => {
        if (!(error instanceof SessionExpiredError)) setSessionCheckError(getSessionCheckErrorMessage(error))
      }).finally(() => {
        activityRequestInProgressRef.current = false
      })
    }, heartbeatMs)

    return () => {
      activityEvents.forEach(eventName => document.removeEventListener(eventName, recordLocalActivity))
      window.removeEventListener('auth:activity', recordLocalActivity)
      window.removeEventListener('popstate', recordLocalActivity)
      window.clearInterval(heartbeat)
    }
  }, [page, sessionInactivityTimeoutSeconds])

  useEffect(() => {
    const handlePopState = () => { void restoreSession(pathToPage(window.location.pathname), false) }
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void restoreSession(pathToPage(window.location.pathname), false)
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === session.KEY) void restoreSession(pathToPage(window.location.pathname), false)
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && pathToPage(window.location.pathname) !== 'signin') {
        void restoreSession(pathToPage(window.location.pathname), false)
      }
    }
    const handleSessionExpired = (event: Event) => {
      const detail = (event as CustomEvent<{ hadSession?: boolean; message?: string }>).detail
      setSessionExpired(Boolean(detail?.hadSession))
      setSessionExpiredMessage(detail?.message || 'Your session expired because you were inactive. Please sign in again.')
      setSessionExpiresAt(null)
      setSessionInactivityTimeoutSeconds(null)
      setShowSessionWarning(false)
      clearAdminCredentials()
      setAuthLoading(false)
      window.history.replaceState({ page: 'signin' }, '', pageToPath('signin'))
      setPage('signin')
    }
    const handleMaintenanceActive = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail
      setMaintenanceMessage(detail?.message || 'The system is under maintenance. Please check back later.')
    }

    void restoreSession(pathToPage(window.location.pathname))
    window.addEventListener('popstate', handlePopState)
    window.addEventListener('pageshow', handlePageShow)
    window.addEventListener('storage', handleStorage)
    window.addEventListener('auth:expired', handleSessionExpired)
    window.addEventListener('maintenance:active', handleMaintenanceActive)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('pageshow', handlePageShow)
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('auth:expired', handleSessionExpired)
      window.removeEventListener('maintenance:active', handleMaintenanceActive)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  const navigate = (target: Page | string) => {
    const resolvedTarget = (target === 'admin-dashboard' ? 'admin' : target) as Page
    if (resolvedTarget === page) return
    if (resolvedTarget === 'signin') {
      setSessionExpiresAt(null)
      setSessionExpired(false)
      setSessionCheckError(null)
      setSessionInactivityTimeoutSeconds(null)
      setShowSessionWarning(false)
      window.history.replaceState({ page: 'signin' }, '', pageToPath('signin'))
      setPage('signin')
      return
    }
    setSessionCheckError(null)
    void authAPI.checkSession().then(checkedSession => {
      if (!checkedSession.authenticated || !checkedSession.user) throw new SessionExpiredError()
      const user = checkedSession.user
      session.save(user)
      setSessionExpiresAt(checkedSession.expiresAt)
      setSessionInactivityTimeoutSeconds(checkedSession.inactivityTimeoutSeconds)

      if (resolvedTarget === 'admin' && user.role !== 'admin') {
        window.history.replaceState({ page: 'unauthorized' }, '', pageToPath('unauthorized'))
        startTransition(() => setPage('unauthorized'))
        return
      }
      window.history.pushState({ page: resolvedTarget }, '', pageToPath(resolvedTarget))
      startTransition(() => setPage(resolvedTarget))
    }).catch(error => {
      if (error instanceof SessionExpiredError) {
        setSessionExpired(Boolean(session.get()))
        setSessionExpiredMessage(error.message)
        setSessionExpiresAt(null)
        setSessionInactivityTimeoutSeconds(null)
        setSessionCheckError(null)
        session.clear()
        clearAdminCredentials()
      } else {
        setSessionCheckError(getSessionCheckErrorMessage(error))
      }
      window.history.replaceState({ page: 'signin' }, '', pageToPath('signin'))
      setPage('signin')
    })
  }

  if (maintenanceMessage !== null) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f8fafc' }}>
        <div style={{ maxWidth: 520, textAlign: 'center', padding: 36, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16 }}>
          <h1>System Maintenance</h1>
          <p>{maintenanceMessage}</p>
          <button type="button" onClick={() => window.location.reload()}>Check again</button>
        </div>
      </div>
    )
  }
  if (authLoading) return <PageLoader target={page} />
  return (
    <>
    <Suspense fallback={<PageLoader target={page} />}>
      {page === 'signin' && (
        <SignIn
          sessionExpired={sessionExpired}
          sessionExpiredMessage={sessionExpiredMessage}
          onSuccess={user => {
            session.save(user)
            setSessionExpired(false)
            setSessionCheckError(null)
            setSessionExpiresAt(user.expiresAt || null)
            setSessionInactivityTimeoutSeconds(user.inactivityTimeoutSeconds || null)
            setShowSessionWarning(false)
            lastClientActivityRef.current = Date.now()
            const destination = getLoginDestination(user)
            window.history.replaceState({ page: destination.page }, '', destination.path)
            setPage(destination.page)
          }}
          sessionCheckError={sessionCheckError}
          onRetrySession={() => void restoreSession(pathToPage(window.location.pathname))}
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
    {showSessionWarning && page !== 'signin' && (
      <div className="session-inactivity-overlay" role="presentation">
        <section className="session-inactivity-dialog" role="dialog" aria-modal="true" aria-labelledby="session-inactivity-title">
          <div className="session-inactivity-icon" aria-hidden="true">!</div>
          <h2 id="session-inactivity-title">Still there?</h2>
          <p>You have been inactive for a while. Move or interact with the website to remain signed in.</p>
          <button type="button" onClick={() => {
            void authAPI.recordActivity().then(result => {
              setSessionExpiresAt(result.expiresAt)
              setSessionInactivityTimeoutSeconds(result.inactivityTimeoutSeconds)
              setSessionCheckError(null)
              setShowSessionWarning(false)
            }).catch(error => {
              if (!(error instanceof SessionExpiredError)) setSessionCheckError(getSessionCheckErrorMessage(error))
            })
          }}>Stay Signed In</button>
        </section>
      </div>
    )}
    </>
  )
}
