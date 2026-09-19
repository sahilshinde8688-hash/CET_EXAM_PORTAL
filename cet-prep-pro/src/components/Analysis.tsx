import { useState } from 'react'
import Sidebar, { type Page } from './Sidebar'
import UserAvatar from './UserAvatar'
import { session, type AuthUser } from '../lib/api'
import { shareTestReport } from '../lib/exportUtils'

interface AnalysisProps {
  onNavigate?: (page: Page) => void
}

const Q_STATES = ['correct', 'correct', 'incorrect', 'correct', 'unattempted',
  'correct', 'correct', 'review', 'correct', 'correct']

function getQState(i: number) {
  return Q_STATES[i % Q_STATES.length]
}

// Check if running in production mode
const isProductionMode = import.meta.env.VITE_PRODUCTION_MODE === 'true'

// Reset all data to zero in production mode
const timeBars = isProductionMode ? [
  { label: 'Q1–20',   you: 0, ideal: 0 },
  { label: 'Q21–40',  you: 0, ideal: 0 },
  { label: 'Q41–60',  you: 0, ideal: 0 },
  { label: 'Q61–80',  you: 0, ideal: 0 },
  { label: 'Q81–100', you: 0, ideal: 0 },
] : [
  { label: 'Q1–20',   you: 40, ideal: 35 },
  { label: 'Q21–40',  you: 85, ideal: 50 },
  { label: 'Q41–60',  you: 60, ideal: 55 },
  { label: 'Q61–80',  you: 95, ideal: 45 },
  { label: 'Q81–100', you: 30, ideal: 40 },
]

const criticalTopics = isProductionMode ? [
  { icon: 'trending_down', color: 'red',   title: 'No data available',          lost: '0 Marks Lost' },
] : [
  { icon: 'trending_down', color: 'red',   title: 'Integration – Calculus',          lost: '-12 Marks Lost' },
  { icon: 'timer',         color: 'red',   title: 'Organic Chemistry – Alkanes',      lost: '-8 Marks Lost' },
  { icon: 'psychology',    color: 'blue',  title: 'Wave Optics',                      lost: '-4 Marks Lost' },
]

export default function Analysis({ onNavigate }: AnalysisProps) {
  const [activeQ, setActiveQ] = useState<number | null>(null)
  const user = session.get<AuthUser>()

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
              <h1 className="an-hero-title">Full Length Mock Test #12</h1>
              <p className="an-hero-meta">Completed on Oct 24, 2023 • 3 Hours Duration</p>
              <div className="an-hero-stats">
                {[
                  { label: 'Your Score', value: isProductionMode ? '0' : '184', suffix: '/200' },
                  { label: 'Percentile',  value: isProductionMode ? '0' : '99.8', suffix: 'th' },
                  { label: 'Rank',        value: isProductionMode ? '#' : '#42',  suffix: isProductionMode ? '' : '/25k' },
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
              <button className="an-hero-btn an-hero-btn--white" onClick={() => shareTestReport('Analytics Report', 0, 200, '0')}>
                <span className="material-symbols-outlined">share</span> Share Report
              </button>
            </div>
          </section>

          {/* ── Bento Grid ──────────────────── */}
          <div className="an-grid">

            {/* Peer Comparison */}
            <div className="an-glass-card an-peer-card">
              <div className="an-card-header">
                <h2 className="an-card-title">Topper vs You Comparison</h2>
                <div className="an-legend">
                  <span className="an-legend-item"><span className="an-dot an-dot--blue" />You</span>
                  <span className="an-legend-item"><span className="an-dot an-dot--purple" />Topper (AIR 1)</span>
                </div>
              </div>
              <div className="an-subjects">
                {(isProductionMode ? [
                  { subj: 'Physics',   acc: '0%', you: 0, top: 0, ys: '0/70', ts: '0/70', yt: '0m', tt: '0m' },
                  { subj: 'Chemistry', acc: '0%', you: 0, top: 0, ys: '0/65', ts: '0/65', yt: '0m', tt: '0m' },
                  { subj: 'Mathematics', acc: '0%', you: 0, top: 0, ys: '0/70', ts: '0/70', yt: '0m', tt: '0m' },
                  { subj: 'Biology', acc: '0%', you: 0, top: 0, ys: '0/65', ts: '0/65', yt: '0m', tt: '0m' },
                ] : [
                  { subj: 'Physics',   acc: '94%', you: 92, top: 98, ys: '62/70', ts: '68/70', yt: '48m', tt: '42m' },
                  { subj: 'Chemistry', acc: '88%', you: 85, top: 95, ys: '58/65', ts: '63/65', yt: '35m', tt: '31m' },
                ]).map(s => (
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
                <p className="an-ai-gap-title">Primary Gap Found</p>
                <p className="an-ai-gap-body">
                  You spent 25% more time on "Organic Chemistry" questions compared to the average top-100 student, while accuracy remained at 82%.
                </p>
              </div>
              <p className="an-rec-label">Recommended Actions</p>
              <div className="an-recs">
                {[
                  <>Solve 50 curated MCQs on <strong>Electromagnetism</strong> today.</>,
                  <>Review "Calculus – Integration" video tutorial (Part 3).</>,
                  <>Take a 15-min focused drill on <strong>Unit Conversions</strong>.</>,
                ].map((text, i) => (
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
                <span className="an-time-leg-item"><span className="an-dot an-dot--blue" />Your Time (Avg: 72s)</span>
                <span className="an-time-leg-item"><span className="an-dot an-dot--purple-light" />Ideal Time (Avg: 60s)</span>
              </div>
            </div>

            {/* Critical Topics */}
            <div className="an-glass-card an-topics-card">
              <h2 className="an-card-title">Critical Topics</h2>
              <p className="an-card-sub" style={{ marginBottom: 20 }}>Top areas where marks were lost due to inaccuracy or time pressure.</p>
              <div className="an-topics-list">
                {criticalTopics.map((t, i) => (
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
            <p className="an-footer-text">Detailed analysis generated on {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
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
