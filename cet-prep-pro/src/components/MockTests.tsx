import { useState, useEffect, useRef } from 'react'
import Sidebar from './Sidebar'
import TestInterface from './TestInterface'
import ExamInstructions from './ExamInstructions'
import UserAvatar from './UserAvatar'
import { mockTestsAPI, testsAPI, session, MockTest, TestResult, type AuthUser } from '../lib/api'

type TabType = 'Full Length' | 'Subject-wise' | 'Chapter-wise' | 'Previous Year'
type DiffFilter = 'All Levels' | 'Easy' | 'Medium' | 'Hard'
type SubjFilter = 'All Subjects' | 'Physics' | 'Chemistry' | 'Mathematics'

const TABS: TabType[] = ['Full Length', 'Subject-wise', 'Chapter-wise', 'Previous Year']

const _ALL_TESTS = [
  {
    id: 1,
    icon: 'terminal',
    iconColor: 'blue',
    title: 'Full Syllabus Mock Test A',
    desc: 'Comprehensive simulation covering PCM with latest 2024 patterns.',
    questions: 150,
    mins: 180,
    difficulty: 'Medium' as DiffFilter,
    subject: 'All Subjects' as SubjFilter,
    tab: 'Full Length' as TabType,
    recommended: true,
    primary: true,
  },
  {
    id: 2,
    icon: 'function',
    iconColor: 'purple',
    title: 'Maths Power Blitz',
    desc: 'Intensive 50-question set focused on Calculus and Algebra.',
    questions: 50,
    mins: 90,
    difficulty: 'Hard' as DiffFilter,
    subject: 'Mathematics' as SubjFilter,
    tab: 'Subject-wise' as TabType,
    recommended: false,
    primary: false,
  },
  {
    id: 3,
    icon: 'experiment',
    iconColor: 'teal',
    title: 'Physics Fundamentals',
    desc: 'Basic level test covering Mechanics and Thermodynamics.',
    questions: 40,
    mins: 60,
    difficulty: 'Easy' as DiffFilter,
    subject: 'Physics' as SubjFilter,
    tab: 'Subject-wise' as TabType,
    recommended: false,
    primary: false,
  },
  {
    id: 4,
    icon: 'history',
    iconColor: 'blue',
    title: '2023 Previous Year Paper',
    desc: 'Official MHT-CET 2023 Shift 1 paper with complete solutions.',
    questions: 150,
    mins: 180,
    difficulty: 'Medium' as DiffFilter,
    subject: 'All Subjects' as SubjFilter,
    tab: 'Previous Year' as TabType,
    recommended: false,
    primary: false,
  },
  {
    id: 5,
    icon: 'science',
    iconColor: 'orange',
    title: 'Chemistry: Organic Focus',
    desc: 'Chapter-wise test on Organic Chemistry reactions and mechanisms.',
    questions: 60,
    mins: 75,
    difficulty: 'Hard' as DiffFilter,
    subject: 'Chemistry' as SubjFilter,
    tab: 'Chapter-wise' as TabType,
    recommended: false,
    primary: false,
  },
  {
    id: 6,
    icon: 'calculate',
    iconColor: 'purple',
    title: 'Full Syllabus Mock Test B',
    desc: 'Alternate full-length simulation with updated question bank.',
    questions: 150,
    mins: 180,
    difficulty: 'Medium' as DiffFilter,
    subject: 'All Subjects' as SubjFilter,
    tab: 'Full Length' as TabType,
    recommended: false,
    primary: false,
  },
]

void _ALL_TESTS

const diffColors: Record<string, string> = {
  Easy: 'mt-diff-easy',
  Medium: 'mt-diff-medium',
  Hard: 'mt-diff-hard',
}

const iconColors: Record<string, string> = {
  blue: 'mt-icon--blue',
  purple: 'mt-icon--purple',
  teal: 'mt-icon--teal',
  orange: 'mt-icon--orange',
}

const iconMap: Record<string, string> = {
  'terminal': 'terminal',
  'function': 'function',
  'experiment': 'science',
  'history': 'history',
  'science': 'science',
  'calculate': 'calculate',
}

const colorMap: Record<string, string> = {
  'blue': 'blue',
  'purple': 'purple',
  'teal': 'teal',
  'orange': 'orange',
}

type Page = 'signin' | 'dashboard' | 'mocktests' | 'results' | 'analytics' | 'settings' | 'admin-dashboard'

interface MockTestsProps {
  onNavigate?: (page: Page) => void
}

export default function MockTests({ onNavigate }: MockTestsProps) {
  const user = session.get<AuthUser>()
  const [activeTab, setActiveTab] = useState<TabType>('Full Length')
  const [diff, setDiff] = useState<DiffFilter>('All Levels')
  const [subj, setSubj] = useState<SubjFilter>('All Subjects')
  const [rangeVal, setRangeVal] = useState(60)
  const [mockTests, setMockTests] = useState<MockTest[]>([])
  const [testResults, setTestResults] = useState<TestResult[]>([])
  const [loading, setLoading] = useState(true)
  const [showResumeDialog, setShowResumeDialog] = useState(false)
  const [selectedTestName, setSelectedTestName] = useState(() => localStorage.getItem('cet_selected_test_name') || 'MHT-CET Mock Test')
  const [selectedTestDuration, setSelectedTestDuration] = useState<number>(() => {
    const saved = localStorage.getItem('cet_selected_test_duration')
    return saved ? Number(saved) : 120
  })
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('cet_selected_question_ids')
    try {
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const [selectedQuestionCount, setSelectedQuestionCount] = useState<number>(() => {
    const saved = localStorage.getItem('cet_selected_question_count')
    return saved ? Number(saved) : 150
  })
  const bypassBackGuard = useRef(false)

  // ── Restore exam state on reload ─────────────────────────────────────────
  const EXAM_STATE_KEY = 'cet_exam_state'
  const savedState = localStorage.getItem(EXAM_STATE_KEY)
  const [testActive, setTestActive] = useState(savedState === 'test')
  const [startingTest, setStartingTest] = useState(savedState === 'instructions')

  const enterExamInstructions = () => {
    localStorage.setItem(EXAM_STATE_KEY, 'instructions')
    setStartingTest(true)
  }

  const enterTest = () => {
    bypassBackGuard.current = false
    localStorage.setItem(EXAM_STATE_KEY, 'test')
    setStartingTest(false)
    setTestActive(true)
  }

  const exitExam = () => {
    localStorage.removeItem(EXAM_STATE_KEY)
    setTestActive(false)
    setStartingTest(false)
  }

  // ── Back button interception during exam ──────────────────────────────────
  useEffect(() => {
    const isExamOpen = testActive || startingTest
    if (!isExamOpen) return

    // Push a sentinel entry so the back button hits it first
    window.history.pushState({ examGuard: true }, '')

    const handlePopState = (e: PopStateEvent) => {
      if (bypassBackGuard.current) return
      // Browser just consumed our sentinel — show the resume dialog instead of leaving
      e.preventDefault?.()
      window.history.pushState({ examGuard: true }, '') // push sentinel back immediately
      setShowResumeDialog(true)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [testActive, startingTest])

  useEffect(() => {
    loadMockTests()
    loadTestResults()
  }, [])

  const loadTestResults = async () => {
    try {
      const data = await testsAPI.getMyResults()
      setTestResults(data)
    } catch (error) {
      console.error('Failed to load test analytics:', error)
    }
  }

  const loadMockTests = async () => {
    try {
      const data = await mockTestsAPI.getAll()
      setMockTests(data)
    } catch (error) {
      console.error('Failed to load mock tests:', error)
    } finally {
      setLoading(false)
    }
  }

  const getTabType = (status: string): TabType => {
    switch (status) {
      case 'active': return 'Full Length'
      case 'scheduled': return 'Previous Year'
      default: return 'Full Length'
    }
  }

  const getDifficulty = (d: string): DiffFilter => {
    if (d === 'Easy' || d === 'Medium' || d === 'Hard') return d
    return 'All Levels'
  }

  const getSubject = (s: string): SubjFilter => {
    if (s === 'Physics' || s === 'Chemistry' || s === 'Mathematics') return s
    return 'All Subjects'
  }

  const filtered = mockTests.map(test => ({
    id: test._id,
    icon: iconMap[test.subject.toLowerCase()] || 'terminal',
    iconColor: colorMap[test.difficulty.toLowerCase()] || 'blue',
    title: test.title,
    desc: `Questions: ${test.questions} | Duration: ${test.duration} mins`,
    questions: test.questions,
    mins: test.duration,
    questionIds: test.questionIds || [],
    difficulty: getDifficulty(test.difficulty),
    subject: getSubject(test.subject),
    tab: getTabType(test.status),
    questionIds: test.questionIds || [],
    recommended: test.status === 'active',
    primary: test.status === 'active',
  })).filter(t => {
    const tabMatch = t.tab === activeTab || activeTab === 'Full Length' && t.tab === 'Full Length'
      || activeTab === 'Subject-wise' && t.tab === 'Subject-wise'
      || activeTab === 'Chapter-wise' && t.tab === 'Chapter-wise'
      || activeTab === 'Previous Year' && t.tab === 'Previous Year'
    const diffMatch = diff === 'All Levels' || t.difficulty === diff
    const subjMatch = subj === 'All Subjects' || t.subject === subj || t.subject === 'All Subjects'
    return tabMatch && diffMatch && subjMatch
  })

  const testsTaken = testResults.length
  const totalEarnedMarks = testResults.reduce((total, result) => total + result.score, 0)
  const totalAvailableMarks = testResults.reduce((total, result) => total + result.totalMarks, 0)
  const averageScore = testsTaken > 0 ? Math.round(totalEarnedMarks / testsTaken) : 0
  const averageMaxScore = testsTaken > 0 ? Math.round(totalAvailableMarks / testsTaken) : 200
  const practicedHours = testResults.reduce((total, result) => total + result.duration, 0) / 3600
  const answeredQuestions = testResults.reduce((total, result) => total + (result.correct || 0) + (result.incorrect || 0), 0)
  const correctQuestions = testResults.reduce((total, result) => total + (result.correct || 0), 0)
  const accuracy = answeredQuestions > 0 ? Math.round(correctQuestions / answeredQuestions * 100) : 0
  const completion = accuracy
  const targetSubjects = testResults.flatMap(result => result.subjectWiseScores || [])
    .reduce((subjects, subject) => {
      const current = subjects.get(subject.subject) || { score: 0, maxScore: 0 }
      subjects.set(subject.subject, { score: current.score + subject.score, maxScore: current.maxScore + subject.maxScore })
      return subjects
    }, new Map<string, { score: number; maxScore: number }>());
  const targetChapters = Array.from(targetSubjects.entries())
    .map(([label, value]) => ({ label, percentage: value.maxScore ? Math.round(value.score / value.maxScore * 100) : 0 }))
    .sort((a, b) => a.percentage - b.percentage)
    .slice(0, 2)

  // ── Resume Test Dialog ───────────────────────────────────────────────────
  const ResumeDialog = () => (
    <>
      <style>{`
        @keyframes rd-fadein  { from { opacity:0 } to { opacity:1 } }
        @keyframes rd-slidein { from { transform:translateY(20px) scale(.97); opacity:0 } to { transform:translateY(0) scale(1); opacity:1 } }
      `}</style>
      <div style={{
        position: 'fixed', inset: 0, zIndex: 999998,
        background: 'rgba(2,6,23,0.75)', backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'rd-fadein 0.18s ease',
      }}>
        <div style={{
          background: '#fff', borderRadius: '20px', width: '90%', maxWidth: '440px',
          padding: '40px 36px 32px', textAlign: 'center',
          boxShadow: '0 32px 64px rgba(0,0,0,0.3)',
          animation: 'rd-slidein 0.22s cubic-bezier(0.34,1.56,0.64,1)',
          position: 'relative', overflow: 'hidden',
        }}>
          {/* Blue accent strip */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '5px', background: 'linear-gradient(90deg,#1d4ed8,#2563eb)', borderRadius: '20px 20px 0 0' }} />

          {/* Icon */}
          <div style={{ width: '68px', height: '68px', borderRadius: '50%', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '34px', color: '#2563eb', fontVariationSettings: "'FILL' 1" }}>quiz</span>
          </div>

          {/* Tag */}
          <div style={{ display: 'inline-block', padding: '4px 12px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '12px', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>
            Exam In Progress
          </div>

          <h2 style={{ margin: '0 0 10px', fontSize: '20px', fontWeight: 800, color: '#0f172a', lineHeight: 1.3 }}>
            You have an exam in progress
          </h2>
          <p style={{ margin: '0 0 28px', fontSize: '13.5px', color: '#64748b', lineHeight: 1.65 }}>
            Your answers and timer are saved. Would you like to resume your test or exit?
          </p>

          {/* Resume button */}
          <button
            autoFocus
            onClick={() => setShowResumeDialog(false)}
            style={{
              width: '100%', padding: '14px', borderRadius: '12px', border: 'none',
              background: 'linear-gradient(135deg,#1d4ed8,#2563eb)', color: '#fff',
              fontSize: '15px', fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 6px 20px rgba(37,99,235,0.35)', marginBottom: '10px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px', fontVariationSettings: "'FILL' 0" }}>play_arrow</span>
            Resume Test
          </button>

          {/* Exit button */}
          <button
            onClick={() => {
              bypassBackGuard.current = true
              setShowResumeDialog(false)
              exitExam()
              // Pop the sentinel history entry we pushed, then exit
              window.history.go(-1)
            }}
            style={{
              width: '100%', padding: '12px', borderRadius: '12px', border: '1.5px solid #e2e8f0',
              background: '#f8fafc', color: '#64748b',
              fontSize: '14px', fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px', fontVariationSettings: "'FILL' 0" }}>exit_to_app</span>
            Exit Exam & Go Back
          </button>

          <p style={{ margin: '16px 0 0', fontSize: '11px', color: '#94a3b8' }}>
            Exiting will end your current exam session. Your progress may not be saved.
          </p>
        </div>
      </div>
    </>
  )

  return (
    <>
    {showResumeDialog && <ResumeDialog />}
    {testActive ? (
      <TestInterface
        onClose={exitExam}
        examName={selectedTestName}
        durationMinutes={selectedTestDuration}
        questionCount={selectedQuestionCount}
        questionIds={selectedQuestionIds}
        onBackToAnalysis={() => {
          exitExam()
          onNavigate?.('analytics')
        }}
        onSubmissionComplete={() => {
          exitExam()
          onNavigate?.('dashboard')
        }}
        onBackRequest={() => setShowResumeDialog(true)}
      />
    ) : startingTest ? (
      <ExamInstructions
        onStart={enterTest}
        onCancel={() => {
          sessionStorage.removeItem(EXAM_STATE_KEY)
          setStartingTest(false)
        }}
      />
    ) : (
    <div className="db-root mt-page-content">

      {/* ── Sidebar ──────────────────────────────── */}
      <Sidebar activePage="mocktests" onNavigate={onNavigate} onStartTest={enterExamInstructions} />

      {/* ── Main ─────────────────────────────────── */}
      <main className="db-main">

        {/* Topbar */}
        <header className="mt-topbar">
          <div className="mt-topbar-left">
            <h1 className="mt-topbar-title">MHT-CET Prep</h1>
            <div className="mt-search-wrap">
              <span className="material-symbols-outlined mt-search-icon">search</span>
              <input className="mt-search-input" placeholder="Search mock tests..." type="text" />
            </div>
          </div>
          <div className="mt-topbar-right">
            <button className="mt-icon-btn mt-notif-btn">
              <span className="material-symbols-outlined">notifications</span>
              <span className="mt-notif-dot" />
            </button>
            <button className="mt-icon-btn">
              <span className="material-symbols-outlined">help</span>
            </button>
            <div className="mt-avatar-wrap">
              <UserAvatar user={user} className="mt-avatar" onClick={() => onNavigate?.('settings')} />
            </div>
          </div>
        </header>

        <div className="mt-content">

          {/* Hero */}
          <div className="mt-hero">
            <div>
              <h2 className="mt-hero-title">Practice &amp; Perfect</h2>
              <p className="mt-hero-sub">Refine your preparation with real-time test simulations designed by MHT-CET experts.</p>
            </div>
            <button className="mt-quick-btn">
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
              Quick Start Mock
            </button>
          </div>

          <div className="mt-grid">

            {/* Left: Tests */}
            <div className="mt-left-col">

              {/* Filter bar */}
              <div className="mt-filter-bar">
                <div className="mt-tabs">
                  {TABS.map(tab => (
                    <button
                      key={tab}
                      className={`mt-tab${activeTab === tab ? ' mt-tab--active' : ''}`}
                      onClick={() => setActiveTab(tab)}
                    >{tab}</button>
                  ))}
                </div>
                <div className="mt-filter-controls">
                  <div className="mt-filter-group">
                    <span className="mt-filter-label">Difficulty:</span>
                    <select className="mt-select" value={diff} onChange={e => setDiff(e.target.value as DiffFilter)}>
                      {(['All Levels', 'Easy', 'Medium', 'Hard'] as DiffFilter[]).map(d => <option key={d}>{d}</option>)}
                    </select>
                  </div>
                  <div className="mt-filter-group">
                    <span className="mt-filter-label">Subject:</span>
                    <select className="mt-select" value={subj} onChange={e => setSubj(e.target.value as SubjFilter)}>
                      {(['All Subjects', 'Physics', 'Chemistry', 'Mathematics'] as SubjFilter[]).map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Test Cards Grid */}
              <div className="mt-cards-grid">
                {loading && (
                  <div className="mt-empty">
                    <span className="material-symbols-outlined mt-empty-icon">progress_activity</span>
                    <p>Loading available tests...</p>
                  </div>
                )}
                {!loading && filtered.length === 0 && (
                  <div className="mt-empty">
                    <span className="material-symbols-outlined mt-empty-icon">search_off</span>
                    <p>No tests match your filters.</p>
                  </div>
                )}
                {filtered.map(test => (
                  <div key={test.id} className="mt-glass-card mt-test-card">
                    {test.recommended && <div className="mt-recommended-badge">Recommended</div>}
                    <div className={`mt-card-icon ${iconColors[test.iconColor]}`}>
                      <span className="material-symbols-outlined">{test.icon}</span>
                    </div>
                    <h3 className="mt-card-title">{test.title}</h3>
                    <p className="mt-card-desc">{test.desc}</p>
                    <div className="mt-card-meta">
                      <span className="mt-meta-item">
                        <span className="material-symbols-outlined">format_list_bulleted</span>
                        {test.questions} Qs
                      </span>
                      <span className="mt-meta-item">
                        <span className="material-symbols-outlined">schedule</span>
                        {test.mins} Mins
                      </span>
                      <span className={`mt-diff-badge ${diffColors[test.difficulty]}`}>{test.difficulty}</span>
                    </div>
                    <button className={`mt-start-btn${test.primary ? ' mt-start-btn--primary' : ''}`} onClick={() => {
                      localStorage.setItem('cet_selected_test_name', test.title)
                      localStorage.setItem('cet_selected_test_duration', String(test.mins))
                      localStorage.setItem('cet_selected_question_ids', JSON.stringify(test.questionIds))
                      localStorage.setItem('cet_selected_question_count', String(test.questions))
                      setSelectedTestName(test.title)
                      setSelectedTestDuration(test.mins)
                      setSelectedQuestionCount(test.questions)
                      setSelectedQuestionIds(test.questionIds)
                      setStartingTest(true)
                    }}>
                      Start Now
                      <span className="material-symbols-outlined">arrow_forward</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Sidebar widgets */}
            <div className="mt-right-col">

              {/* AI Custom Test */}
              <section className="mt-ai-card">
                <div className="mt-ai-card-inner">
                  <div className="mt-ai-header">
                    <span className="material-symbols-outlined mt-ai-icon" style={{ fontVariationSettings: "'FILL' 1" }}>psychology</span>
                    <h3 className="mt-ai-title">AI Custom Test</h3>
                  </div>
                  <p className="mt-ai-desc">Generate a test based on your weak areas identified by our analytics engine.</p>
                  <div className="mt-ai-fields">
                    <div>
                      <label className="mt-field-label">Select Weak Topics</label>
                      <div className="mt-topic-chips">
                        <span className="mt-topic-chip mt-topic-chip--active">Calculus</span>
                        <span className="mt-topic-chip mt-topic-chip--active">Organic Chem</span>
                        <span className="mt-topic-chip">+ Add Topic</span>
                      </div>
                    </div>
                    <div>
                      <label className="mt-field-label">Time Limit: {rangeVal} min</label>
                      <input
                        type="range" min={30} max={120} value={rangeVal}
                        onChange={e => setRangeVal(Number(e.target.value))}
                        className="mt-range"
                      />
                      <div className="mt-range-labels"><span>30 MIN</span><span>120 MIN</span></div>
                    </div>
                  </div>
                  <button className="mt-generate-btn">Generate Personalized Test</button>
                </div>
              </section>

              {/* Test Analytics */}
              <div className="mt-glass-card mt-analytics-card">
                <h4 className="mt-analytics-title">Test Analytics</h4>
                <div className="mt-analytics-top">
                  <div>
                        <span className="mt-big-score">{averageScore}<span className="mt-big-score-unit">/{averageMaxScore}</span></span>
                    <span className="mt-score-label">Avg Score</span>
                  </div>
                  <div className="mt-ring-group">
                    <div className="mt-ring-wrap">
                    <svg className="mt-ring-svg" viewBox="0 0 80 80">
                      <circle cx="40" cy="40" r="32" fill="transparent" stroke="#e1e3e4" strokeWidth="8" />
                      <circle cx="40" cy="40" r="32" fill="transparent"
                        stroke="#005bbf" strokeWidth="8"
                        strokeDasharray="200" strokeDashoffset={200 - (200 * completion) / 100}
                        strokeLinecap="round"
                        style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}
                      />
                    </svg>
                    <div className="mt-ring-label">{accuracy}%</div>
                    </div>
                    <span className="mt-ring-caption">Accuracy</span>
                  </div>
                </div>
                <div className="mt-analytics-rows">
                  {[
                    { label: 'Tests Taken', val: testsTaken.toString() },
                    { label: 'Time Practiced', val: `${practicedHours.toFixed(1)} hrs` },
                    { label: 'Accuracy', val: `${accuracy}%`, green: true },
                  ].map(r => (
                    <div key={r.label} className="mt-analytics-row">
                      <span className="mt-analytics-row-label">{r.label}</span>
                      <span className={`mt-analytics-row-val${r.green ? ' mt-analytics-row-val--green' : ''}`}>{r.val}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Target Chapters */}
              <div className="mt-glass-card mt-chapters-card">
                <div className="mt-chapters-header">Target Chapters</div>
                <div className="mt-chapters-list">
                  {targetChapters.length > 0 ? targetChapters.map((chapter, index) => ({
                    icon: index === 0 ? 'priority_high' : 'target',
                    label: chapter.label,
                    badge: chapter.percentage < 60 ? 'Critical' : 'Priority',
                    color: index === 0 ? 'orange' : 'blue',
                  })).map(ch => (
                    <div key={ch.label} className="mt-chapter-row">
                      <div className="mt-chapter-left">
                        <div className={`mt-chapter-icon mt-chapter-icon--${ch.color}`}>
                          <span className="material-symbols-outlined">{ch.icon}</span>
                        </div>
                        <span className="mt-chapter-label">{ch.label}</span>
                      </div>
                      <span className={`mt-chapter-badge mt-chapter-badge--${ch.color}`}>{ch.badge}</span>
                    </div>
                  )) : <p className="mt-empty-chapters">Complete a test to identify subjects that need attention.</p>}
                </div>
              </div>

            </div>
          </div>
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="mt-mobile-nav">
        {[
          { icon: 'dashboard', label: 'Home' },
          { icon: 'quiz', label: 'Tests', active: true },
          { icon: 'analytics', label: 'Stats' },
          { icon: 'person', label: 'Profile' },
        ].map(item => (
          <a key={item.label} href="#"
            className={`mt-mobile-nav-item${item.active ? ' mt-mobile-nav-item--active' : ''}`}
            onClick={e => e.preventDefault()}
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
    </div>
    )}
    </>
  )
}
