import { useState, useEffect, useMemo } from 'react'
import Sidebar, { type Page } from './Sidebar'
import { session, testsAPI, type AuthUser, type TestResult } from '../lib/api'
import { downloadTestHistoryCSV, downloadSingleTestReport } from '../lib/exportUtils'
import TestInterface from './TestInterface'
import UserAvatar from './UserAvatar'

interface ResultsProps {
  onNavigate?: (page: Page) => void
}

const toSafeNumber = (value: number | string | null | undefined, fallback = 0): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const getPercentileColor = (percentile: number): string => {
  if (percentile >= 99) return 'green'
  if (percentile >= 90) return 'blue'
  if (percentile >= 75) return 'teal'
  return 'orange'
}

export default function Results({ onNavigate }: ResultsProps) {
  const [testHistory, setTestHistory] = useState<TestResult[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewingTest, setReviewingTest] = useState<TestResult | null>(null)
  const [displayLimit, setDisplayLimit] = useState(10)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedSubjectFilter, setSelectedSubjectFilter] = useState('All')
  const [showFilterDropdown, setShowFilterDropdown] = useState(false)
  const user = session.get<AuthUser>()
  const branchLabel = user?.branch ? `${user.branch}${user.batch ? `, Batch ${user.batch}` : ''}` : 'CET preparation'

  const loadResults = async () => {
    try {
      const results = await testsAPI.getMyResults()
      const sortedResults = results.sort((a, b) => new Date(b.attemptedAt).getTime() - new Date(a.attemptedAt).getTime())
      setTestHistory(sortedResults)
      setDisplayLimit(sortedResults.length)
    } catch (error) {
      console.error('Failed to load test results:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadResults()

    const refreshResults = () => {
      if (document.visibilityState === 'visible') loadResults()
    }
    window.addEventListener('focus', refreshResults)
    document.addEventListener('visibilitychange', refreshResults)
    return () => {
      window.removeEventListener('focus', refreshResults)
      document.removeEventListener('visibilitychange', refreshResults)
    }
  }, [])

  const testsCount = testHistory.length
  const avgScore = testsCount > 0
    ? Math.round(testHistory.reduce((acc, t) => acc + toSafeNumber(t.score), 0) / testsCount).toString()
    : '0'
  const highestScore = testsCount > 0
    ? Math.round(Math.max(...testHistory.map(t => toSafeNumber(t.score)))).toString()
    : '0'
  const avgPercentile = testsCount > 0
    ? (testHistory.reduce((acc, t) => acc + toSafeNumber(t.percentile), 0) / testsCount).toFixed(1)
    : '0.0'

  const getSubjectMastery = (subject: string) => {
    let totalPercent = 0
    let testCount = 0

    testHistory.forEach(t => {
      const safeScore = toSafeNumber(t.score)
      const safeTotalMarks = toSafeNumber(t.totalMarks, 100)

      if (t.subjectWiseScores && t.subjectWiseScores.length > 0) {
        const subjScore = t.subjectWiseScores.find(s => (s.subject || '').toLowerCase().includes(subject.toLowerCase()))
        if (subjScore) {
          totalPercent += toSafeNumber(subjScore.percentage)
          testCount++
        }
      } else if (t.subject?.toLowerCase().includes(subject.toLowerCase())) {
        totalPercent += safeTotalMarks > 0 ? (safeScore / safeTotalMarks) * 100 : 0
        testCount++
      } else if (t.subject?.toLowerCase() === 'mock test' || t.testName?.toLowerCase().includes('mock')) {
        totalPercent += safeTotalMarks > 0 ? (safeScore / safeTotalMarks) * 100 : 0
        testCount++
      }
    })

    if (testCount === 0) return 0
    return Math.round(totalPercent / testCount)
  }

  const mathPct = getSubjectMastery('math')
  const phyPct = getSubjectMastery('physic')
  const chemPct = getSubjectMastery('chemist')

  const trendScores = testHistory.slice(0, 10).reverse().map(t => {
    const safeScore = toSafeNumber(t.score)
    const safeTotalMarks = toSafeNumber(t.totalMarks, 100)
    return safeTotalMarks > 0 ? (safeScore / safeTotalMarks) * 100 : 0
  })
  const displayScoreBars = trendScores.length > 0 ? trendScores : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

  const displayedTests = useMemo(() => {
    return testHistory.filter(t => {
      const q = searchTerm.trim().toLowerCase()
      const matchesSearch = !q || 
        (t.testName || '').toLowerCase().includes(q) || 
        (t.subject || '').toLowerCase().includes(q)
      const matchesSubject = selectedSubjectFilter === 'All' || 
        (t.subject || '').toLowerCase().includes(selectedSubjectFilter.toLowerCase()) ||
        (selectedSubjectFilter === 'Full Mock' && (t.testName || '').toLowerCase().includes('mock'))
      return matchesSearch && matchesSubject
    })
  }, [testHistory, searchTerm, selectedSubjectFilter])

  if (loading) {
    return (
      <div className="rs-root">
        <Sidebar activePage="results" onNavigate={onNavigate} />
        <main className="rs-main">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
            <p style={{ fontSize: '16px', color: '#64748b' }}>Loading test results...</p>
          </div>
        </main>
      </div>
    )
  }

  if (reviewingTest) {
    return (
      <TestInterface 
        onClose={() => setReviewingTest(null)} 
        examName={reviewingTest.testName || 'MHT-CET Mock Test'}
        reviewMode={true} 
        pastAnswers={reviewingTest.answers || {}} 
        pastResultData={{
          score: reviewingTest.score,
          maxScore: reviewingTest.totalMarks,
          duration: reviewingTest.duration || 0,
          total: reviewingTest.totalQuestions || 100,
          answered: (reviewingTest.correct || 0) + (reviewingTest.incorrect || 0),
          notAnswered: reviewingTest.unanswered || 0,
          marked: 0,
          correct: reviewingTest.correct || 0,
          incorrect: reviewingTest.incorrect || 0
        }} 
      />
    )
  }

  return (
    <div className="rs-root">

      {/* ── Sidebar ─────────────────────────────── */}
      <Sidebar activePage="results" onNavigate={onNavigate} />

      {/* ── Main ────────────────────────────────── */}
      <main className="rs-main">

        {/* Topbar */}
        <header className="rs-topbar">
          <div className="rs-topbar-left">
            <h2 className="rs-topbar-title">Test Results</h2>
            <div className="rs-search-wrap">
              <span className="material-symbols-outlined rs-search-icon">search</span>
              <input 
                className="rs-search-input" 
                placeholder="Search test name or subject..." 
                type="text" 
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button 
                  onClick={() => setSearchTerm('')} 
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center', padding: '0 4px' }}
                  title="Clear search"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
                </button>
              )}
            </div>
          </div>
          <div className="rs-topbar-right">
            <div style={{ position: 'relative' }}>
              <button 
                className="rs-filter-btn" 
                onClick={() => setShowFilterDropdown(prev => !prev)}
                style={selectedSubjectFilter !== 'All' ? { background: '#eff6ff', borderColor: '#3b82f6', color: '#1d4ed8', fontWeight: 600 } : {}}
              >
                <span className="material-symbols-outlined">filter_list</span>
                <span>{selectedSubjectFilter === 'All' ? 'Test Type' : selectedSubjectFilter}</span>
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>expand_more</span>
              </button>
              {showFilterDropdown && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: '6px',
                  background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px',
                  boxShadow: '0 10px 25px -5px rgba(0,0,0,0.15)', zIndex: 100, minWidth: '160px',
                  overflow: 'hidden'
                }}>
                  {['All', 'Full Mock', 'Mathematics', 'Physics', 'Chemistry', 'Biology'].map(type => (
                    <button
                      key={type}
                      onClick={() => { setSelectedSubjectFilter(type); setShowFilterDropdown(false) }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px',
                        border: 'none', background: selectedSubjectFilter === type ? '#eff6ff' : 'transparent',
                        color: selectedSubjectFilter === type ? '#2563eb' : '#334155',
                        fontWeight: selectedSubjectFilter === type ? 700 : 500,
                        cursor: 'pointer', fontSize: '13px'
                      }}
                    >
                      {type === 'All' ? 'All Subjects' : type}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button 
              className="rs-filter-btn" 
              title="Download Full Test History (CSV)"
              onClick={() => downloadTestHistoryCSV(displayedTests, user?.name)}
            >
              <span className="material-symbols-outlined">download</span>
              <span>Export CSV</span>
            </button>
            <div className="rs-divider" />
            <div className="rs-user-chip">
              <div className="rs-user-info">
                <p className="rs-user-name">{user?.name || 'Student'}</p>
                <p className="rs-user-roll">{branchLabel}</p>
              </div>
              <UserAvatar user={user} className="rs-avatar" onClick={() => onNavigate?.('settings')} />
            </div>
          </div>
        </header>

        <div className="rs-content">

          {/* ── Summary Banner ─────────────────── */}
          <section className="rs-summary-banner">
            <div className="rs-banner-blob rs-banner-blob--1" />
            <div className="rs-banner-blob rs-banner-blob--2" />
            <div className="rs-banner-inner">
              <div className="rs-banner-left">
                <p className="rs-banner-eyebrow">Cumulative Overview</p>
                <h3 className="rs-banner-heading">Performance Milestone</h3>
                <div className="rs-banner-badges">
                  {testsCount > 0 ? (
                    <>
                      <span className="rs-badge rs-badge--blue">TOP {((100 - parseFloat(avgPercentile)) || 0.1).toFixed(1)}% STATEWIDE</span>
                      {testsCount > 5 && <span className="rs-badge rs-badge--purple">CONSISTENCY STAR</span>}
                    </>
                  ) : (
                    <span className="rs-badge rs-badge--dark">TAKE A TEST TO EARN BADGES</span>
                  )}
                </div>
              </div>
              <div className="rs-banner-stats">
                {[
                  { label: 'Avg Score', value: avgScore, suffix: '/200', color: 'blue' },
                  { label: 'Highest',   value: highestScore, suffix: '/200', color: 'purple' },
                  { label: 'Tests',     value: testsCount.toString(),  suffix: '',     color: 'dark' },
                  { label: 'Percentile',value: avgPercentile,suffix: '',     color: 'teal' },
                ].map(s => (
                  <div key={s.label} className="rs-stat-item">
                    <p className="rs-stat-label">{s.label}</p>
                    <p className={`rs-stat-value rs-stat-value--${s.color}`}>
                      {s.value}<span className="rs-stat-suffix">{s.suffix}</span>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── Lower Grid ─────────────────────── */}
          <div className="rs-lower-grid">

            {/* Left col */}
            <div className="rs-left-col">

              {/* Subject Mastery */}
              <div className="rs-card">
                <div className="rs-card-header">
                  <h4 className="rs-card-title">Subject Mastery</h4>
                  <span className="material-symbols-outlined rs-card-icon-accent">analytics</span>
                </div>
                <div className="rs-subjects">
                  {[
                    { label: 'Mathematics', pct: mathPct, note: testsCount > 0 ? 'Calculated from past tests' : 'Not enough data', color: 'blue' },
                    { label: 'Physics',     pct: phyPct, note: testsCount > 0 ? 'Calculated from past tests' : 'Not enough data', color: 'purple' },
                    { label: 'Chemistry',   pct: chemPct, note: testsCount > 0 ? 'Calculated from past tests' : 'Not enough data', color: 'teal' },
                  ].map(s => (
                    <div key={s.label} className="rs-subject-row">
                      <div className="rs-subject-top">
                        <span className="rs-subject-name">{s.label}</span>
                        <span className={`rs-subject-pct rs-subject-pct--${s.color}`}>{s.pct}%</span>
                      </div>
                      <div className="rs-bar-track">
                        <div className={`rs-bar-fill rs-bar-fill--${s.color}`} style={{ width: `${s.pct}%` }} />
                      </div>
                      <p className="rs-subject-note">{s.note}</p>
                    </div>
                  ))}
                </div>
                <button className="rs-deep-btn" onClick={() => onNavigate?.('analytics')}>Deep Dive Analysis</button>
              </div>

              {/* Score Trend */}
              <div className="rs-card rs-trend-card">
                <div className="rs-card-header">
                  <div>
                    <h4 className="rs-card-title">Score Trend</h4>
                    <p className="rs-card-sub">Last 10 Attempted Tests</p>
                  </div>
                </div>
                <div className="rs-trend-bars">
                  {displayScoreBars.map((h, i) => (
                    <div key={i} className={`rs-trend-bar${i === displayScoreBars.length - 1 ? ' rs-trend-bar--active' : ''}`}
                      style={{ height: `${h}%` }} />
                  ))}
                </div>
                <div className="rs-trend-labels">
                  <span>{testsCount > 0 ? 'Earliest' : 'N/A'}</span><span>{testsCount > 0 ? 'Latest' : 'N/A'}</span>
                </div>
              </div>
            </div>

            {/* Right col: Table */}
            <div className="rs-right-col">
              <div className="rs-table-card">
                <div className="rs-table-header">
                  <div>
                    <h4 className="rs-card-title">Detailed Test History</h4>
                    <p className="rs-card-sub">Manage and review all your mock attempts</p>
                  </div>
                  <div className="rs-table-actions">
                    <button 
                      className="rs-icon-action" 
                      title="Download Test History (CSV)"
                      onClick={() => downloadTestHistoryCSV(displayedTests, user?.name)}
                    >
                      <span className="material-symbols-outlined">download</span>
                    </button>
                    <button 
                      className="rs-icon-action" 
                      title="Print Results Report"
                      onClick={() => window.print()}
                    >
                      <span className="material-symbols-outlined">print</span>
                    </button>
                  </div>
                </div>

                <div className="rs-table-wrap">
                  <table className="rs-table">
                    <thead>
                      <tr className="rs-thead-row">
                        <th className="rs-th">Test Name</th>
                        <th className="rs-th">Date &amp; Time</th>
                        <th className="rs-th">Score</th>
                        <th className="rs-th">Percentile</th>
                        <th className="rs-th">Status</th>
                        <th className="rs-th rs-th--right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedTests.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', padding: '36px 16px', color: '#64748b' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '36px', color: '#94a3b8', display: 'block', marginBottom: '8px' }}>
                              search_off
                            </span>
                            No test results match your search or filter criteria.
                          </td>
                        </tr>
                      ) : (
                        displayedTests.slice(0, displayLimit).map((row, i) => {
                          const date = new Date(row.attemptedAt)
                          const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                          const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                          const safeScore = toSafeNumber(row.score)
                          const safeTotalMarks = toSafeNumber(row.totalMarks, 100)
                          const safePercentile = toSafeNumber(row.percentile)
                          const percentileColor = getPercentileColor(safePercentile)

                          return (
                            <tr 
                              key={row._id || i} 
                              className="rs-tbody-row" 
                              style={{ cursor: 'pointer' }}
                              onClick={() => setReviewingTest(row)}
                            >
                              <td className="rs-td">
                                <p className="rs-td-name">{row.testName}</p>
                                <p className="rs-td-sub">{row.subject}</p>
                              </td>
                              <td className="rs-td">
                                <p className="rs-td-date">{dateStr}</p>
                                <p className="rs-td-sub">{timeStr}</p>
                              </td>
                              <td className="rs-td">
                                <span className="rs-score">{safeScore.toFixed(0)}</span>
                                <span className="rs-score-total">/{safeTotalMarks.toFixed(0)}</span>
                              </td>
                              <td className="rs-td">
                                <span className={`rs-percentile-badge rs-percentile-badge--${percentileColor}`}>
                                  {safePercentile.toFixed(1)}th
                                </span>
                              </td>
                              <td className="rs-td">
                                <div className="rs-status">
                                  <span className="rs-status-dot" />
                                  Completed
                                </div>
                              </td>
                              <td className="rs-td rs-td--right" onClick={(e) => e.stopPropagation()}>
                                <div className="rs-row-actions">
                                  <button className="rs-row-btn rs-row-btn--view" title="View Full Analysis" onClick={() => setReviewingTest(row)}>
                                    <span className="material-symbols-outlined">visibility</span>
                                  </button>
                                  <button 
                                    className="rs-row-btn rs-row-btn--pdf" 
                                    title="Download Official Scorecard"
                                    onClick={() => downloadSingleTestReport({
                                      ...row,
                                      candidateName: user?.name,
                                      rollNumber: user?.mhcetId
                                    })}
                                  >
                                    <span className="material-symbols-outlined">picture_as_pdf</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {displayedTests.length > displayLimit && (
                  <div className="rs-load-more">
                    <button className="rs-load-btn" onClick={() => setDisplayLimit(displayedTests.length)}>
                      <span>Load All Tests ({displayedTests.length})</span>
                      <span className="material-symbols-outlined">expand_more</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <footer className="rs-footer">
            <div className="rs-footer-inner">
              <div>
                <h5 className="rs-footer-brand">MHT-CET Elite</h5>
                <p className="rs-footer-copy">© 2026 MHT-CET Elite Preparation Portal. All rights reserved.</p>
              </div>
              <div className="rs-footer-links">
                {['Privacy Policy', 'Terms of Service', 'Contact Support'].map(l => (
                  <a key={l} href="#" className="rs-footer-link" onClick={e => e.preventDefault()}>{l}</a>
                ))}
              </div>
            </div>
          </footer>

        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="rs-mobile-nav">
        <a href="#" className="rs-mob-item" onClick={e => { e.preventDefault(); onNavigate?.('dashboard') }}>
          <span className="material-symbols-outlined">dashboard</span><span>Home</span>
        </a>
        <a href="#" className="rs-mob-item" onClick={e => { e.preventDefault(); onNavigate?.('mocktests') }}>
          <span className="material-symbols-outlined">quiz</span><span>Tests</span>
        </a>
        <div className="rs-mob-fab-wrap">
          <button className="rs-mob-fab" onClick={() => onNavigate?.('mocktests')}><span className="material-symbols-outlined">add</span></button>
        </div>
        <a href="#" className="rs-mob-item rs-mob-item--active" onClick={e => e.preventDefault()}>
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>history</span>
          <span>Results</span>
        </a>
        <a href="#" className="rs-mob-item" onClick={e => { e.preventDefault(); onNavigate?.('settings') }}>
          <span className="material-symbols-outlined">person</span><span>Profile</span>
        </a>
      </nav>
    </div>
  )
}
