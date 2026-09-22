import { useEffect, useState } from 'react'
import Sidebar, { type Page } from './Sidebar'
import UserAvatar from './UserAvatar'
import { session, testsAPI, type AuthUser, type TestResult } from '../lib/api'
import { shareTestReport } from '../lib/exportUtils'
import { generateResultAnalytics, type AIAnalyticsData } from '../lib/openrouter'

interface AnalysisProps {
  onNavigate?: (page: Page) => void
}

const Q_STATES = ['correct', 'correct', 'incorrect', 'correct', 'unattempted',
  'correct', 'correct', 'review', 'correct', 'correct']

function getQState(i: number) {
  return Q_STATES[i % Q_STATES.length]
}

export default function Analysis({ onNavigate }: AnalysisProps) {
  const [activeQ, setActiveQ] = useState<number | null>(null)
  const [result, setResult] = useState<TestResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [aiAnalytics, setAiAnalytics] = useState<AIAnalyticsData | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const user = session.get<AuthUser>()

  useEffect(() => {
    let mounted = true
    testsAPI.getMyResults()
      .then(results => {
        if (mounted) setResult(results[0] || null)
      })
      .catch(error => {
        if (mounted) setLoadError(error instanceof Error ? error.message : 'Unable to load your latest result.')
      })
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!result) return
    let mounted = true
    setAiLoading(true)
    setAiError(null)
    generateResultAnalytics({
      testId: result._id,
      examName: result.testName,
      score: Number(result.score || 0),
      maxScore: Number(result.totalMarks || 0),
      percentage: result.totalMarks ? (Number(result.score || 0) / Number(result.totalMarks)) * 100 : 0,
      timeTaken: `${Math.round(Number(result.duration || 0) / 60)}m`,
      correctAnswers: Number(result.correct || 0),
      wrongAnswers: Number(result.incorrect || 0),
      unansweredQuestions: Number(result.unanswered || 0),
      subjectWiseScores: result.subjectWiseScores || [],
    })
      .then(data => mounted && setAiAnalytics(data))
      .catch(error => mounted && setAiError(error instanceof Error ? error.message : 'AI analysis is unavailable.'))
      .finally(() => mounted && setAiLoading(false))
    return () => { mounted = false }
  }, [result])

  const score = Number(result?.score || 0)
  const maxScore = Number(result?.totalMarks || 0)
  const percentage = maxScore ? (score / maxScore) * 100 : 0
  const subjectScores = result?.subjectWiseScores || []
  const totalQuestions = Number(result?.totalQuestions || 0)
  const averageSeconds = totalQuestions && result?.duration ? Number(result.duration) / totalQuestions : 0
  const timeBars = Array.from({ length: 5 }, (_, index) => ({
    label: `Q${index * 20 + 1}–${index * 20 + 20}`,
    you: Math.min(100, Math.round((averageSeconds / 90) * 100)),
    ideal: 67,
  }))
  const criticalTopics = aiAnalytics?.weaknesses?.slice(0, 3).map((title, index) => ({
    icon: index === 1 ? 'timer' : 'trending_down',
    color: index === 0 ? 'red' : 'blue',
    title,
    lost: 'AI priority area',
  })) || []
  const formattedPercentile = result?.percentile ? Number(result.percentile).toFixed(1) : '—'

  const navItems = [
    { icon: 'dashboard',            label: 'Dashboard',  page: 'dashboard'  as Page },
    { icon: 'quiz',                 label: 'Mock Tests', page: 'mocktests'  as Page },
    { icon: 'analytics',            label: 'Analytics',  page: 'analytics'  as Page, active: true },
    { icon: 'bar_chart',            label: 'Result',     page: 'results'    as Page },
    { icon: 'assignment_turned_in', label: 'Results',    page: 'results'    as Page },
  ]

  return (
    <div className="an-root">

      {/* ── Top Nav ───────────────────────────── */}
      <nav className="an-topnav">
        <span className="an-topnav-brand">CET Prep Pro</span>
        <div className="an-topnav-right">
          <div className="an-search-wrap">
            <span className="material-symbols-outlined an-search-icon">search</span>
            <input className="an-search-input" placeholder="Search analytics..." type="text" />
          </div>
          <button className="an-icon-btn" title="Notifications"><span className="material-symbols-outlined">notifications</span></button>
          <button className="an-icon-btn" title="Settings" onClick={() => onNavigate?.('settings')}><span className="material-symbols-outlined">settings</span></button>
          <UserAvatar user={user} className="an-avatar" onClick={() => onNavigate?.('settings')} />
        </div>
      </nav>

      {/* ── Sidebar ───────────────────────────── */}
      <Sidebar activePage="analytics" onNavigate={onNavigate} />

      {/* ── Main ──────────────────────────────── */}
      <main className="an-main">
        <div className="an-content">

          {/* ── Hero Banner ─────────────────── */}
          <section className="an-hero">
            <div className="an-hero-blob" />
            <div className="an-hero-left">
              <h1 className="an-hero-title">{result?.testName || 'Your Test Analytics'}</h1>
              <p className="an-hero-meta">
                {result ? `Completed on ${new Date(result.attemptedAt).toLocaleDateString()} • ${Math.round(Number(result.duration || 0) / 60)} Minutes` : 'Complete a mock test to generate live analytics.'}
              </p>
              <div className="an-hero-stats">
                {[
                  { label: 'Your Score', value: String(score), suffix: `/${maxScore || 0}` },
                  { label: 'Percentile', value: formattedPercentile, suffix: result?.percentile ? '%ile' : '' },
                  { label: 'AI Score', value: aiLoading ? '...' : aiAnalytics?.aiScore !== undefined ? String(Math.round(aiAnalytics.aiScore)) : '—', suffix: aiAnalytics?.aiScore !== undefined ? '/100' : '' },
                ].map(s => (
                  <div key={s.label} className="an-hero-stat">
                    <span className="an-hero-stat-label">{s.label}</span>
                    <span className="an-hero-stat-value">
                      {s.value}<span className="an-hero-stat-suffix">{s.suffix}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="an-hero-actions">
              <button className="an-hero-btn an-hero-btn--glass" onClick={() => window.print()}>
                <span className="material-symbols-outlined">download</span> Download PDF
              </button>
              <button className="an-hero-btn an-hero-btn--white" onClick={() => shareTestReport(result?.testName || 'Analytics Report', score, maxScore, formattedPercentile)}>
                <span className="material-symbols-outlined">share</span> Share Report
              </button>
            </div>
          </section>

          {/* ── Bento Grid ──────────────────── */}
          <div className="an-grid">

            {/* Peer Comparison */}
            <div className="an-glass-card an-peer-card">
              <div className="an-card-header">
                <h2 className="an-card-title">You vs Subject Maximum</h2>
                <div className="an-legend">
                  <span className="an-legend-item"><span className="an-dot an-dot--blue" />You</span>
                  <span className="an-legend-item"><span className="an-dot an-dot--purple" />Maximum</span>
                </div>
              </div>
              <div className="an-subjects">
                {(subjectScores.length ? subjectScores.map(subject => ({
                  subj: subject.subject,
                  acc: `${Number(subject.percentage || 0).toFixed(0)}%`,
                  you: Number(subject.percentage || 0),
                  top: 100,
                  ys: `${subject.score}/${subject.maxScore}`,
                  ts: `${subject.maxScore}/${subject.maxScore}`,
                  yt: result?.duration ? `${Math.round(Number(result.duration) / 60)}m total` : '—',
                  tt: '—',
                })) : [{ subj: 'No completed test', acc: '—', you: 0, top: 0, ys: '—', ts: '—', yt: '—', tt: '—' }]).map(s => (
                  <div key={s.subj} className="an-subject-block">
                    <div className="an-subject-header">
                      <span className="an-subject-name">{s.subj}</span>
                      <span className="an-subject-acc">Subject Accuracy: {s.acc}</span>
                    </div>
                    <div className="an-subject-body">
                      <div className="an-bar-group">
                        <div className="an-dual-bar-track">
                          <div className="an-dual-bar an-dual-bar--top" style={{ width: `${s.top}%` }} />
                          <div className="an-dual-bar an-dual-bar--you" style={{ width: `${s.you}%` }} />
                        </div>
                        <div className="an-bar-labels">
                          <span className="an-bar-label--blue">{s.ys}</span>
                          <span className="an-bar-label--purple">{s.ts}</span>
                        </div>
                      </div>
                      <div className="an-time-cols">
                        <div className="an-time-col">
                          <span className="an-time-label">Your Time</span>
                          <span className="an-time-val an-time-val--blue">{s.yt}</span>
                        </div>
                        <div className="an-time-col">
                          <span className="an-time-label">Topper Time</span>
                          <span className="an-time-val an-time-val--purple">{s.tt}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* AI Insights */}
            <div className="an-glass-card an-ai-card">
              <div className="an-ai-header">
                <div className="an-ai-icon-wrap">
                  <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
                </div>
                <h2 className="an-card-title an-card-title--purple">AI Insights</h2>
              </div>
              <div className="an-ai-gap-card">
                <p className="an-ai-gap-title">{aiLoading ? 'Generating live diagnosis...' : aiError ? 'Analysis unavailable' : 'Latest diagnosis'}</p>
                <p className="an-ai-gap-body">
                  {aiError || aiAnalytics?.summaryDiagnosis || (result ? 'Your personalized analysis will appear here shortly.' : 'Complete a mock test to receive personalized AI insights.')}
                </p>
              </div>
              <p className="an-rec-label">Recommended Actions</p>
              <div className="an-recs">
                {(aiAnalytics?.actionPlan?.length ? aiAnalytics.actionPlan.map(item => `${item.subject}: ${item.action}`) : ['No recommendations yet.']).map((text, i) => (
                  <div key={i} className="an-rec-row">
                    <span className="an-rec-dot" />
                    <p className="an-rec-text">{text}</p>
                  </div>
                ))}
              </div>
              <button className="an-drill-btn" onClick={() => onNavigate?.('mocktests')}>Start Prep Drill</button>
            </div>

            {/* Question Grid */}
            <div className="an-glass-card an-qgrid-card">
              <div className="an-qgrid-header">
                <div>
                  <h2 className="an-card-title">Question-by-Question Analytics</h2>
                  <p className="an-card-sub">Click any box to view the detailed solution and topper's approach.</p>
                </div>
                <div className="an-qlegend">
                  {[
                    { cls: 'an-ql--correct',     label: 'Correct' },
                    { cls: 'an-ql--incorrect',   label: 'Incorrect' },
                    { cls: 'an-ql--unattempted', label: 'Unattempted' },
                    { cls: 'an-ql--review',      label: 'Review' },
                  ].map(l => (
                    <div key={l.label} className="an-ql-item">
                      <span className={`an-ql-box ${l.cls}`} />
                      <span>{l.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="an-qgrid">
                {Array.from({ length: 100 }, (_, i) => {
                  const state = getQState(i)
                  return (
                    <button
                      key={i}
                      className={`an-q-box an-q-box--${state}${activeQ === i ? ' an-q-box--active' : ''}`}
                      onClick={() => setActiveQ(activeQ === i ? null : i)}
                      title={`Q${i + 1}: ${state}`}
                    >
                      {i + 1}
                    </button>
                  )
                })}
              </div>
              {activeQ !== null && (
                <div className="an-q-detail">
                  <strong>Q{activeQ + 1}</strong> — Status: <em>{getQState(activeQ)}</em>
                  <button className="an-q-detail-close" onClick={() => setActiveQ(null)}>✕</button>
                </div>
              )}
            </div>

            {/* Time Management */}
            <div className="an-glass-card an-time-card">
              <h2 className="an-card-title">Time Management Breakdown</h2>
              <div className="an-time-chart">
                {timeBars.map(b => (
                  <div key={b.label} className="an-time-col-wrap">
                    <div className="an-time-bars">
                      <div className="an-time-bar an-time-bar--you"  style={{ height: `${b.you}%` }} />
                      <div className="an-time-bar an-time-bar--ideal" style={{ height: `${b.ideal}%` }} />
                    </div>
                    <span className="an-time-xlabel">{b.label}</span>
                  </div>
                ))}
              </div>
              <div className="an-time-legend">
                <span className="an-time-leg-item"><span className="an-dot an-dot--blue" />Your Time (Avg: {averageSeconds ? `${Math.round(averageSeconds)}s` : '—'})</span>
                <span className="an-time-leg-item"><span className="an-dot an-dot--purple-light" />Ideal Time (Avg: 60s)</span>
              </div>
            </div>

            {/* Critical Topics */}
            <div className="an-glass-card an-topics-card">
              <h2 className="an-card-title">Critical Topics</h2>
              <p className="an-card-sub" style={{ marginBottom: 20 }}>Top areas where marks were lost due to inaccuracy or time pressure.</p>
              <div className="an-topics-list">
                {(criticalTopics.length ? criticalTopics : [{ icon: 'info', color: 'blue', title: 'AI topics will appear after analysis', lost: 'Awaiting result data' }]).map((t, i) => (
                  <div key={i} className={`an-topic-row an-topic-row--${t.color}`}>
                    <div className="an-topic-left">
                      <div className={`an-topic-icon an-topic-icon--${t.color}`}>
                        <span className="material-symbols-outlined">{t.icon}</span>
                      </div>
                      <div>
                        <p className="an-topic-name">{t.title}</p>
                        <p className={`an-topic-lost an-topic-lost--${t.color}`}>{t.lost}</p>
                      </div>
                    </div>
                    <span className="material-symbols-outlined an-topic-chevron">chevron_right</span>
                  </div>
                ))}
              </div>
              <div className="an-concept-banner">
                <img
                  className="an-concept-img"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuA_vUhm-JIEivXaPMOy3GqyAK_IFoc0NCp7Dbzk77lG0egjlp4HQA1GEDcO0_PXELmR_pTF5cn9HC7lGcIR3tCEQFG2AYAjfakU3glW7JX7qYrROGhYy_Ah8hRELphWS-W3kqeXZqakFPpBJyBsowefLDSFJ9HrOHFlh04EDO8NASN0wbym59KviXXAOXAxyyw0nw0o_MYa8ql6-jWWUjqK4OxGBBMw4g1cv_HIMGeZplPXhf-aGYt_SRP7bhJ00HwDLgjcvDo6Nwo"
                  alt="Concept map background"
                />
                <div className="an-concept-overlay">
                  <p className="an-concept-title">View Concept Maps</p>
                  <p className="an-concept-sub">Visualize connections between these topics</p>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <footer className="an-footer">
            <p className="an-footer-text">{loading ? 'Loading your latest result...' : loadError || (aiLoading ? 'Generating live AI analysis...' : `Analysis refreshed ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`)}</p>
            <div className="an-footer-btns">
              <button className="an-footer-btn an-footer-btn--outline" onClick={() => onNavigate?.('results')}>Previous Test</button>
              <button className="an-footer-btn an-footer-btn--primary" onClick={() => onNavigate?.('mocktests')}>Next Suggested Goal</button>
            </div>
          </footer>

        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="an-mobile-nav">
        {[
          { icon: 'dashboard', label: 'Home',      page: 'dashboard' as Page },
          { icon: 'analytics', label: 'Analytics', page: 'analytics' as Page, active: true },
          { icon: 'quiz',      label: 'Tests',     page: 'mocktests' as Page },
          { icon: 'person',    label: 'Profile',   page: null },
        ].map(item => (
          <button key={item.label}
            className={`an-mob-item${item.active ? ' an-mob-item--active' : ''}`}
            onClick={() => item.page && onNavigate?.(item.page)}
          >
            <span className="material-symbols-outlined"
              style={item.active ? { fontVariationSettings: "'FILL' 1" } : {}}>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

    </div>
  )
}
