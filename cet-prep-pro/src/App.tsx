import { useState, useEffect } from 'react'
import SignIn from './components/SignIn'
import Dashboard from './components/Dashboard'
import MockTests from './components/MockTests'
import Results from './components/Results'
import Analysis from './components/Analysis'
import Settings from './components/Settings'
import AdminPanel from './components/AdminPanel'
import AdminDashboard from './components/AdminDashboard'
import { clearAdminCredentials, isAdminCredentials } from './adminAuth'
import { session } from './lib/api'
import './dashboard.css'
import './mocktests.css'
import './results.css'
import './analysis.css'
import './settings.css'

export type Page = 'signin' | 'dashboard' | 'mocktests' | 'results' | 'analytics' | 'settings' | 'admin'

  const PAGE_ICONS: Record<string, string> = {
  dashboard: 'dashboard',
  mocktests: 'quiz',
  results:   'history',
  analytics: 'analytics',
  settings:  'settings',
}
const PAGE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  mocktests: 'Mock Tests',
  results:   'Results',
  analytics: 'Analytics',
  settings:  'Settings',
}

/* ── Initial boot loader — freezes the screen ── */
function BootLoader() {
  return (
    <div className="boot-overlay">
      <div className="boot-inner">
        {/* Logo mark */}
        <div className="boot-logo-wrap">
          <div className="boot-logo-circle">
            <span className="material-symbols-outlined boot-logo-icon">school</span>
          </div>
          <div className="boot-logo-pulse" />
        </div>

        {/* Brand name */}
        <h1 className="boot-brand">CET Prep Pro</h1>
        <p className="boot-tagline">Elevate your future with precision learning</p>

        {/* Animated bar */}
        <div className="boot-bar-track">
          <div className="boot-bar-fill" />
        </div>

        <p className="boot-status">Initializing portal…</p>
      </div>
    </div>
  )
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
  const [booting, setBooting] = useState(true)
  const [page, setPage] = useState<Page>('signin')
  const [transitioning, setTransitioning] = useState(false)
  const [nextPage, setNextPage] = useState<Page | null>(null)
  const [adminLoggedIn, setAdminLoggedIn] = useState(false)

  /* Boot loader runs once on first load — 2.4s */
  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 2400)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const currentUser = session.get()
    if (page === 'admin' && (!currentUser || currentUser.role !== 'admin')) {
      clearAdminCredentials()
      setAdminLoggedIn(false)
      setPage('signin')
    }
  }, [page])

  const navigate = (target: Page | string) => {
    const resolvedTarget = (target === 'admin-dashboard' ? 'admin' : target) as Page
    if (resolvedTarget === page) return
    setNextPage(resolvedTarget)
    setTransitioning(true)
  }

  useEffect(() => {
    if (!transitioning || !nextPage) return
    const t = setTimeout(() => {
      setPage(nextPage)
      setNextPage(null)
      setTransitioning(false)
    }, 950)
    return () => clearTimeout(t)
  }, [transitioning, nextPage])

  /* Boot: render page behind the overlay so it's ready instantly after */
  if (booting) return <BootLoader />

  if (transitioning && nextPage) return <PageLoader target={nextPage} />
  if (page === 'signin') {
    return (
      <SignIn
        onSuccess={() => navigate('dashboard')}
        onAdminLogin={() => {
          setAdminLoggedIn(true)
          navigate('admin')
        }}
      />
    )
  }
  if (page === 'mocktests') return <MockTests onNavigate={navigate} />
  if (page === 'results')   return <Results onNavigate={navigate} />
  if (page === 'analytics') return <Analysis onNavigate={navigate} />
  if (page === 'settings')  return <Settings onNavigate={navigate} />
  if (page === 'admin') {
    return (
      <AdminDashboard
        onNavigate={navigate}
        onLogout={() => {
          clearAdminCredentials()
          setAdminLoggedIn(false)
          navigate('signin')
        }}
      />
    )
  }
  return <Dashboard onNavigate={navigate} />
}
