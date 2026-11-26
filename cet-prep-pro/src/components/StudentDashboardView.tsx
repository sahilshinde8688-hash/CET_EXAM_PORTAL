import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  ChartNoAxesCombined,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Copy,
  FileText,
  Flame,
  ListChecks,
  LogOut,
  Menu,
  Minus,
  Play,
  QrCode,
  Search,
  Settings,
  Target,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import {
  Chart as ChartJS,
  CategoryScale,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import Sidebar, { type Page } from './Sidebar'
import NotificationCenter from './NotificationCenter'
import {
  authAPI,
  session,
  type AuthUser,
  type MockTestAssignment,
  type StudentNotification,
  type TestResult,
} from '../lib/api'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip)

const WEEKLY_TEST_TARGET = 5

interface InProgressTest {
  title?: string
  message?: string
}

interface StudentDashboardViewProps {
  user: AuthUser | null
  testHistory: TestResult[]
  dashboardLoading: boolean
  dashboardError: boolean
  assignedTests: MockTestAssignment[]
  assignedTestsLoading: boolean
  assignedTestsError: string
  inProgressTest: InProgressTest | null
  onNavigate?: (page: Page) => void
  onStartTest: () => void
  onResumeTest: () => void
  onOpenAssignedTests: () => void
  onRetry: () => void
}

interface SubjectSummary {
  subject: string
  score: number
  maxScore: number
  percentage: number
  tests: number
}

const getQuestionCount = (result: TestResult): number | null => {
  if (Number.isFinite(result.correct) && Number.isFinite(result.incorrect)) {
    return Math.max(0, Number(result.correct) + Number(result.incorrect))
  }
  if (Number.isFinite(result.totalQuestions) && Number.isFinite(result.unanswered)) {
    return Math.max(0, Number(result.totalQuestions) - Number(result.unanswered))
  }
  return null
}

const formatDate = (value: string, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, options)
}

const greetingForHour = (hour: number) => (
  hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
)

const getChange = (current: number | null, previous: number | null, suffix = '') => {
  if (current === null || previous === null) return null
  const delta = current - previous
  if (!Number.isFinite(delta)) return null
  return { delta, text: `${delta > 0 ? '+' : ''}${delta.toFixed(1)}${suffix}` }
}

export default function StudentDashboardView({
  user,
  testHistory,
  dashboardLoading,
  dashboardError,
  assignedTests,
  assignedTestsLoading,
  assignedTestsError,
  inProgressTest,
  onNavigate,
  onStartTest,
  onResumeTest,
  onOpenAssignedTests,
  onRetry,
}: StudentDashboardViewProps) {
  const [profileOpen, setProfileOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedTrendSubject, setSelectedTrendSubject] = useState('all')
  const [copyMessage, setCopyMessage] = useState('')
  const profileMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!profileOpen) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) setProfileOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfileOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [profileOpen])

  const metrics = useMemo(() => {
    const percentileResults = testHistory.filter(result => Number.isFinite(result.percentile))
    const averagePercentile = percentileResults.length
      ? percentileResults.reduce((sum, result) => sum + Number(result.percentile), 0) / percentileResults.length
      : null
    const accuracyResults = testHistory.filter(result => (
      Number.isFinite(result.correct) && Number.isFinite(result.incorrect)
    ))
    const totalCorrect = accuracyResults.reduce((sum, result) => sum + Number(result.correct), 0)
    const totalAnswered = accuracyResults.reduce((sum, result) => (
      sum + Number(result.correct) + Number(result.incorrect)
    ), 0)
    const questionCounts = testHistory.map(getQuestionCount).filter((value): value is number => value !== null)
    const totalQuestionsSolved = questionCounts.length
      ? questionCounts.reduce((sum, value) => sum + value, 0)
      : null

    return {
      totalTests: testHistory.length,
      averagePercentile,
      averageAccuracy: totalAnswered ? (totalCorrect / totalAnswered) * 100 : null,
      totalQuestionsSolved,
    }
  }, [testHistory])

  const weeklyTests = useMemo(() => {
    const now = new Date()
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
    return testHistory.filter(result => {
      const date = new Date(result.attemptedAt)
      return !Number.isNaN(date.getTime()) && date >= monday && date <= now
    }).length
  }, [testHistory])

  const studyStreak = useMemo(() => {
    const attemptedDays = new Set(
      testHistory
        .map(result => new Date(result.attemptedAt))
        .filter(date => !Number.isNaN(date.getTime()))
        .map(date => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`),
    )
    const date = new Date()
    const dayKey = (value: Date) => `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`
    if (!attemptedDays.has(dayKey(date))) date.setDate(date.getDate() - 1)

    let streak = 0
    while (attemptedDays.has(dayKey(date))) {
      streak += 1
      date.setDate(date.getDate() - 1)
    }
    return streak
  }, [testHistory])

  const subjectSummaries = useMemo(() => {
    const grouped = new Map<string, { score: number; maxScore: number; percentageTotal: number; percentageCount: number; tests: number }>()
    for (const result of testHistory) {
      for (const subject of result.subjectWiseScores || []) {
        const name = subject.subject?.trim()
        if (!name) continue
        const summary = grouped.get(name) || { score: 0, maxScore: 0, percentageTotal: 0, percentageCount: 0, tests: 0 }
        const score = Number(subject.score)
        const maxScore = Number(subject.maxScore)
        if (Number.isFinite(score) && Number.isFinite(maxScore) && maxScore > 0) {
          summary.score += score
          summary.maxScore += maxScore
        }
        const percentage = Number.isFinite(subject.percentage)
          ? Number(subject.percentage)
          : Number.isFinite(score) && Number.isFinite(maxScore) && maxScore > 0
            ? (score / maxScore) * 100
            : null
        if (percentage !== null) {
          summary.percentageTotal += percentage
          summary.percentageCount += 1
        }
        summary.tests += 1
        grouped.set(name, summary)
      }
    }

    return Array.from(grouped, ([subject, summary]): SubjectSummary => {
      const percentage = summary.maxScore > 0
        ? (summary.score / summary.maxScore) * 100
        : summary.percentageCount
          ? summary.percentageTotal / summary.percentageCount
          : 0
      return { subject, score: summary.score, maxScore: summary.maxScore, percentage, tests: summary.tests }
    }).sort((a, b) => a.percentage - b.percentage)
  }, [testHistory])

  const trendSubjects = useMemo(() => (
    Array.from(new Set(testHistory.flatMap(result => (
      (result.subjectWiseScores || []).map(subject => subject.subject?.trim()).filter((value): value is string => Boolean(value))
    )))).sort((a, b) => a.localeCompare(b))
  ), [testHistory])

  const trendPoints = useMemo(() => {
    return testHistory.slice(0, 8).reverse().map(result => {
      const label = formatDate(result.attemptedAt, { month: 'short', day: 'numeric' })
      if (selectedTrendSubject === 'all') {
        return { label, value: Number.isFinite(result.percentile) ? Number(result.percentile) : null }
      }
      const subject = result.subjectWiseScores?.find(item => item.subject === selectedTrendSubject)
      const score = Number(subject?.score)
      const maxScore = Number(subject?.maxScore)
      const value = Number.isFinite(subject?.percentage)
        ? Number(subject?.percentage)
        : Number.isFinite(score) && Number.isFinite(maxScore) && maxScore > 0
          ? (score / maxScore) * 100
          : null
      return { label, value }
    })
  }, [selectedTrendSubject, testHistory])

  const chartData = useMemo<ChartData<'line'>>(() => ({
    labels: trendPoints.map(point => point.label),
    datasets: [{
      label: selectedTrendSubject === 'all' ? 'Percentile' : `${selectedTrendSubject} score`,
      data: trendPoints.map(point => point.value),
      borderColor: '#D41236',
      backgroundColor: 'rgba(212, 18, 54, 0.08)',
      borderWidth: 2.5,
      pointRadius: 3,
      pointHoverRadius: 5,
      pointBackgroundColor: '#D41236',
      pointBorderColor: '#FFFFFF',
      pointBorderWidth: 2,
      tension: 0.35,
      fill: true,
      spanGaps: true,
    }],
  }), [selectedTrendSubject, trendPoints])

  const chartOptions = useMemo<ChartOptions<'line'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#171923',
        padding: 10,
        displayColors: false,
        callbacks: {
          label: context => `${Number(context.parsed.y).toFixed(1)}${selectedTrendSubject === 'all' ? ' percentile' : '%'}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: { color: '#94A3B8', maxRotation: 0, autoSkip: true },
      },
      y: {
        min: 0,
        max: 100,
        border: { display: false, dash: [4, 4] },
        grid: { color: '#F0F1F4' },
        ticks: { color: '#94A3B8', stepSize: 25, callback: value => `${value}` },
      },
    },
  }), [selectedTrendSubject])

  const recentResults = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase()
    const matching = query
      ? testHistory.filter(result => `${result.testName} ${result.subject}`.toLocaleLowerCase().includes(query))
      : testHistory
    return matching.slice(0, 6)
  }, [searchTerm, testHistory])

  const comparisonFor = (valueOf: (result: TestResult) => number | null) => {
    if (testHistory.length < 4) return null
    const recent = testHistory.slice(0, 3).map(valueOf).filter((value): value is number => value !== null)
    const previous = testHistory.slice(3, 6).map(valueOf).filter((value): value is number => value !== null)
    if (!recent.length || !previous.length) return null
    const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
    return getChange(average(recent), average(previous), ' pts')
  }

  const metricsCards: Array<{ label: string; value: string; caption: string; icon: LucideIcon; change: ReturnType<typeof comparisonFor> }> = [
    {
      label: 'Average percentile',
      value: metrics.averagePercentile === null ? '—' : metrics.averagePercentile.toFixed(1),
      caption: metrics.averagePercentile === null ? 'Complete a test to see your percentile' : 'Across completed tests',
      icon: ChartNoAxesCombined,
      change: comparisonFor(result => Number.isFinite(result.percentile) ? Number(result.percentile) : null),
    },
    {
      label: 'Tests attempted',
      value: String(metrics.totalTests),
      caption: dashboardLoading ? 'Loading your test history' : 'Completed mock tests',
      icon: ClipboardCheck,
      change: null,
    },
    {
      label: 'Average accuracy',
      value: metrics.averageAccuracy === null ? '—' : `${Math.round(metrics.averageAccuracy)}%`,
      caption: metrics.averageAccuracy === null ? 'Accuracy data is not available yet' : 'Correct answers / attempted',
      icon: Target,
      change: comparisonFor(result => {
        const correct = Number(result.correct)
        const incorrect = Number(result.incorrect)
        return Number.isFinite(correct) && Number.isFinite(incorrect) && correct + incorrect > 0
          ? (correct / (correct + incorrect)) * 100
          : null
      }),
    },
    {
      label: 'Questions solved',
      value: metrics.totalQuestionsSolved === null ? '—' : metrics.totalQuestionsSolved.toLocaleString(),
      caption: metrics.totalQuestionsSolved === null ? 'Question totals are not available yet' : 'Answered across completed tests',
      icon: ListChecks,
      change: null,
    },
  ]

  const weakestSubject = subjectSummaries[0]
  const strongestSubject = subjectSummaries.at(-1)
  const recommendation = metrics.totalTests === 0
    ? {
      title: 'Start with your first mock test',
      description: 'A baseline test helps you understand where to focus your preparation.',
      action: 'Start a mock test',
      icon: Play,
      callback: onStartTest,
    }
    : weakestSubject && weakestSubject.percentage < 60
      ? {
        title: `${weakestSubject.subject} is a good next focus`,
        description: `Your score rate is ${Math.round(weakestSubject.percentage)}% across ${weakestSubject.tests} test${weakestSubject.tests === 1 ? '' : 's'}. Try a focused practice set.`,
        action: 'Practice this subject',
        icon: BookOpen,
        callback: () => onNavigate?.('mocktests'),
      }
      : weeklyTests < WEEKLY_TEST_TARGET
        ? {
          title: 'Keep your weekly practice moving',
          description: `${weeklyTests} of ${WEEKLY_TEST_TARGET} weekly target tests completed so far.`,
          action: 'Choose a mock test',
          icon: CalendarDays,
          callback: () => onNavigate?.('mocktests'),
        }
        : strongestSubject
          ? {
            title: `Build on your ${strongestSubject.subject} progress`,
            description: `${Math.round(strongestSubject.percentage)}% score rate across ${strongestSubject.tests} test${strongestSubject.tests === 1 ? '' : 's'}. Keep challenging yourself with timed practice.`,
            action: 'View practice tests',
            icon: TrendingUp,
            callback: () => onNavigate?.('mocktests'),
          }
          : {
            title: 'Review your recent results',
            description: 'Your test history is ready. Review it to plan your next practice session.',
            action: 'View results',
            icon: ChartNoAxesCombined,
            callback: () => onNavigate?.('results'),
          }

  const firstName = user?.name?.trim().split(/\s+/)[0] || 'Student'
  const initials = firstName.slice(0, 1).toUpperCase() + (user?.name?.trim().split(/\s+/)[1]?.slice(0, 1).toUpperCase() || '')
  const branchLabel = user?.branch
    ? `${user.branch}${user.batch ? ` · Batch ${user.batch}` : ''}`
    : user?.batch ? `Batch ${user.batch}` : 'MHT-CET student'
  const weeklyGoalPercent = Math.min(100, Math.round((weeklyTests / WEEKLY_TEST_TARGET) * 100))
  const greeting = greetingForHour(new Date().getHours())
  const RecommendationIcon = recommendation.icon

  const handleNotification = (notification: StudentNotification) => {
    if (notification.targetType && notification.targetId) {
      sessionStorage.setItem('cet:pending-notification-navigation', JSON.stringify({
        targetPage: notification.targetPage,
        targetType: notification.targetType,
        targetId: notification.targetId,
      }))
    }
    onNavigate?.(notification.targetPage)
  }

  const handleLogout = async () => {
    setProfileOpen(false)
    try {
      await authAPI.logout()
    } catch (error) {
      console.warn('Logout failed; clearing the local session.', error)
    }
    session.clear()
    onNavigate?.('signin')
  }

  const copyDashboardLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopyMessage('Link copied')
    } catch (error) {
      console.error('Could not copy the dashboard link:', error)
      setCopyMessage('Could not copy link')
    }
    window.setTimeout(() => setCopyMessage(''), 2200)
  }

  const openQr = () => window.dispatchEvent(new CustomEvent('cet:open-qr'))

  return (
    <div className="db-root">
      <Sidebar activePage="dashboard" onNavigate={onNavigate} onStartTest={onStartTest} />

      <main className="db-main">
        <header className="db-topbar">
          <div className="db-topbar-left">
            <button type="button" className="db-mobile-menu-btn" onClick={() => window.dispatchEvent(new CustomEvent('cet:toggle-nav'))} aria-label="Open navigation">
              <Menu size={20} />
            </button>
            <div className="db-search-wrap">
              <Search size={17} className="db-search-icon" aria-hidden="true" />
              <input
                className="db-search-input"
                placeholder="Search tests, resources, subjects..."
                type="search"
                value={searchTerm}
                onChange={event => setSearchTerm(event.target.value)}
                aria-label="Search tests, resources, and subjects"
              />
            </div>
          </div>

          <div className="db-topbar-right">
            <button type="button" className="db-icon-btn" onClick={openQr} title="Open phone QR" aria-label="Open phone QR scanner">
              <QrCode size={18} />
            </button>
            <NotificationCenter onOpenNotification={handleNotification} />
            <div className="db-menu-wrap">
              <button type="button" className="db-icon-btn" onClick={() => setHelpOpen(open => !open)} aria-label="Help and support" aria-expanded={helpOpen}>
                <CircleHelp size={18} />
              </button>
              {helpOpen && (
                <div className="db-popover db-help-popover">
                  <strong>How can we help?</strong>
                  <p>Explore practice tests, subject sets, and previous-year papers.</p>
                  <button type="button" onClick={() => { setHelpOpen(false); onNavigate?.('mocktests') }}>
                    Browse practice <ArrowRight size={15} />
                  </button>
                </div>
              )}
            </div>
            <div className="db-profile-wrap" ref={profileMenuRef}>
              <button type="button" className="db-profile-trigger" onClick={() => setProfileOpen(open => !open)} aria-expanded={profileOpen} aria-label="Open profile menu">
                <span className="db-avatar" aria-hidden="true">{initials}</span>
                <span className="db-profile-copy">
                  <strong>{user?.name || 'Student'}</strong>
                  <small>{branchLabel}</small>
                </span>
                <ChevronDown size={15} aria-hidden="true" />
              </button>
              {profileOpen && (
                <div className="db-profile-menu" role="menu">
                  <div className="db-profile-menu-heading">
                    <strong>{user?.name || 'Student'}</strong>
                    <span>{user?.email || branchLabel}</span>
                  </div>
                  <button type="button" role="menuitem" onClick={() => { setProfileOpen(false); onNavigate?.('settings') }}>
                    <Settings size={16} /> Account settings
                  </button>
                  <button type="button" role="menuitem" onClick={() => void handleLogout()}>
                    <LogOut size={16} /> Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="db-content">
          <div className="db-page-heading">
            <div>
              <p className="db-eyebrow">YOUR PREPARATION</p>
              <h1>Dashboard</h1>
            </div>
            <span className="db-batch-chip">{branchLabel}</span>
          </div>

          <section className="db-welcome" aria-labelledby="db-welcome-title">
            <div className="db-welcome-copy">
              <span className="db-welcome-overline">YOUR CET JOURNEY</span>
              <h2 id="db-welcome-title">{greeting}, {firstName}! <span aria-hidden="true">👋</span></h2>
              <p>Every test brings you one step closer to your CET goal.</p>
            </div>
            <div className="db-welcome-stats">
              <div className="db-welcome-stat">
                <span className="db-welcome-stat-icon db-welcome-stat-icon--warm"><Flame size={18} /></span>
                <span><small>Study streak</small><strong>{dashboardLoading ? '—' : `${studyStreak} ${studyStreak === 1 ? 'day' : 'days'}`}</strong></span>
              </div>
              <div className="db-welcome-stat">
                <span className="db-welcome-stat-icon"><ClipboardCheck size={18} /></span>
                <span><small>Tests attempted</small><strong>{dashboardLoading ? '—' : metrics.totalTests}</strong></span>
              </div>
              <div className="db-welcome-stat">
                <span className="db-welcome-stat-icon"><Target size={18} /></span>
                <span><small>Weekly goal</small><strong>{dashboardLoading ? '—' : `${weeklyGoalPercent}%`}</strong></span>
              </div>
            </div>
            <div className="db-weekly-progress">
              <div className="db-weekly-progress-copy">
                <span>This week <strong>{weeklyTests} of {WEEKLY_TEST_TARGET} tests</strong></span>
                <span>{Math.max(0, WEEKLY_TEST_TARGET - weeklyTests)} to go</span>
              </div>
              <div className="db-progress-track" role="progressbar" aria-label="Weekly test goal" aria-valuenow={weeklyGoalPercent} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${weeklyGoalPercent}%` }} />
              </div>
            </div>
          </section>

          {inProgressTest && (
            <section className="db-resume-card" aria-label="Resume your test">
              <span className="db-resume-icon"><Play size={19} fill="currentColor" /></span>
              <div className="db-resume-copy">
                <span className="db-status-pill db-status-pill--active">In progress</span>
                <h2>{inProgressTest.title || 'MHT-CET Mock Test'}</h2>
                <p>{inProgressTest.message || 'Pick up where you left off and complete your test.'}</p>
              </div>
              <div className="db-resume-actions">
                {copyMessage && <span className="db-copy-message" role="status">{copyMessage}</span>}
                <button type="button" className="db-button db-button--secondary" onClick={() => void copyDashboardLink()}><Copy size={15} /> Share</button>
                <button type="button" className="db-button db-button--primary" onClick={onResumeTest}>Resume test <ArrowRight size={16} /></button>
              </div>
            </section>
          )}

          <section className="db-section" aria-labelledby="db-quick-actions-title">
            <div className="db-section-heading">
              <div><h2 id="db-quick-actions-title">Quick actions</h2><p>Pick up your preparation where it matters.</p></div>
            </div>
            <div className="db-quick-grid">
              <button type="button" className="db-quick-card db-quick-card--primary" onClick={onStartTest}>
                <span className="db-quick-icon"><Play size={19} /></span>
                <span className="db-quick-card-copy"><strong>Start mock test</strong><small>Start a new examination.</small></span>
                <ArrowRight size={17} className="db-quick-arrow" />
              </button>
              <button type="button" className="db-quick-card" onClick={() => onNavigate?.('mocktests')}>
                <span className="db-quick-icon"><BookOpen size={19} /></span>
                <span className="db-quick-card-copy"><strong>Practice questions</strong><small>Choose a subject or chapter.</small></span>
                <ArrowRight size={17} className="db-quick-arrow" />
              </button>
              <button type="button" className="db-quick-card" onClick={() => onNavigate?.('results')}>
                <span className="db-quick-icon"><ChartNoAxesCombined size={19} /></span>
                <span className="db-quick-card-copy"><strong>View results</strong><small>Review your previous tests.</small></span>
                <ArrowRight size={17} className="db-quick-arrow" />
              </button>
              <button type="button" className="db-quick-card" onClick={() => onNavigate?.('mocktests')}>
                <span className="db-quick-icon"><FileText size={19} /></span>
                <span className="db-quick-card-copy"><strong>Study resources</strong><small>Explore practice and past papers.</small></span>
                <ArrowRight size={17} className="db-quick-arrow" />
              </button>
            </div>
          </section>

          <section className="db-section" aria-labelledby="db-performance-title">
            <div className="db-section-heading">
              <div><h2 id="db-performance-title">Performance overview</h2><p>A clear view of your completed test results.</p></div>
              <button type="button" className="db-text-button" onClick={() => onNavigate?.('analytics')}>Detailed analytics <ArrowRight size={15} /></button>
            </div>
            <div className="db-metrics-grid">
              {metricsCards.map(metric => {
                const Icon = metric.icon
                const positive = metric.change && metric.change.delta > 0
                const negative = metric.change && metric.change.delta < 0
                const ChangeIcon = positive ? ArrowUpRight : negative ? ArrowDownRight : Minus
                return (
                  <article className="db-metric-card" key={metric.label}>
                    <div className="db-metric-card-top">
                      <span className="db-metric-icon"><Icon size={18} /></span>
                      {metric.change && <span className={`db-metric-change${positive ? ' is-positive' : negative ? ' is-negative' : ''}`}><ChangeIcon size={14} />{metric.change.text}</span>}
                    </div>
                    <p className="db-metric-label">{metric.label}</p>
                    <strong className="db-metric-value">{dashboardLoading ? '—' : metric.value}</strong>
                    <span className="db-metric-caption">{metric.caption}</span>
                  </article>
                )
              })}
            </div>
          </section>

          <div className="db-insights-grid">
            <section className="db-panel db-trend-panel" aria-labelledby="db-trend-title">
              <div className="db-panel-heading">
                <div><h2 id="db-trend-title">Performance trends</h2><p>Track progress across your recent tests.</p></div>
                <label className="db-select-label">
                  <span className="sr-only">Filter trend by subject</span>
                  <select value={selectedTrendSubject} onChange={event => setSelectedTrendSubject(event.target.value)}>
                    <option value="all">All subjects · Percentile</option>
                    {trendSubjects.map(subject => <option value={subject} key={subject}>{subject}</option>)}
                  </select>
                </label>
              </div>
              {dashboardLoading ? (
                <div className="db-chart-empty" role="status">Loading your performance history…</div>
              ) : trendPoints.some(point => point.value !== null) ? (
                <div className="db-chart-wrap"><Line data={chartData} options={chartOptions} /></div>
              ) : (
                <div className="db-chart-empty">
                  <span className="db-empty-icon"><ChartNoAxesCombined size={21} /></span>
                  <strong>No trend data yet</strong>
                  <span>Complete a mock test to see your performance here.</span>
                </div>
              )}
            </section>

            <section className="db-panel db-recommendation" aria-labelledby="db-recommendation-title">
              <span className="db-recommendation-icon"><RecommendationIcon size={20} /></span>
              <p className="db-eyebrow">RECOMMENDED NEXT STEP</p>
              <h2 id="db-recommendation-title">{recommendation.title}</h2>
              <p className="db-recommendation-copy">{recommendation.description}</p>
              <button type="button" className="db-button db-button--primary" onClick={recommendation.callback}>
                {recommendation.action}<ArrowRight size={16} />
              </button>
            </section>
          </div>

          <section className="db-section" aria-labelledby="db-subjects-title">
            <div className="db-section-heading">
              <div><h2 id="db-subjects-title">Subject performance</h2><p>Based on subject scores recorded in your tests.</p></div>
              <button type="button" className="db-text-button" onClick={() => onNavigate?.('analytics')}>View detailed analytics <ArrowRight size={15} /></button>
            </div>
            {subjectSummaries.length ? (
              <div className="db-subject-grid">
                {subjectSummaries.map(subject => {
                  const tone = subject.percentage >= 75 ? 'strong' : subject.percentage >= 55 ? 'average' : 'weak'
                  return (
                    <article className={`db-subject-card db-subject-card--${tone}`} key={subject.subject}>
                      <div className="db-subject-card-heading">
                        <div><span className="db-subject-dot" /><h3>{subject.subject}</h3></div>
                        <span className={`db-subject-status db-subject-status--${tone}`}>{tone === 'strong' ? 'Strong' : tone === 'average' ? 'Building' : 'Focus area'}</span>
                      </div>
                      <strong className="db-subject-score">{Math.round(subject.percentage)}<small>%</small></strong>
                      <p className="db-subject-meta">
                        {subject.maxScore > 0 ? `${subject.score.toFixed(0)} / ${subject.maxScore.toFixed(0)} score` : 'Score rate'}
                        <span>Across {subject.tests} test{subject.tests === 1 ? '' : 's'}</span>
                      </p>
                      <div className="db-subject-progress" role="progressbar" aria-label={`${subject.subject} score rate`} aria-valuenow={Math.round(subject.percentage)} aria-valuemin={0} aria-valuemax={100}>
                        <span style={{ width: `${Math.max(0, Math.min(100, subject.percentage))}%` }} />
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="db-empty-panel">
                <span className="db-empty-icon"><BookOpen size={21} /></span>
                <strong>Subject insights will appear here</strong>
                <span>Complete a test with subject-wise scoring to see your progress.</span>
              </div>
            )}
          </section>

          <section className="db-panel db-activity-panel" aria-labelledby="db-activity-title">
            <div className="db-panel-heading db-activity-heading">
              <div><h2 id="db-activity-title">Recent test activity</h2><p>Your latest completed attempts.</p></div>
              <button type="button" className="db-text-button" onClick={() => onNavigate?.('results')}>View all <ArrowRight size={15} /></button>
            </div>
            {dashboardLoading ? (
              <div className="db-table-state" role="status">Loading your test activity…</div>
            ) : recentResults.length ? (
              <div className="db-table-scroll">
                <table className="db-activity-table">
                  <thead><tr><th>Test name</th><th>Date</th><th>Questions attempted</th><th>Score</th><th>Percentile</th><th>Status</th><th><span className="sr-only">View result</span></th></tr></thead>
                  <tbody>
                    {recentResults.map(result => {
                      const questionCount = getQuestionCount(result)
                      return (
                        <tr key={result._id}>
                          <td><strong>{result.testName || 'Mock test'}</strong><small>{result.subject || 'MHT-CET'}</small></td>
                          <td>{formatDate(result.attemptedAt)}</td>
                          <td>{questionCount === null ? '—' : questionCount}</td>
                          <td>{Number.isFinite(result.score) ? `${Math.round(result.score)} / ${Math.round(result.totalMarks || 0)}` : '—'}</td>
                          <td>{Number.isFinite(result.percentile) ? `${Number(result.percentile).toFixed(1)}` : '—'}</td>
                          <td><span className="db-status-pill db-status-pill--complete"><CheckCircle2 size={13} />Completed</span></td>
                          <td><button type="button" className="db-table-action" onClick={() => onNavigate?.('results')} aria-label={`View result for ${result.testName}`}><ArrowRight size={16} /></button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="db-empty-panel db-empty-panel--table">
                <span className="db-empty-icon"><ClipboardCheck size={21} /></span>
                <strong>{searchTerm ? 'No matching tests found' : 'No tests attempted yet'}</strong>
                <span>{searchTerm ? 'Try another test name or subject.' : 'Your completed tests and results will appear here.'}</span>
                {!searchTerm && <button type="button" className="db-button db-button--primary" onClick={onStartTest}>Start your first test <ArrowRight size={16} /></button>}
              </div>
            )}
          </section>

          <section className="db-panel db-assigned-panel" aria-labelledby="db-assigned-title">
            <div className="db-panel-heading">
              <div><h2 id="db-assigned-title">Assigned mock tests</h2><p>Tests assigned to your student account.</p></div>
              <button type="button" className="db-text-button" onClick={onOpenAssignedTests}>Open assigned tests <ArrowRight size={15} /></button>
            </div>
            {assignedTestsLoading ? (
              <div className="db-table-state" role="status">Loading assigned tests…</div>
            ) : assignedTestsError ? (
              <div className="db-inline-error" role="alert"><span>{assignedTestsError}</span><button type="button" onClick={onRetry}>Retry</button></div>
            ) : assignedTests.length ? (
              <div className="db-assigned-list">
                {assignedTests.slice(0, 3).map(assignment => (
                  <article className="db-assigned-item" key={assignment._id}>
                    <span className="db-assigned-icon"><FileText size={18} /></span>
                    <div className="db-assigned-copy">
                      <strong>{assignment.mockTestName}</strong>
                      <span>{assignment.subject || assignment.examType || 'Mock test'} · {assignment.questionCount ?? '—'} questions · {assignment.duration} min</span>
                      <small><Clock3 size={13} /> {formatDate(assignment.startDateTime, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} – {formatDate(assignment.endDateTime, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small>
                    </div>
                    <span className="db-status-pill db-status-pill--assigned">{assignment.status}</span>
                  </article>
                ))}
              </div>
            ) : (
              <div className="db-empty-panel db-empty-panel--compact">
                <span>No mock tests have been assigned yet.</span>
              </div>
            )}
          </section>

          {dashboardError && (
            <div className="db-dashboard-error" role="alert">
              <span>Your performance data could not be refreshed. Cached or empty values may be shown.</span>
              <button type="button" onClick={onRetry}>Retry</button>
            </div>
          )}
          <footer className="db-footer"><span>CET NOVA · MHT-CET preparation</span><button type="button" onClick={openQr}><QrCode size={14} /> Phone QR</button></footer>
        </div>
      </main>
    </div>
  )
}
