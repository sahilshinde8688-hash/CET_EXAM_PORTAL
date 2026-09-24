import { useState, useEffect, useMemo } from 'react'
import Sidebar from './Sidebar'
import TestInterface from './TestInterface'
import UserAvatar from './UserAvatar'
import { session, testsAPI, type AuthUser, type TestResult } from '../lib/api'

interface DashboardProps {
  onNavigate?: (page: 'signin' | 'dashboard' | 'mocktests' | 'results' | 'analytics' | 'settings' | 'admin-dashboard') => void
}

const navItems = [
  { icon: 'dashboard', label: 'Home', page: 'dashboard' },
  { icon: 'quiz', label: 'Tests', page: 'mocktests' },
  { icon: 'bar_chart', label: 'Results', page: 'results' },
  { icon: 'insights', label: 'Stats', page: 'analytics' },
  { icon: 'person', label: 'Profile', page: 'settings' },
]

const mobileNavItems = navItems

export default function Dashboard({ onNavigate }: DashboardProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [activeNav, setActiveNav] = useState('Home')
  const [showTest, setShowTest] = useState(false)
  const [inProgressTest, setInProgressTest] = useState<any>(null)
  const [testHistory, setTestHistory] = useState<TestResult[]>(() => testsAPI.getCachedDashboardResults() || [])
  const [dashboardLoading, setDashboardLoading] = useState(() => !testsAPI.getCachedDashboardResults())
  const [dashboardError, setDashboardError] = useState(false)
  const [showNotifs, setShowNotifs] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [unreadNotifs, setUnreadNotifs] = useState(3)
  const [shareToast, setShareToast] = useState(false)
  const user = session.get<AuthUser>()

  useEffect(() => {
    const inProgress = localStorage.getItem('cet_inProgressTest')
    if (inProgress) {
      try {
        setInProgressTest(JSON.parse(inProgress))
      } catch (e) {
        setInProgressTest(true)
      }
    }

    let cancelled = false
    const cachedResults = testsAPI.getCachedDashboardResults()
    if (cachedResults) setTestHistory(cachedResults)

    testsAPI.getDashboardResults(true).then(results => {
      if (cancelled) return
      setTestHistory(results.sort((a, b) => new Date(b.attemptedAt).getTime() - new Date(a.attemptedAt).getTime()))
      setDashboardError(false)
    }).catch(error => {
      if (!cancelled) {
        console.error('Failed to load dashboard data:', error)
        setDashboardError(true)
      }
    }).finally(() => {
      if (!cancelled) setDashboardLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const performance = useMemo(() => {
    const testsCount = testHistory.length
    const totalMarks = testHistory.reduce((sum, test) => sum + (test.totalMarks || 0), 0)
    return {
      testsCount,
      avgScore: testsCount ? Math.round(testHistory.reduce((sum, test) => sum + test.score, 0) / testsCount) : 0,
      avgPercentile: testsCount ? (testHistory.reduce((sum, test) => sum + (test.percentile || 0), 0) / testsCount).toFixed(1) : '0.0',
      studyHours: (testHistory.reduce((sum, test) => sum + (test.duration || 0), 0) / 3600).toFixed(1),
      highestScore: testsCount ? Math.max(...testHistory.map(test => test.score)) : 0,
      totalMarks: testsCount ? Math.round(totalMarks / testsCount) : 200,
    }
  }, [testHistory])
  const { testsCount, avgScore, avgPercentile } = performance
  const goalTarget = 10
  const goalProgress = Math.min(100, Math.round((testsCount / goalTarget) * 100))
  const attemptedDays = new Set(testHistory.map(t => new Date(t.attemptedAt).toDateString()))
  let studyStreak = 0
  const streakDate = new Date()
  if (!attemptedDays.has(streakDate.toDateString())) streakDate.setDate(streakDate.getDate() - 1)
  while (attemptedDays.has(streakDate.toDateString())) {
    studyStreak++
    streakDate.setDate(streakDate.getDate() - 1)
  }
  const firstName = user?.name?.split(' ')[0] || 'Student'
  const branchLabel = user?.branch ? `${user.branch}${user.batch ? `, Batch ${user.batch}` : ''}` : 'CET preparation'
  const nextGoal = testsCount >= goalTarget ? 'Goal complete' : `${goalTarget - testsCount} tests remaining`

  const dashboardStats = [
    { icon: 'checklist', color: 'blue', label: 'Tests Attempted', value: dashboardLoading ? 'Loading...' : testsCount.toString(), unit: '' },
    { icon: 'bolt', color: 'teal', label: 'Average Score', value: dashboardLoading ? 'Loading...' : avgScore.toString(), unit: dashboardLoading ? '' : ` / ${performance.totalMarks}` },
    { icon: 'history', color: 'purple', label: 'Study Hours', value: dashboardLoading ? 'Loading...' : performance.studyHours, unit: dashboardLoading ? '' : 'h' },
  ]

  const trendScores = testHistory.slice(0, 6).reverse()
  const displayBars = trendScores.map((t, i) => ({
    label: `T-${i+1}`,
    height: (t.score / (t.totalMarks || 200)) * 100,
    score: Math.round(t.score),
    active: i === trendScores.length - 1
  }))
  const chartBars = displayBars

  const displayRecentTests = testHistory.slice(0, 3).map((t, i) => {
    const date = new Date(t.attemptedAt)
    return {
      icon: t.subject?.includes('Math') ? 'calculate' : t.subject?.includes('Chem') ? 'science' : 'assignment_turned_in',
      title: t.testName || 'Mock Test',
      meta: `${date.toLocaleDateString()} • ${Math.round((t.duration || 0) / 60)}m Duration`,
      score: `${Math.round(t.score || 0)}/${t.totalMarks || 0}`,
      percentile: `${Number(t.percentile || 0).toFixed(1)}th Percentile`,
      highlight: i === 0,
    }
  })

  return (
    <>
      {showTest ? (
        <TestInterface
          onClose={() => setShowTest(false)}
          onBackRequest={() => setShowTest(false)}
          onResultSaved={(result) => {
            setInProgressTest(null)
            setTestHistory(current => [result, ...current.filter(item => item._id !== result._id)])
          }}
        />
      ) : (
        <div className="db-root">

      {/* ── Sidebar ──────────────────────────────── */}
      <Sidebar activePage="dashboard" onNavigate={onNavigate} onStartTest={() => setShowTest(true)} />

      {/* ── Main ─────────────────────────────────── */}
      <main className="db-main">

        {/* Top Bar */}
        <header className="db-topbar">
          <div className="db-topbar-left">
            <button className="db-mobile-menu-btn" onClick={() => setMobileNavOpen(!mobileNavOpen)}>
              <span className="material-symbols-outlined">menu</span>
            </button>
            <div className="db-search-wrap">
              <span className="material-symbols-outlined db-search-icon">search</span>
              <input className="db-search-input" placeholder="Search resources, tests..." type="text" />
            </div>
          </div>
          <div className="db-topbar-right">
            <div style={{ position: 'relative' }}>
              <button className="db-icon-btn db-notif-btn" onClick={() => { setShowNotifs(!showNotifs); setShowHelp(false) }}>
                <span className="material-symbols-outlined">notifications</span>
                {unreadNotifs > 0 && <span className="db-notif-dot" />}
              </button>
              {showNotifs && (
                <div className="db-popover" style={{ position: 'absolute', top: '48px', right: 0, width: '320px', background: '#fff', borderRadius: '12px', boxShadow: '0 10px 40px rgba(0,0,0,0.1)', zIndex: 100, border: '1px solid #e2e8f0', padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Notifications</h4>
                    {unreadNotifs > 0 && <button style={{ border: 'none', background: 'none', color: '#2563eb', fontSize: '12px', cursor: 'pointer', fontWeight: 500 }} onClick={() => setUnreadNotifs(0)}>Mark all read</button>}
                  </div>
                  {unreadNotifs > 0 ? (
                    <div style={{ display: 'grid', gap: '12px' }}>
                      <div style={{ fontSize: '13px', background: '#f8fafc', padding: '10px', borderRadius: '8px' }}><strong>System Update:</strong> MHT-CET 2026 pattern updated.</div>
                      <div style={{ fontSize: '13px', background: '#f8fafc', padding: '10px', borderRadius: '8px' }}><strong>New Test:</strong> Full Length Mock 4 is now available!</div>
                      <div style={{ fontSize: '13px', background: '#f8fafc', padding: '10px', borderRadius: '8px' }}><strong>Reminder:</strong> Finish your pending Physics section.</div>
                    </div>
                  ) : (
                    <p style={{ margin: 0, fontSize: '13px', color: '#64748b', textAlign: 'center', padding: '20px 0' }}>You're all caught up!</p>
                  )}
                </div>
              )}
            </div>
            
            <div style={{ position: 'relative' }}>
              <button className="db-icon-btn" onClick={() => { setShowHelp(!showHelp); setShowNotifs(false) }}>
                <span className="material-symbols-outlined">help</span>
              </button>
              {showHelp && (
                <div className="db-popover" style={{ position: 'absolute', top: '48px', right: 0, width: '280px', background: '#fff', borderRadius: '12px', boxShadow: '0 10px 40px rgba(0,0,0,0.1)', zIndex: 100, border: '1px solid #e2e8f0', padding: '16px' }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 600 }}>Need Help?</h4>
                  <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: '13px', color: '#334155', display: 'grid', gap: '8px' }}>
                    <li><a href="#" style={{ color: '#2563eb', textDecoration: 'none' }}>Take a Tour</a></li>
                    <li><a href="#" style={{ color: '#2563eb', textDecoration: 'none' }}>MHT-CET Guidelines</a></li>
                    <li><a href="#" style={{ color: '#2563eb', textDecoration: 'none' }}>Contact Support</a></li>
                  </ul>
                </div>
              )}
            </div>
            <div className="db-user-chip">
              <div className="db-user-info">
                <p className="db-user-name">{user?.name || 'Student'}</p>
                <p className="db-user-role">{branchLabel}</p>
              </div>
              <UserAvatar user={user} className="db-avatar" onClick={() => onNavigate?.('settings')} />
            </div>
          </div>
        </header>

        {/* Mobile overlay nav */}
        {mobileNavOpen && (
          <div className="db-mobile-overlay" onClick={() => setMobileNavOpen(false)}>
            <div className="db-mobile-nav" onClick={e => e.stopPropagation()}>
              {mobileNavItems.map(item => (
                <button key={item.label} type="button" className={`db-nav-item${activeNav === item.label ? ' db-nav-item--active' : ''}`}
                  onClick={() => { setActiveNav(item.label); setMobileNavOpen(false); onNavigate?.(item.page as any) }}>
                  <span className="material-symbols-outlined">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="db-content">

          {/* ── Welcome Banner ──────────────────── */}
          <section className="db-welcome">
            <div className="db-welcome-bg-circle db-welcome-bg-circle--1" />
            <div className="db-welcome-rocket">
              <span className="material-symbols-outlined db-rocket-icon">rocket_launch</span>
            </div>

            <div className="db-welcome-inner">
              <div className="db-welcome-text">
                <h1 className="db-welcome-title">Welcome back, {firstName}! 👋</h1>
                <p className="db-welcome-subtitle">
                  {testsCount > 0 ? 'Keep building your score with another focused practice test.' : 'Take your first mock test to set your baseline.'}
                </p>
                <div className="db-welcome-chips">
                  <div className="db-welcome-chip">
                    <span className="material-symbols-outlined db-chip-icon">timer</span>
                    <div>
                      <p className="db-chip-label">Study Streak</p>
                      <p className="db-chip-value">{dashboardLoading ? 'Loading...' : `${studyStreak} ${studyStreak === 1 ? 'Day' : 'Days'}`}</p>
                    </div>
                  </div>
                  <div className="db-welcome-chip">
                    <span className="material-symbols-outlined db-chip-icon">local_fire_department</span>
                    <div>
                      <p className="db-chip-label">Next Goal</p>
                      <p className="db-chip-value">{dashboardLoading ? 'Loading...' : nextGoal}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Circular Progress */}
              <div className="db-progress-ring-wrap">
                <svg className="db-progress-svg" viewBox="0 0 192 192">
                  <circle cx="96" cy="96" r="88" fill="transparent" stroke="rgba(255,255,255,0.15)" strokeWidth="12" />
                  <circle cx="96" cy="96" r="88" fill="transparent"
                    stroke="white" strokeWidth="12"
                    strokeDasharray="553" strokeDashoffset={dashboardLoading ? 553 : 553 - (553 * goalProgress) / 100}
                    strokeLinecap="round"
                    style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}
                  />
                </svg>
                <div className="db-progress-label">
                  <span className="db-progress-pct">{dashboardLoading ? '...' : `${goalProgress}%`}</span>
                  <span className="db-progress-text">Goal Progress</span>
                </div>
              </div>
            </div>
          </section>

          {/* ── Bento Row: Resume + Percentile ─── */}
          <div className="db-bento-row">

            {/* Resume Card */}
            {inProgressTest && (
              <div className="db-glass-card db-resume-card">
                <div className="db-resume-info">
                  <span className="db-in-progress-badge">In Progress</span>
                  <h3 className="db-resume-title">{inProgressTest.title || 'MHT-CET Full Length Mock'}</h3>
                  <p className="db-resume-sub">{inProgressTest.message || 'Section remaining. Resume to complete your test.'}</p>
                  <div className="db-resume-actions">
                    <button className="db-resume-btn" onClick={() => setShowTest(true)}>Resume Now</button>
                    <button className="db-share-btn" onClick={() => {
                      navigator.clipboard.writeText(window.location.href);
                      setShareToast(true);
                      setTimeout(() => setShareToast(false), 2000);
                    }}>
                      <span className="material-symbols-outlined">share</span>
                    </button>
                    {shareToast && <span style={{ position: 'absolute', bottom: '-28px', right: 0, background: '#1e293b', color: '#fff', fontSize: '11px', padding: '4px 8px', borderRadius: '4px', whiteSpace: 'nowrap' }}>Link Copied!</span>}
                  </div>
                </div>
                <div className="db-resume-icon-wrap">
                  <span className="material-symbols-outlined db-resume-icon">play_circle</span>
                </div>
              </div>
            )}

            {/* Percentile Card */}
            <div className="db-glass-card db-percentile-card">
              <p className="db-percentile-label">Average Percentile</p>
              <div className="db-percentile-num">{dashboardLoading ? '...' : avgPercentile}</div>
              <div className="db-percentile-trend">
                <span className="material-symbols-outlined">trending_flat</span>
                <span>{dashboardLoading ? 'Loading performance data...' : testsCount > 0 ? 'Based on recent tests' : 'No data yet'}</span>
              </div>
              <div className="db-percentile-bar-bg">
                <div className="db-percentile-bar-fill" style={{ width: `${dashboardLoading ? 0 : testsCount > 0 ? avgPercentile : 0}%` }} />
              </div>
            </div>
          </div>

          {/* ── Stats + Chart + List ─────────────── */}
          <div className="db-lower-grid">

            {/* Quick Stats */}
            <div className="db-stats-col">
              {dashboardStats.map(s => (
                <div key={s.label} className="db-glass-card db-stat-card">
                  <div className={`db-stat-icon-wrap db-stat-icon-wrap--${s.color}`}>
                    <span className="material-symbols-outlined">{s.icon}</span>
                  </div>
                  <div>
                    <p className="db-stat-label">{s.label}</p>
                    <p className="db-stat-value">
                      {s.value}
                      {s.unit && <span className="db-stat-unit"> {s.unit}</span>}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Performance Chart */}
            <div className="db-glass-card db-chart-card">
              <div className="db-chart-header">
                <div>
                  <h4 className="db-chart-title">Performance Trends</h4>
                  <p className="db-chart-sub">Based on the last 6 mock tests</p>
                </div>
                <select className="db-chart-select">
                  <option>All Subjects</option>
                  <option>Physics</option>
                  <option>Chemistry</option>
                  <option>Mathematics</option>
                  <option>Biology</option>
                </select>
              </div>
              <div className="db-chart-bars">
                {dashboardLoading ? <p className="db-chart-empty">Loading performance trend...</p> : chartBars.length > 0 ? chartBars.map(b => (
                  <div key={b.label} className="db-bar-wrap">
                    <div
                      className={`db-bar${b.active ? ' db-bar--active' : ''}`}
                      style={{ height: `${b.height}%` }}
                    >
                      <div className="db-bar-tooltip">{b.score}</div>
                    </div>
                  </div>
                )) : <p className="db-chart-empty">Complete a mock test to see your performance trend.</p>}
              </div>
              {chartBars.length > 0 && <div className="db-chart-labels">
                {chartBars.map(b => <span key={b.label}>{b.label}</span>)}
              </div>}
            </div>
          </div>

          {/* ── Recent Mock Results ──────────────── */}
          {displayRecentTests.length > 0 && (
            <section className="db-glass-card db-results-card">
              <div className="db-results-header">
                <h4 className="db-results-title">Recent Mock Results</h4>
                <button type="button" className="db-results-link" onClick={() => onNavigate?.('results')}>View All Tests</button>
              </div>
              <div className="db-results-list">
                {displayRecentTests.map((t, i) => (
                  <div key={i} className="db-result-row">
                    <div className="db-result-left">
                      <div className="db-result-icon-wrap">
                        <span className="material-symbols-outlined">{t.icon}</span>
                      </div>
                      <div>
                        <h5 className="db-result-name">{t.title}</h5>
                        <p className="db-result-meta">{t.meta}</p>
                      </div>
                    </div>
                    <div className="db-result-right">
                      <div className="db-result-score-wrap">
                        <p className={`db-result-score${t.highlight ? ' db-result-score--blue' : ''}`}>{t.score}</p>
                        <p className={`db-result-percentile${t.highlight ? ' db-result-percentile--green' : ''}`}>{t.percentile}</p>
                      </div>
                      <button className="db-result-chevron" onClick={() => onNavigate?.('results')}>
                        <span className="material-symbols-outlined">chevron_right</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {dashboardError && <div className="db-dashboard-error">Performance data could not be refreshed. Cached or empty values are shown. <button type="button" onClick={() => window.location.reload()}>Retry</button></div>}
          <div className="db-mobile-spacer" />
        </div>
      </main>

      {/* ── Mobile Bottom Nav ────────────────────── */}
      <nav className="db-mobile-nav-bar">
        {mobileNavItems.map(item => (
          <button key={item.label} type="button"
            className={`db-mobile-nav-item${activeNav === item.label ? ' db-mobile-nav-item--active' : ''}`}
            onClick={() => {
              setActiveNav(item.label);
              if (item.page && onNavigate) onNavigate(item.page as any)
            }}
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
      )}
    </>
  )
}
