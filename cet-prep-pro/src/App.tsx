import { lazy, Suspense, useEffect, useState } from 'react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import SignIn from './components/SignIn'
import { clearAdminCredentials, isAdminCredentials } from './adminAuth'
import { session } from './lib/api'
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
  const [page, setPage] = useState<Page>('signin')
  const [transitioning, setTransitioning] = useState(false)
  const [nextPage, setNextPage] = useState<Page | null>(null)
  const [adminLoggedIn, setAdminLoggedIn] = useState(false)

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
    }, 250)
    return () => clearTimeout(t)
  }, [transitioning, nextPage])

  if (transitioning && nextPage) return <PageLoader target={nextPage} />
  return (
    <>
      <Suspense fallback={<PageLoader target={page} />}>
        {page === 'signin' && (
          <SignIn
            onSuccess={() => navigate('dashboard')}
            onAdminLogin={() => {
              setAdminLoggedIn(true)
              navigate('admin')
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
              setAdminLoggedIn(false)
              navigate('signin')
            }}
          />
        )}
        {page === 'dashboard' && <Dashboard onNavigate={navigate} />}
      </Suspense>
      <SpeedInsights />
    </>
  )
}
