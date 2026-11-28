import { lazy, startTransition, Suspense, useEffect, useRef, useState } from 'react'
import './page-loader.css'
import SignIn from './components/SignIn'
import ThemeToggle from './components/ThemeToggle'
import Sidebar, { type Page as SidebarPage } from './components/Sidebar'
import { clearAdminCredentials } from './adminAuth'
import { ApiResponseError, authAPI, SessionExpiredError, session, type AuthUser } from './lib/api'

const LandingPage = lazy(() => import('./components/LandingPage'))
const MobileQRModal = lazy(() => import('./components/MobileQRModal'))
const Dashboard = lazy(() => import('./components/Dashboard'))
const MockTests = lazy(() => import('./components/MockTests'))
const Results = lazy(() => import('./components/Results'))
const Analysis = lazy(() => import('./components/Analysis'))
const Settings = lazy(() => import('./components/Settings'))
const AdminDashboard = lazy(() => import('./components/AdminDashboard'))

export type Page = SidebarPage

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
  if (pathname === '/') return 'landing'
  if (pathname === '/dashboard') return 'dashboard'
  if (pathname === '/mock-tests') return 'mocktests'
  if (pathname === '/results') return 'results'
  if (pathname === '/analytics') return 'analytics'
  if (pathname === '/settings') return 'settings'
  if (pathname === '/unauthorized') return 'unauthorized'
  return 'signin'
}

const pageToPath = (page: Page) => {
  if (page === 'admin') return '/admin/dashboard'
  if (page === 'landing') return '/'
  if (page === 'signin') return '/login'
  if (page === 'unauthorized') return '/unauthorized'
  return `/${page === 'mocktests' ? 'mock-tests' : page}`
}

const getSessionCheckErrorMessage = (error: unknown): string => {
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'Session verification timed out. Please retry; you can still sign in below.'
  }
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

const PAGE_LABELS: Record<string, string> = {
  landing:   'Home',
  signin:    'Sign in',
  dashboard: 'Dashboard',
  mocktests: 'Mock Tests',
  results:   'Results',
  analytics: 'Analytics',
  settings:  'Settings',
  admin:     'Admin dashboard',
  unauthorized: 'Access denied',
}

const SESSION_CHECK_TIMEOUT_MS = 10_000
const STARTUP_ANIMATION_SESSION_KEY = 'cetNovaStartupAnimationPlayed'

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
  const label = PAGE_LABELS[target] ?? 'Loading'
  return (
    <div className="ld-root" role="status" aria-live="polite" aria-label={`Opening ${label}`}>
      <div className="ld-progress-track">
        <div className="ld-progress-bar" style={{ width: `${progress}%` }} />
      </div>
      <div className="ld-card">
        <div className="ld-icon-bubble" aria-hidden="true">
          <div className="ld-orbit ld-orbit--outer"><span className="ld-orbit-dot" /></div>
          <div className="ld-orbit ld-orbit--inner"><span className="ld-orbit-dot" /></div>
          <span className="ld-monogram">CET</span>
        </div>
        <p className="ld-eyebrow">CET NOVA</p>
        <p className="ld-label">Opening {label}</p>
        <p className="ld-hint">Getting your page ready</p>
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
  const [navigatingTo, setNavigatingTo] = useState<Page | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [showStartupAnimation, setShowStartupAnimation] = useState(
    () => sessionStorage.getItem(STARTUP_ANIMATION_SESSION_KEY) !== 'true',
  )
  const [sessionExpired, setSessionExpired] = useState(false)
  const [sessionCheckError, setSessionCheckError] = useState<string | null>(null)
  const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null)
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null)
  const [sessionInactivityTimeoutSeconds, setSessionInactivityTimeoutSeconds] = useState<number | null>(null)
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState('Your session expired because you were inactive. Please sign in again.')
  const [showSessionWarning, setShowSessionWarning] = useState(false)
  const [showQrModal, setShowQrModal] = useState(false)
  const lastClientActivityRef = useRef(Date.now())
  const lastActivityProjectionRef = useRef(0)
  const activityRequestInProgressRef = useRef(false)
  const restoreSessionRef = useRef<(requestedPage: Page, showLoader?: boolean) => Promise<void>>(async () => {})
  const sessionRestoreGenerationRef = useRef(0)

  useEffect(() => {
    if (!showStartupAnimation) return
    sessionStorage.setItem(STARTUP_ANIMATION_SESSION_KEY, 'true')
  }, [showStartupAnimation])

  const restoreSession = async (requestedPage: Page, showLoader = true) => {
    const generation = ++sessionRestoreGenerationRef.current
    const hadClientSession = Boolean(session.get())
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), SESSION_CHECK_TIMEOUT_MS)
    if (showLoader) setAuthLoading(true)
    setSessionExpired(false)
    setSessionCheckError(null)
    try {
      const checkedSession = await authAPI.checkSession(controller.signal)
      if (generation !== sessionRestoreGenerationRef.current) return
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
      if (generation !== sessionRestoreGenerationRef.current) return
      if (!(error instanceof SessionExpiredError)) {
        setSessionCheckError(getSessionCheckErrorMessage(error))
        if (requestedPage !== 'signin' && requestedPage !== 'landing') {
          window.history.replaceState({ page: 'signin' }, '', pageToPath('signin'))
        }
        setPage(requestedPage === 'landing' ? 'landing' : 'signin')
        return
      }

      setSessionExpired(hadClientSession)
      setSessionExpiredMessage(error instanceof SessionExpiredError ? error.message : 'Your session expired because you were inactive. Please sign in again.')
      setSessionCheckError(null)
      setSessionExpiresAt(null)
      setSessionInactivityTimeoutSeconds(null)
      session.clear()
      if (requestedPage !== 'signin' && requestedPage !== 'landing') {
        window.history.replaceState({ page: 'signin' }, '', pageToPath('signin'))
      }
      setPage(requestedPage === 'landing' ? 'landing' : 'signin')
    } finally {
      window.clearTimeout(timeoutId)
      if (generation === sessionRestoreGenerationRef.current) setAuthLoading(false)
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
    const handlePopState = () => {
      const requestedPage = pathToPage(window.location.pathname)
      if (requestedPage === 'landing') {
        sessionRestoreGenerationRef.current += 1
        setAuthLoading(false)
        setPage('landing')
        return
      }
      void restoreSession(requestedPage, false)
    }
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      const requestedPage = pathToPage(window.location.pathname)
      if (requestedPage === 'landing') {
        sessionRestoreGenerationRef.current += 1
        setAuthLoading(false)
        setPage('landing')
        return
      }
      void restoreSession(requestedPage, false)
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === session.KEY && pathToPage(window.location.pathname) !== 'landing') {
        void restoreSession(pathToPage(window.location.pathname), false)
      }
    }
    const handleVisibility = () => {
      const requestedPage = pathToPage(window.location.pathname)
      if (document.visibilityState === 'visible' && requestedPage !== 'signin' && requestedPage !== 'landing') {
        void restoreSession(pathToPage(window.location.pathname), false)
      }
    }
    const handleSessionExpired = (event: Event) => {
      sessionRestoreGenerationRef.current += 1
      const detail = (event as CustomEvent<{ hadSession?: boolean; message?: string }>).detail
      const preservePublicLanding = pathToPage(window.location.pathname) === 'landing'
      setSessionExpired(Boolean(detail?.hadSession))
      setSessionExpiredMessage(detail?.message || 'Your session expired because you were inactive. Please sign in again.')
      setSessionExpiresAt(null)
      setSessionInactivityTimeoutSeconds(null)
      setShowSessionWarning(false)
      clearAdminCredentials()
      setAuthLoading(false)
      if (!preservePublicLanding) {
        window.history.replaceState({ page: 'signin' }, '', pageToPath('signin'))
        setPage('signin')
      }
    }
    const handleMaintenanceActive = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail
      setMaintenanceMessage(detail?.message || 'The system is under maintenance. Please check back later.')
    }

    const initialPage = pathToPage(window.location.pathname)
    if (initialPage === 'landing') setAuthLoading(false)
    else void restoreSession(initialPage)
    window.addEventListener('popstate', handlePopState)
    window.addEventListener('pageshow', handlePageShow)
    window.addEventListener('storage', handleStorage)
    window.addEventListener('auth:expired', handleSessionExpired)
    window.addEventListener('maintenance:active', handleMaintenanceActive)
    document.addEventListener('visibilitychange', handleVisibility)
    const handleOpenQr = () => setShowQrModal(true)
    window.addEventListener('cet:open-qr', handleOpenQr)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('pageshow', handlePageShow)
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('auth:expired', handleSessionExpired)
      window.removeEventListener('maintenance:active', handleMaintenanceActive)
      window.removeEventListener('cet:open-qr', handleOpenQr)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  const navigate = (target: Page | string) => {
    const resolvedTarget = (target === 'admin-dashboard' ? 'admin' : target) as Page
    if (resolvedTarget === 'landing') {
      if (session.get()) return
      if (page === 'landing') {
        document.getElementById('home')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
      sessionRestoreGenerationRef.current += 1
      setAuthLoading(false)
      setNavigatingTo(null)
      setSessionExpired(false)
      setSessionCheckError(null)
      window.history.pushState({ page: 'landing' }, '', pageToPath('landing'))
      setPage('landing')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
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
    setNavigatingTo(resolvedTarget)
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
    }).finally(() => setNavigatingTo(null))
  }

  const handleSignInSuccess = (user: AuthUser) => {
    sessionRestoreGenerationRef.current += 1
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
    setAuthLoading(false)
  }

  const signInView = (
    <>
    <SignIn
      sessionExpired={sessionExpired}
      sessionExpiredMessage={sessionExpiredMessage}
      onSuccess={handleSignInSuccess}
      onHome={() => navigate('landing')}
      sessionCheckError={sessionCheckError}
      sessionChecking={authLoading}
      onRetrySession={() => void restoreSession(pathToPage(window.location.pathname))}
    />
    <ThemeToggle />
    </>
  )

  if (maintenanceMessage !== null) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--color-surface)' }}>
        <div style={{ maxWidth: 520, textAlign: 'center', padding: 36, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16 }}>
          <h1>System Maintenance</h1>
          <p>{maintenanceMessage}</p>
          <button type="button" onClick={() => window.location.reload()}>Check again</button>
        </div>
      </div>
    )
  }
  if (showStartupAnimation) {
    return (
      <div className="startup-animation" role="status" aria-label="CET Nova is loading">
        <video
          src="/startup-animation.mp4"
          autoPlay
          muted
          playsInline
          aria-hidden="true"
          onEnded={() => setShowStartupAnimation(false)}
          onError={() => setShowStartupAnimation(false)}
        />
      </div>
    )
  }
  if (authLoading && page !== 'landing') return signInView
  if (navigatingTo) return <PageLoader target={navigatingTo} />
  const studentPages: Page[] = ['dashboard', 'mocktests', 'results', 'analytics', 'settings']
  return (
    <>
    {page !== 'landing' && page !== 'signin' && <ThemeToggle />}
    {studentPages.includes(page) && (
      <Sidebar activePage={page} onNavigate={navigate} />
    )}
    <Suspense fallback={<PageLoader target={page} />}>
      {page === 'signin' && signInView}
      {page === 'landing' && (
        <LandingPage
          onLogin={() => navigate('signin')}
          onStartPreparing={() => navigate('mocktests')}
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
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--color-surface)' }}>
          <div style={{ maxWidth: 420, textAlign: 'center', padding: 32, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16 }}>
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
    {showQrModal && (
      <Suspense fallback={null}>
        <MobileQRModal isOpen onClose={() => setShowQrModal(false)} />
      </Suspense>
    )}
    </>
  )
}
