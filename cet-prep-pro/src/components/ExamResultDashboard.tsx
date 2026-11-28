import React, { useEffect, useState, useMemo, useRef } from 'react'
import { testsAPI, type Question, type TestResult } from '../lib/api'
import FormattedSolution from './FormattedSolution'
import RichQuestionContent from './RichQuestionContent'
import {
  generateResultAnalytics,
  generateQuestionExplanation,
  type AIAnalyticsData,
  type SubjectScoreItem,
} from '../lib/openrouter'
import { shareTestReport } from '../lib/exportUtils'
import { downloadSolutionsBookletPdf } from '../lib/solutionsBookletPdf'

interface ExamResultProps {
  onClose: () => void
  onBackToAnalysis?: () => void
  onRetakeExam: () => void
  candidateName: string
  rollNumber: string
  examName: string
  score: number
  maxScore: number
  percentage: number
  passMark: number
  rank?: number
  timeTaken: string
  correctAnswers: number
  wrongAnswers: number
  unansweredQuestions: number
  subjectWiseScores: SubjectScoreItem[]
  strengths: string[]
  weaknesses: string[]
  aiFeedback: string
  canRetake: boolean
  hasPassed: boolean
  analyticsGrid?: React.ReactNode
  questions?: Question[]
  answers?: Record<string, number | string>
  resultId?: string
  resultData?: TestResult | null
  testId?: string
  onSelectQuestion?: (index: number) => void
}

type TabKey = 'overview' | 'aiCoach' | 'solutions'
type SolutionFilter = 'all' | 'incorrect' | 'unattempted' | 'correct'

export default function ExamResultDashboard({
  onClose,
  onBackToAnalysis,
  onRetakeExam,
  candidateName,
  rollNumber,
  examName,
  score,
  maxScore,
  percentage,
  timeTaken,
  correctAnswers,
  wrongAnswers,
  unansweredQuestions,
  subjectWiseScores,
  strengths,
  weaknesses,
  aiFeedback,
  canRetake,
  hasPassed,
  analyticsGrid,
  questions = [],
  answers = {},
  resultId,
  resultData,
  testId,
  onSelectQuestion,
}: ExamResultProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [animatedScore, setAnimatedScore] = useState(0)

  // AI Analytics State
  const [aiAnalytics, setAiAnalytics] = useState<AIAnalyticsData | null>(null)
  const [loadingAi, setLoadingAi] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  // Solutions State
  const [solutionFilter, setSolutionFilter] = useState<SolutionFilter>('all')
  const [aiSolutions, setAiSolutions] = useState<Record<string, string>>({})
  const [loadingAiQuestion, setLoadingAiQuestion] = useState<Record<string, boolean>>({})
  const [downloadingBooklet, setDownloadingBooklet] = useState(false)
  const [bookletMessage, setBookletMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const bookletDownloadLock = useRef(false)

  const answeredQuestions = correctAnswers + wrongAnswers
  const totalQuestions = answeredQuestions + unansweredQuestions || questions.length || 1
  const answeredPercent = totalQuestions ? Math.round((answeredQuestions / totalQuestions) * 100) : 0
  const accuracy = answeredQuestions ? Math.round((correctAnswers / answeredQuestions) * 100) : 0
  const strongSubjects = strengths.length ? strengths : ['Mathematics consistency', 'Formula recall']
  const weakSubjects = weaknesses.length ? weaknesses : ['Time allocation on long numericals', 'Tricky option traps']

  // Score Animation
  useEffect(() => {
    const start = performance.now()
    const duration = 1000
    const animate = (now: number) => {
      const progress = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setAnimatedScore(Math.round(eased * score))
      if (progress < 1) requestAnimationFrame(animate)
    }
    const frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [score])

  // Fetch AI Analytics once on mount
  useEffect(() => {
    let isMounted = true
    const fetchAiAnalysis = async () => {
      setLoadingAi(true)
      setAiError(null)
      try {
        const data = await generateResultAnalytics({
          examName,
          score,
          maxScore,
          percentage,
          timeTaken,
          correctAnswers,
          wrongAnswers,
          unansweredQuestions,
          subjectWiseScores,
        })
        if (isMounted) setAiAnalytics(data)
      } catch (err) {
        if (isMounted) setAiError(err instanceof Error ? err.message : 'Could not generate AI diagnostic.')
      } finally {
        if (isMounted) setLoadingAi(false)
      }
    }

    fetchAiAnalysis()
    return () => { isMounted = false }
  }, [examName, score, maxScore, percentage, timeTaken, correctAnswers, wrongAnswers, unansweredQuestions, subjectWiseScores])

  // Handle single question AI explanation
  const handleExplainQuestion = async (q: Question, userAnsIdx: number | null) => {
    const qKey = q._id || q.text.slice(0, 30)
    setExpandedSolutions(prev => ({ ...prev, [qKey]: true }))

    if (aiSolutions[qKey]) return // Already cached in state

    setLoadingAiQuestion(prev => ({ ...prev, [qKey]: true }))
    try {
      const solutionText = await generateQuestionExplanation({
        questionId: q._id,
        text: q.text,
        options: q.options,
        correctIndex: q.correctIndex,
        userAnswerIndex: userAnsIdx,
        subject: q.subject,
        chapter: q.chapter,
        topic: q.topic,
        existingSolution: q.solution,
      })
      setAiSolutions(prev => ({ ...prev, [qKey]: solutionText }))
    } catch (err) {
      console.error('Failed to get AI solution:', err)
      setAiSolutions(prev => ({
        ...prev,
        [qKey]: 'Could not generate AI explanation. Please check your internet connection and try again.',
      }))
    } finally {
      setLoadingAiQuestion(prev => ({ ...prev, [qKey]: false }))
    }
  }

  // Filter questions for the solutions tab
  const filteredQuestions = useMemo(() => {
    if (!questions.length) return []
    return questions.map((q, idx) => {
      const userAns = answers[q._id] !== undefined ? Number(answers[q._id]) : null
      const isCorrect = userAns !== null && userAns === Number(q.correctIndex ?? 0)
      const isUnanswered = userAns === null || userAns === undefined
      const isIncorrect = !isUnanswered && !isCorrect
      return { q, originalIndex: idx, userAns, isCorrect, isIncorrect, isUnanswered }
    }).filter(item => {
      if (solutionFilter === 'incorrect') return item.isIncorrect
      if (solutionFilter === 'unattempted') return item.isUnanswered
      if (solutionFilter === 'correct') return item.isCorrect
      return true
    })
  }, [questions, answers, solutionFilter])

  const handleDownloadBooklet = async () => {
    if (bookletDownloadLock.current) return
    bookletDownloadLock.current = true
    setDownloadingBooklet(true)
    setBookletMessage(null)
    try {
      if (!resultId) throw new Error('This test result cannot be identified for secure booklet generation.')
      const review = await testsAPI.getReview(resultId)
      if (!review.questions.length) throw new Error('No questions are available for this test result.')
      await downloadSolutionsBookletPdf({
        testName: examName,
        testId: testId || resultData?.mockTestId || resultId,
        candidateName,
        rollNumber,
        result: review.result,
        questions: review.questions,
      })
      setBookletMessage({ type: 'success', text: 'Solutions booklet downloaded successfully.' })
    } catch (error) {
      console.error('Failed to generate solutions booklet:', error)
      setBookletMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Could not generate the solutions booklet. Please try again.',
      })
    } finally {
      bookletDownloadLock.current = false
      setDownloadingBooklet(false)
    }
  }

  return (
    <div className="compact-result-root" style={{ maxWidth: '1240px', margin: '0 auto', padding: '24px 20px 48px' }}>
      
      {/* ── Top Header ────────────────────────────────────────── */}
      <header className="compact-result-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <span className="compact-result-eyebrow" style={{ color: 'var(--color-primary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            Official Score Report & Diagnostic
          </span>
          <h1 style={{ margin: '4px 0', fontSize: '26px', fontWeight: 700, color: 'var(--color-text-primary)' }}>{examName}</h1>
          <p style={{ margin: 0, color: 'var(--color-text-primary)', fontSize: '14px' }}>
            Candidate: <b>{candidateName}</b> {rollNumber && rollNumber !== 'N/A' ? `• Roll: ${rollNumber}` : ''} • Submitted on {new Date().toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => window.print()}
            style={{
              padding: '9px 16px',
              borderRadius: '8px',
              background: '#ffffff',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 600,
              fontSize: '13.5px',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>print</span>
            Print / PDF
          </button>
          <button
            className="compact-result-back"
            onClick={onBackToAnalysis || onClose}
            style={{
              padding: '9px 16px',
              borderRadius: '8px',
              background: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 600,
              fontSize: '13.5px',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>dashboard</span>
            Back to Dashboard
          </button>
        </div>
      </header>

      {/* ── Tabs Navigation Bar ───────────────────────────────── */}
      <nav className="exam-result-tabs-nav" style={{ display: 'flex', gap: '8px', marginBottom: '24px', borderBottom: '2px solid var(--color-border)', paddingBottom: '2px' }}>
        {[
          { key: 'overview', label: 'Overview & Scorecard', icon: 'analytics' },
          { key: 'aiCoach', label: 'AI Diagnostic Coach', icon: 'psychology', badge: 'AI Powered' },
          { key: 'solutions', label: `Step-by-Step Solutions (${questions.length || totalQuestions})`, icon: 'menu_book' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as TabKey)}
            style={{
              padding: '12px 18px',
              border: 'none',
              background: 'transparent',
              borderBottom: activeTab === tab.key ? '3px solid var(--color-primary)' : '3px solid transparent',
              color: activeTab === tab.key ? 'var(--color-primary)' : 'var(--color-text-primary)',
              fontWeight: activeTab === tab.key ? 700 : 500,
              fontSize: '14.5px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.15s ease',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '19px' }}>{tab.icon}</span>
            <span>{tab.label}</span>
            {tab.badge && (
              <span style={{ fontSize: '11px', background: '#ffffff', color: 'var(--color-text-primary)', padding: '2px 7px', borderRadius: '10px', fontWeight: 700, border: '1px solid var(--color-border)' }}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* ── TAB 1: OVERVIEW & SCORECARD ──────────────────────── */}
      {activeTab === 'overview' && (
        <main className="compact-result-content">
          {/* Score & Key Metric Banner */}
          <section className="compact-result-score-panel" style={{ background: 'linear-gradient(135deg, var(--color-primary-hover) 0%, var(--color-primary-hover) 100%)', color: '#fff', borderRadius: '16px', padding: '28px 32px', marginBottom: '24px', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'relative', zIndex: 2 }}>
              <span className="compact-result-label" style={{ color: 'var(--color-text-primary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>
                Your Final Exam Score
              </span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', margin: '8px 0 12px' }}>
                <strong style={{ fontSize: '64px', fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1 }}>{animatedScore}</strong>
                <span style={{ fontSize: '24px', color: 'var(--color-text-primary)' }}>/{maxScore.toFixed(0)}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
                <span className={`compact-result-performance ${hasPassed ? 'is-pass' : 'is-fail'}`} style={{ padding: '6px 14px', borderRadius: '20px', fontWeight: 600, fontSize: '13px', background: hasPassed ? 'rgba(22,160,133, 0.2)' : 'rgba(220, 38, 38, 0.2)', color: hasPassed ? '#16a085' : '#dc2626', border: `1px solid ${hasPassed ? '#16a085' : '#dc2626'}` }}>
                  {percentage.toFixed(1)}% • {hasPassed ? 'Qualified for Engineering' : 'Needs Improvement'}
                </span>
                {aiAnalytics?.projectedPercentile && (
                  <span style={{ padding: '6px 14px', borderRadius: '20px', fontWeight: 600, fontSize: '13px', background: 'rgba(var(--color-primary-rgb), 0.2)', color: 'var(--color-text-primary)', border: '1px solid var(--color-primary)' }}>
                    Predicted CET Percentile: <b>{aiAnalytics.projectedPercentile}</b>
                  </span>
                )}
                {aiAnalytics?.estimatedCetRank && (
                  <span style={{ padding: '6px 14px', borderRadius: '20px', fontWeight: 600, fontSize: '13px', background: 'rgba(var(--color-primary-rgb), 0.2)', color: 'var(--color-surface-secondary)', border: '1px solid var(--color-primary)' }}>
                    Estimated State Rank: <b>{aiAnalytics.estimatedCetRank}</b>
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* Middle Grid: Summary & Donut */}
          <div className="compact-result-middle-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', marginBottom: '24px' }}>
            <section className="compact-result-card" style={{ background: '#fff', borderRadius: '14px', padding: '24px', border: '1px solid var(--color-border)' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 16px', color: 'var(--color-text-primary)' }}>Attempt Breakdown</h2>
              <div className="compact-summary-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px' }}>
                <div style={{ background: '#ffffff', padding: '12px 14px', borderRadius: '10px' }}>
                  <span className="summary-dot is-blue" />
                  <span style={{ color: 'var(--color-text-primary)', fontSize: '13px' }}>Attempted</span>
                  <strong style={{ display: 'block', fontSize: '20px', color: 'var(--color-primary)' }}>{answeredQuestions}</strong>
                </div>
                <div style={{ background: '#ffffff', padding: '12px 14px', borderRadius: '10px' }}>
                  <span className="summary-dot is-green" />
                  <span style={{ color: 'var(--color-text-primary)', fontSize: '13px' }}>Correct</span>
                  <strong style={{ display: 'block', fontSize: '20px', color: '#16a085' }}>{correctAnswers}</strong>
                </div>
                <div style={{ background: 'var(--color-surface-secondary)', padding: '12px 14px', borderRadius: '10px' }}>
                  <span className="summary-dot is-red" />
                  <span style={{ color: 'var(--color-text-primary)', fontSize: '13px' }}>Incorrect</span>
                  <strong style={{ display: 'block', fontSize: '20px', color: '#dc2626' }}>{wrongAnswers}</strong>
                </div>
                <div style={{ background: 'var(--color-surface-secondary)', padding: '12px 14px', borderRadius: '10px' }}>
                  <span className="summary-dot is-amber" />
                  <span style={{ color: 'var(--color-text-primary)', fontSize: '13px' }}>Unanswered</span>
                  <strong style={{ display: 'block', fontSize: '20px', color: 'var(--color-primary)' }}>{unansweredQuestions}</strong>
                </div>
                <div style={{ background: 'var(--color-surface-secondary)', padding: '12px 14px', borderRadius: '10px' }}>
                  <span className="summary-dot is-purple" />
                  <span style={{ color: 'var(--color-text-primary)', fontSize: '13px' }}>Accuracy</span>
                  <strong style={{ display: 'block', fontSize: '20px', color: 'var(--color-primary)' }}>{accuracy}%</strong>
                </div>
                <div style={{ background: '#ffffff', padding: '12px 14px', borderRadius: '10px' }}>
                  <span className="summary-dot is-slate" />
                  <span style={{ color: 'var(--color-text-primary)', fontSize: '13px' }}>Time Taken</span>
                  <strong style={{ display: 'block', fontSize: '20px', color: 'var(--color-text-primary)' }}>{timeTaken}</strong>
                </div>
              </div>
            </section>

            <section className="compact-result-card compact-analytics-card" style={{ background: '#fff', borderRadius: '14px', padding: '24px', border: '1px solid var(--color-border)' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 16px', color: 'var(--color-text-primary)' }}>Pacing & Efficiency</h2>
              <div className="compact-analytics-layout">
                <div className="compact-donut" style={{ '--correct': `${totalQuestions ? (correctAnswers / totalQuestions) * 100 : 0}%`, '--incorrect': `${totalQuestions ? (wrongAnswers / totalQuestions) * 100 : 0}%` } as React.CSSProperties}>
                  <div><strong>{answeredPercent}%</strong><span>Attempt Rate</span></div>
                </div>
                <div className="compact-donut-legend">
                  <span><i className="is-blue" />Correct: <b>{correctAnswers}</b></span>
                  <span><i className="is-red" />Incorrect: <b>{wrongAnswers}</b></span>
                  <span><i className="is-slate" />Skipped: <b>{unansweredQuestions}</b></span>
                </div>
                <div className="compact-time-analysis">
                  <span>Time Assessment</span>
                  <div><label>Total Duration</label><strong>{timeTaken}</strong></div>
                  <div><label>Avg. Time / Question</label><strong>{answeredQuestions > 0 ? `${(resultDurationMinutes(timeTaken) / answeredQuestions).toFixed(1)} min` : '--'}</strong></div>
                  <div><label>Accuracy Ratio</label><strong style={{ color: accuracy >= 75 ? '#16a085' : 'var(--color-primary)' }}>{accuracy}% Accurate</strong></div>
                </div>
              </div>
            </section>
          </div>

          {/* Bottom Grid: Subject Breakdown & AI Summary */}
          <div className="compact-result-bottom-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', marginBottom: '24px' }}>
            <section className="compact-result-card compact-subject-card" style={{ background: '#fff', borderRadius: '14px', padding: '24px', border: '1px solid var(--color-border)' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 16px', color: 'var(--color-text-primary)' }}>Subject Performance</h2>
              {subjectWiseScores.map(subject => (
                <div className="compact-subject-row" key={subject.subject} style={{ marginBottom: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{subject.subject}</span>
                    <strong style={{ color: 'var(--color-text-primary)' }}>{subject.score.toFixed(0)}/{subject.maxScore.toFixed(0)}</strong>
                  </div>
                  <div className="compact-subject-track" style={{ height: '8px', background: '#ffffff', borderRadius: '4px', overflow: 'hidden' }}>
                    <span
                      style={{
                        display: 'block',
                        height: '100%',
                        borderRadius: '4px',
                        width: `${Math.max(0, Math.min(subject.percentage, 100))}%`,
                        background: subject.percentage >= 75 ? '#16a085' : subject.percentage >= 50 ? 'var(--color-primary)' : 'var(--color-primary)',
                      }}
                    />
                  </div>
                  <small style={{ color: 'var(--color-text-primary)', display: 'block', marginTop: '4px' }}>
                    {subject.percentage >= 75 ? '🔥 Strong Area' : subject.percentage >= 50 ? '✅ Adequate' : '⚠️ Critical Focus Needed'} · {subject.percentage.toFixed(0)}%
                  </small>
                </div>
              ))}
            </section>

            <section className="compact-result-card compact-insights-card" style={{ background: '#fff', borderRadius: '14px', padding: '24px', border: '1px solid var(--color-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)' }}>auto_awesome</span>
                  AI Mentor Quick Summary
                </h2>
                <button
                  onClick={() => setActiveTab('aiCoach')}
                  style={{ background: '#ffffff', color: 'var(--color-text-primary)', border: 'none', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                >
                  View Full Audit →
                </button>
              </div>
              <div className="compact-insights-columns" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
                <div style={{ background: '#ffffff', padding: '12px', borderRadius: '8px', border: '1px solid #ffffff' }}>
                  <b style={{ color: '#16a085', display: 'block', marginBottom: '6px', fontSize: '13px' }}>Key Strengths</b>
                  {(aiAnalytics?.strengths || strongSubjects).slice(0, 3).map(item => (
                    <span key={item} style={{ display: 'block', fontSize: '12.5px', color: '#16a085', marginBottom: '3px' }}>✓ {item}</span>
                  ))}
                </div>
                <div style={{ background: 'var(--color-surface-secondary)', padding: '12px', borderRadius: '8px', border: '1px solid var(--color-surface-secondary)' }}>
                  <b style={{ color: '#dc2626', display: 'block', marginBottom: '6px', fontSize: '13px' }}>Needs Revision</b>
                  {(aiAnalytics?.weaknesses || weakSubjects).slice(0, 3).map(item => (
                    <span key={item} style={{ display: 'block', fontSize: '12.5px', color: '#dc2626', marginBottom: '3px' }}>⚠ {item}</span>
                  ))}
                </div>
              </div>
              <p style={{ fontSize: '13.5px', lineHeight: 1.6, color: 'var(--color-text-primary)', margin: 0, fontStyle: 'italic' }}>
                "{aiAnalytics?.summaryDiagnosis || aiFeedback}"
              </p>
            </section>
          </div>

          {/* Question Grid Analytics */}
          {analyticsGrid && (
            <div className="compact-detailed-analytics" style={{ background: '#fff', borderRadius: '14px', padding: '24px', border: '1px solid var(--color-border)', marginBottom: '24px' }}>
              {analyticsGrid}
            </div>
          )}

          {/* Footer Actions */}
          <footer className="compact-result-actions" style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setActiveTab('solutions')}
              style={{ padding: '11px 20px', borderRadius: '8px', background: 'var(--color-primary)', color: '#fff', border: 'none', fontWeight: 600, fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <span className="material-symbols-outlined">menu_book</span>
              Review Step-by-Step Solutions
            </button>
            {canRetake && (
              <button
                onClick={onRetakeExam}
                style={{ padding: '11px 20px', borderRadius: '8px', background: '#ffffff', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)', fontWeight: 600, fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <span className="material-symbols-outlined">replay</span>
                Retake Test
              </button>
            )}
          </footer>
        </main>
      )}

      {/* ── TAB 2: AI DIAGNOSTIC COACH ───────────────────────── */}
      {activeTab === 'aiCoach' && (
        <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid var(--color-border)', padding: '32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <div>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                OpenRouter AI Mentor Engine (GPT-4o)
              </span>
              <h2 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-text-primary)', margin: '4px 0 0' }}>
                Deep Performance Audit & Action Plan
              </h2>
            </div>
            <button
              onClick={() => {
                setLoadingAi(true)
                generateResultAnalytics(
                  { examName, score, maxScore, percentage, timeTaken, correctAnswers, wrongAnswers, unansweredQuestions, subjectWiseScores },
                  true
                ).then(res => setAiAnalytics(res)).catch(e => setAiError(e.message)).finally(() => setLoadingAi(false))
              }}
              disabled={loadingAi}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                background: '#ffffff',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border)',
                fontWeight: 600,
                fontSize: '13px',
                cursor: loadingAi ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span className={`material-symbols-outlined ${loadingAi ? 'spin' : ''}`} style={{ fontSize: '18px' }}>
                sync
              </span>
              {loadingAi ? 'Analyzing...' : 'Refresh AI Analysis'}
            </button>
          </div>

          {loadingAi && !aiAnalytics ? (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <span className="material-symbols-outlined spin" style={{ fontSize: '48px', color: 'var(--color-primary)', marginBottom: '16px' }}>
                psychology
              </span>
              <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 8px' }}>
                Analyzing your question patterns, pacing, and chapter accuracy...
              </h3>
              <p style={{ color: 'var(--color-text-primary)', fontSize: '14px', margin: 0 }}>
                Synthesizing personalized MHT-CET coaching advice powered by GPT-4o.
              </p>
            </div>
          ) : aiError && !aiAnalytics ? (
            <div style={{ background: 'var(--color-surface-secondary)', border: '1px solid var(--color-surface-secondary)', borderRadius: '12px', padding: '24px', textAlign: 'center' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '36px', color: '#dc2626', marginBottom: '8px' }}>error</span>
              <h3 style={{ color: '#dc2626', margin: '0 0 8px', fontSize: '16px' }}>AI Analysis Unavailable</h3>
              <p style={{ color: '#dc2626', margin: '0 0 16px', fontSize: '14px' }}>{aiError}</p>
            </div>
          ) : (
            <div>
              {/* Executive Diagnosis Banner */}
              <div style={{ background: 'linear-gradient(to right, #ffffff, #ffffff)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '20px 24px', marginBottom: '28px' }}>
                <h4 style={{ margin: '0 0 8px', fontSize: '15px', fontWeight: 700, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)' }}>verified</span>
                  Executive Academic Diagnosis
                </h4>
                <p style={{ margin: 0, fontSize: '15px', lineHeight: 1.7, color: 'var(--color-text-primary)' }}>
                  {aiAnalytics?.summaryDiagnosis}
                </p>
              </div>

              {/* State Rank & Percentile Projections */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginBottom: '28px' }}>
                <div style={{ background: '#ffffff', borderRadius: '12px', padding: '20px', border: '1px solid var(--color-border)' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-primary)', textTransform: 'uppercase' }}>Projected CET Percentile</span>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--color-primary)', margin: '6px 0 4px' }}>
                    {aiAnalytics?.projectedPercentile || `${((score / maxScore) * 100).toFixed(1)}%ile`}
                  </div>
                  <small style={{ color: 'var(--color-text-primary)' }}>Estimated from standard MHT-CET normalization</small>
                </div>
                <div style={{ background: '#ffffff', borderRadius: '12px', padding: '20px', border: '1px solid var(--color-border)' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-primary)', textTransform: 'uppercase' }}>Projected State Merit Rank</span>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--color-primary)', margin: '6px 0 4px' }}>
                    {aiAnalytics?.estimatedCetRank || 'Rank 3,000 - 6,000'}
                  </div>
                  <small style={{ color: 'var(--color-text-primary)' }}>Across all Maharashtra applicants</small>
                </div>
                <div style={{ background: '#ffffff', borderRadius: '12px', padding: '20px', border: '1px solid var(--color-border)' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-primary)', textTransform: 'uppercase' }}>Pacing & Speed Audit</span>
                  <div style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--color-text-primary)', margin: '8px 0 0', lineHeight: 1.5 }}>
                    {aiAnalytics?.speedAndAccuracyAnalysis || 'Maintain accurate calculations while increasing question cadence.'}
                  </div>
                </div>
              </div>

              {/* Strengths & Weaknesses Split Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginBottom: '32px' }}>
                <div style={{ background: '#ffffff', border: '1px solid #ffffff', borderRadius: '14px', padding: '22px' }}>
                  <h4 style={{ margin: '0 0 14px', fontSize: '16px', fontWeight: 700, color: '#16a085', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-symbols-outlined">thumb_up</span>
                    Key Demonstrated Strengths
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.7, color: '#16a085', fontSize: '14px' }}>
                    {(aiAnalytics?.strengths || strongSubjects).map((s, idx) => (
                      <li key={idx} style={{ marginBottom: '6px' }}>{s}</li>
                    ))}
                  </ul>
                </div>

                <div style={{ background: 'var(--color-surface-secondary)', border: '1px solid var(--color-surface-secondary)', borderRadius: '14px', padding: '22px' }}>
                  <h4 style={{ margin: '0 0 14px', fontSize: '16px', fontWeight: 700, color: '#dc2626', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-symbols-outlined">flag</span>
                    High-Impact Improvement Areas
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.7, color: '#dc2626', fontSize: '14px' }}>
                    {(aiAnalytics?.weaknesses || weakSubjects).map((w, idx) => (
                      <li key={idx} style={{ marginBottom: '6px' }}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Subject-Wise Action Plan */}
              {aiAnalytics?.actionPlan && aiAnalytics.actionPlan.length > 0 && (
                <div style={{ marginBottom: '32px' }}>
                  <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)' }}>rocket_launch</span>
                    Tailored 7-Day High-Yield Revision Plan
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                    {aiAnalytics.actionPlan.map((plan, idx) => {
                      const isHigh = plan.priority === 'High'
                      const isMed = plan.priority === 'Medium'
                      return (
                        <div
                          key={idx}
                          style={{
                            background: '#fff',
                            border: `1px solid ${isHigh ? 'var(--color-surface-secondary)' : isMed ? 'var(--color-surface-secondary)' : 'var(--color-border)'}`,
                            borderRadius: '12px',
                            padding: '18px',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                            <span style={{ fontWeight: 700, fontSize: '15px', color: 'var(--color-text-primary)' }}>{plan.subject}</span>
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: '12px',
                                background: isHigh ? 'var(--color-surface-secondary)' : isMed ? 'var(--color-surface-secondary)' : '#ffffff',
                                color: isHigh ? '#dc2626' : isMed ? 'var(--color-primary)' : 'var(--color-text-primary)',
                              }}
                            >
                              {plan.priority} Priority
                            </span>
                          </div>
                          <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 8px' }}>
                            🎯 Focus Chapter: <span style={{ color: 'var(--color-text-primary)' }}>{plan.focus}</span>
                          </p>
                          <p style={{ fontSize: '13.5px', color: 'var(--color-text-primary)', margin: 0, lineHeight: 1.5 }}>
                            {plan.action}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Coach Verdict Callout */}
              {aiAnalytics?.coachVerdict && (
                <div style={{ background: '#ffffff', borderLeft: '4px solid var(--color-primary)', padding: '16px 20px', borderRadius: '0 12px 12px 0' }}>
                  <b style={{ color: 'var(--color-primary)', display: 'block', marginBottom: '4px', fontSize: '13.5px' }}>
                    Mentor's Verdict & Motivational Note:
                  </b>
                  <p style={{ margin: 0, fontSize: '14.5px', color: 'var(--color-text-primary)', lineHeight: 1.6, fontStyle: 'italic' }}>
                    "{aiAnalytics.coachVerdict}"
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 3: STEP-BY-STEP SOLUTIONS ─────────────────────── */}
      {activeTab === 'solutions' && (
        <div style={{ background: '#ffffff', borderRadius: '18px', border: '1px solid #ffffff', boxShadow: '0 8px 20px rgba(var(--color-text-primary-rgb), 0.04)', padding: '20px 18px 18px', maxWidth: '760px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '14px', marginBottom: '18px' }}>
            <div style={{ flex: 1, minWidth: '240px' }}>
              <h2 style={{ fontSize: '30px', fontWeight: 800, color: 'var(--color-text-primary)', margin: '0 0 8px', lineHeight: 1.1 }}>
                Complete Solution Booklet
              </h2>
              <p style={{ margin: 0, color: 'var(--color-text-primary)', fontSize: '15px', maxWidth: '520px', lineHeight: 1.5 }}>
                Detailed conceptual breakdowns and AI step-by-step solutions for every test question.
              </p>
              <div style={{ display: 'flex', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => void handleDownloadBooklet()}
                  disabled={downloadingBooklet}
                  style={{
                    padding: '12px 18px', borderRadius: '10px', background: 'var(--color-primary)', color: '#fff',
                    border: 'none', fontWeight: 700, fontSize: '14px', cursor: downloadingBooklet ? 'wait' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 6px 18px rgba(var(--color-primary-rgb), 0.18)'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>{downloadingBooklet ? 'hourglass_top' : 'download'}</span>
                  {downloadingBooklet ? 'Generating Solutions Booklet...' : 'Download Solutions Booklet'}
                </button>
                <button
                  onClick={() => shareTestReport(examName, score, maxScore, aiAnalytics?.projectedPercentile || String(percentage.toFixed(1)))}
                  style={{
                    padding: '12px 18px', borderRadius: '10px', background: '#ffffff', color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border)', fontWeight: 700, fontSize: '14px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '8px'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>share</span>
                  Share Result
                </button>
              </div>
              {bookletMessage && (
                <p role={bookletMessage.type === 'error' ? 'alert' : 'status'} style={{
                  margin: '10px 0 0',
                  color: bookletMessage.type === 'error' ? '#dc2626' : '#16a085',
                  fontSize: '13px',
                  fontWeight: 700,
                }}>
                  {bookletMessage.text}
                </p>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end', alignContent: 'flex-start' }}>
              {[
                { key: 'all', label: `All (${questions.length})` },
                { key: 'incorrect', label: `❌ Mistakes (${wrongAnswers})`, count: wrongAnswers },
                { key: 'unattempted', label: `⚪ Unattempted (${unansweredQuestions})`, count: unansweredQuestions },
                { key: 'correct', label: `✅ Correct (${correctAnswers})`, count: correctAnswers },
              ].map(f => (
                <button
                  key={f.key}
                  onClick={() => setSolutionFilter(f.key as SolutionFilter)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '999px',
                    border: solutionFilter === f.key ? '1px solid var(--color-primary)' : '1px solid #ffffff',
                    background: solutionFilter === f.key ? '#ffffff' : '#ffffff',
                    color: solutionFilter === f.key ? 'var(--color-text-primary)' : 'var(--color-text-primary)',
                    fontWeight: solutionFilter === f.key ? 700 : 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    boxShadow: solutionFilter === f.key ? 'inset 0 0 0 1px rgba(var(--color-primary-rgb), 0.08)' : 'none',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {filteredQuestions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', background: '#ffffff', borderRadius: '12px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '40px', color: 'var(--color-text-primary)', marginBottom: '8px' }}>
                filter_list_off
              </span>
              <p style={{ color: 'var(--color-text-primary)', fontSize: '15px', margin: 0 }}>
                No questions found under the "{solutionFilter}" filter.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {filteredQuestions.map(({ q, originalIndex, userAns, isCorrect, isIncorrect, isUnanswered }) => {
                const qKey = q._id || q.text.slice(0, 30)
                const isLoadingAI = loadingAiQuestion[qKey] || false
                const aiSolutionText = aiSolutions[qKey]
                const isExpanded = Boolean(aiSolutionText)

                const correctLetter = String.fromCharCode(65 + Number(q.correctIndex ?? 0))
                const userLetter = userAns !== null && userAns !== undefined
                  ? String.fromCharCode(65 + Number(userAns))
                  : null

                return (
                  <div
                    key={qKey}
                    id={`question-card-${originalIndex}`}
                    style={{
                      border: `1px solid ${isIncorrect ? 'var(--color-surface-secondary)' : isCorrect ? '#ffffff' : 'var(--color-surface-secondary)'}`,
                      borderRadius: '14px',
                      padding: '18px',
                      background: '#fff',
                      boxShadow: '0 1px 3px rgba(var(--color-text-primary-rgb), 0.03)',
                    }}
                  >
                    {/* Header: Q Number, Badges, Status */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '18px', fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1 }}>
                          Q{originalIndex + 1}
                        </span>
                        <span style={{ fontSize: '12px', background: '#ffffff', color: 'var(--color-text-primary)', padding: '4px 8px', borderRadius: '6px', fontWeight: 700 }}>
                          {q.subject || 'General'}
                        </span>
                        {q.topic && (
                          <span style={{ fontSize: '12px', background: '#ffffff', color: 'var(--color-text-primary)', padding: '4px 8px', borderRadius: '6px', fontWeight: 600 }}>
                            {q.topic}
                          </span>
                        )}
                        <span style={{ fontSize: '12px', color: 'var(--color-text-primary)', fontWeight: 600 }}>
                          +{q.marks || 1}
                          {Number(q.negativeMarks || 0) > 0 ? ` / -${q.negativeMarks}` : ' / 0'}
                        </span>
                      </div>

                      {/* Result Pill */}
                      <div>
                        {isCorrect && (
                          <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#16a085', background: '#ffffff', border: '1px solid #ffffff', padding: '4px 10px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>check_circle</span>
                            Correct (+{q.marks || 1})
                          </span>
                        )}
                        {isIncorrect && (
                          <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#dc2626', background: 'var(--color-surface-secondary)', border: '1px solid var(--color-surface-secondary)', padding: '4px 10px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>cancel</span>
                            Incorrect {Number(q.negativeMarks || 0) > 0 ? `(-${q.negativeMarks})` : '(0)'}
                          </span>
                        )}
                        {isUnanswered && (
                          <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--color-primary)', background: 'var(--color-surface-secondary)', border: '1px solid var(--color-surface-secondary)', padding: '4px 10px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>remove_circle_outline</span>
                            Unattempted (0)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Question Statement */}
                    <div style={{ fontSize: '15.5px', fontWeight: 500, color: 'var(--color-text-primary)', marginBottom: '18px', lineHeight: 1.6, minWidth: 0, overflowWrap: 'anywhere' }}>
                      <RichQuestionContent content={q.text} />
                    </div>

                    {/* Options List */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px', marginBottom: '20px' }}>
                      {q.options.map((opt, optIdx) => {
                        const isThisCorrect = optIdx === Number(q.correctIndex ?? 0)
                        const isThisUserAns = userAns !== null && optIdx === userAns

                        let border = 'var(--color-border)'
                        let bg = '#ffffff'
                        let badgeColor = 'var(--color-text-primary)'

                        if (isThisCorrect) {
                          border = '#ffffff'
                          bg = '#ffffff'
                          badgeColor = '#16a085'
                        } else if (isThisUserAns && !isThisCorrect) {
                          border = 'var(--color-surface-secondary)'
                          bg = 'var(--color-surface-secondary)'
                          badgeColor = '#dc2626'
                        }

                        return (
                          <div
                            key={optIdx}
                            style={{
                              border: `1.5px solid ${border}`,
                              background: bg,
                              borderRadius: '10px',
                              padding: '12px 14px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '12px',
                              minWidth: 0,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14.5px', color: 'var(--color-text-primary)', minWidth: 0, overflowWrap: 'anywhere' }}>
                              <span style={{ fontWeight: 700, color: badgeColor, minWidth: '22px' }}>
                                {String.fromCharCode(65 + optIdx)})
                              </span>
                              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}><RichQuestionContent content={opt} /></span>
                            </div>
                            <div>
                              {isThisCorrect && (
                                <span style={{ color: '#16a085', fontWeight: 700, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '2px' }}>
                                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>check</span> Correct
                                </span>
                              )}
                              {isThisUserAns && !isThisCorrect && (
                                <span style={{ color: '#dc2626', fontWeight: 700, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '2px' }}>
                                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span> Your Pick
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Answer Comparison Summary */}
                    <div style={{ display: 'flex', gap: '24px', alignItems: 'center', padding: '10px 16px', background: '#ffffff', borderRadius: '8px', marginBottom: '16px', fontSize: '13.5px' }}>
                      <div>
                        <span style={{ color: 'var(--color-text-primary)', marginRight: '6px' }}>Correct Answer:</span>
                        <b style={{ color: '#16a085' }}>Option {correctLetter}</b>
                      </div>
                      <div style={{ borderLeft: '1px solid var(--color-border)', height: '16px' }} />
                      <div>
                        <span style={{ color: 'var(--color-text-primary)', marginRight: '6px' }}>Your Answer:</span>
                        {userLetter ? (
                          <b style={{ color: isCorrect ? '#16a085' : '#dc2626' }}>
                            Option {userLetter} ({isCorrect ? 'Correct' : 'Wrong'})
                          </b>
                        ) : (
                          <span style={{ color: 'var(--color-text-primary)', fontStyle: 'italic' }}>Not Attempted</span>
                        )}
                      </div>
                    </div>

                    {/* Author Solution (if available) */}
                    {q.solution && (
                      <div style={{ background: '#ffffff', borderRadius: '10px', padding: '14px 18px', marginBottom: '14px', borderLeft: '4px solid var(--color-primary)' }}>
                        <b style={{ color: 'var(--color-primary)', fontSize: '13.5px', display: 'block', marginBottom: '6px' }}>
                          Reference Solution:
                        </b>
                        <FormattedSolution content={q.solution} />
                      </div>
                    )}

                    {/* AI Step-by-Step Solution Section */}
                    {aiSolutionText && (
                      <div style={{ background: '#ffffff', border: '1.5px solid var(--color-border)', borderRadius: '12px', padding: '20px', marginTop: '16px', position: 'relative' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                          <span style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--color-primary)' }}>auto_awesome</span>
                            GPT-4o Deep Step-by-Step Derivation & Strategy
                          </span>
                          <button
                            onClick={() => handleExplainQuestion(q, userAns)}
                            title="Regenerate"
                            style={{ background: 'transparent', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>refresh</span>
                            Re-solve
                          </button>
                        </div>
                        <FormattedSolution content={aiSolutionText} />
                      </div>
                    )}

                    {/* Action Bar */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '14px', borderTop: '1px solid #ffffff' }}>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        {!aiSolutionText && (
                          <button
                            onClick={() => handleExplainQuestion(q, userAns)}
                            disabled={isLoadingAI}
                            style={{
                              background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-hover) 100%)',
                              color: '#fff',
                              border: 'none',
                              padding: '8px 16px',
                              borderRadius: '8px',
                              fontWeight: 600,
                              fontSize: '13px',
                              cursor: isLoadingAI ? 'wait' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              boxShadow: '0 2px 4px rgba(var(--color-primary-rgb), 0.2)',
                            }}
                          >
                            <span className={`material-symbols-outlined ${isLoadingAI ? 'spin' : ''}`} style={{ fontSize: '18px' }}>
                              {isLoadingAI ? 'sync' : 'auto_awesome'}
                            </span>
                            {isLoadingAI ? 'Generating AI Derivation...' : '✨ Step-by-Step AI Solution'}
                          </button>
                        )}
                        {onSelectQuestion && (
                          <button
                            onClick={() => onSelectQuestion(originalIndex)}
                            style={{
                              background: '#ffffff',
                              border: '1px solid var(--color-border)',
                              color: 'var(--color-text-primary)',
                              padding: '8px 14px',
                              borderRadius: '8px',
                              fontSize: '13px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>open_in_new</span>
                            Open in Test Mode
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* CSS Animation helper */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  )
}

function resultDurationMinutes(timeStr: string): number {
  if (!timeStr) return 0
  const hoursMatch = timeStr.match(/(\d+)\s*h/)
  const minsMatch = timeStr.match(/(\d+)\s*m/)
  const secsMatch = timeStr.match(/(\d+)\s*s/)
  let total = 0
  if (hoursMatch) total += Number(hoursMatch[1]) * 60
  if (minsMatch) total += Number(minsMatch[1])
  if (secsMatch) total += Number(secsMatch[1]) / 60
  return total || 1
}
