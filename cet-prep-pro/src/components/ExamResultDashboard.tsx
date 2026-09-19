import React, { useEffect, useState, useMemo } from 'react'
import { Question } from '../lib/api'
import { MathRenderer } from '../lib/mathDisplay'
import FormattedSolution from './FormattedSolution'
import {
  generateResultAnalytics,
  generateQuestionExplanation,
  type AIAnalyticsData,
  type SubjectScoreItem,
} from '../lib/openrouter'
import { downloadCompleteSolutionBooklet, shareTestReport } from '../lib/exportUtils'

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
  const [expandedSolutions, setExpandedSolutions] = useState<Record<string, boolean>>({})

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

  return (
    <div className="compact-result-root" style={{ maxWidth: '1240px', margin: '0 auto', padding: '24px 20px 48px' }}>
      
      {/* ── Top Header ────────────────────────────────────────── */}
      <header className="compact-result-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <span className="compact-result-eyebrow" style={{ color: '#2563eb', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            Official Score Report & Diagnostic
          </span>
          <h1 style={{ margin: '4px 0', fontSize: '26px', fontWeight: 700, color: '#0f172a' }}>{examName}</h1>
          <p style={{ margin: 0, color: '#64748b', fontSize: '14px' }}>
            Candidate: <b>{candidateName}</b> {rollNumber && rollNumber !== 'N/A' ? `• Roll: ${rollNumber}` : ''} • Submitted on {new Date().toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => window.print()}
            style={{
              padding: '9px 16px',
              borderRadius: '8px',
              background: '#f1f5f9',
              border: '1px solid #cbd5e1',
              color: '#334155',
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
              background: '#2563eb',
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
      <nav style={{ display: 'flex', gap: '8px', marginBottom: '24px', borderBottom: '2px solid #e2e8f0', paddingBottom: '2px' }}>
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
              borderBottom: activeTab === tab.key ? '3px solid #2563eb' : '3px solid transparent',
              color: activeTab === tab.key ? '#2563eb' : '#64748b',
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
              <span style={{ fontSize: '11px', background: '#eff6ff', color: '#1d4ed8', padding: '2px 7px', borderRadius: '10px', fontWeight: 700, border: '1px solid #bfdbfe' }}>
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
          <section className="compact-result-score-panel" style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', color: '#fff', borderRadius: '16px', padding: '28px 32px', marginBottom: '24px', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'relative', zIndex: 2 }}>
              <span className="compact-result-label" style={{ color: '#94a3b8', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>
                Your Final Exam Score
              </span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', margin: '8px 0 12px' }}>
                <strong style={{ fontSize: '64px', fontWeight: 800, color: '#60a5fa', lineHeight: 1 }}>{animatedScore}</strong>
                <span style={{ fontSize: '24px', color: '#94a3b8' }}>/{maxScore.toFixed(0)}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
                <span className={`compact-result-performance ${hasPassed ? 'is-pass' : 'is-fail'}`} style={{ padding: '6px 14px', borderRadius: '20px', fontWeight: 600, fontSize: '13px', background: hasPassed ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)', color: hasPassed ? '#34d399' : '#f87171', border: `1px solid ${hasPassed ? '#059669' : '#dc2626'}` }}>
                  {percentage.toFixed(1)}% • {hasPassed ? 'Qualified for Engineering' : 'Needs Improvement'}
                </span>
                {aiAnalytics?.projectedPercentile && (
                  <span style={{ padding: '6px 14px', borderRadius: '20px', fontWeight: 600, fontSize: '13px', background: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd', border: '1px solid #3b82f6' }}>
                    Predicted CET Percentile: <b>{aiAnalytics.projectedPercentile}</b>
                  </span>
                )}
                {aiAnalytics?.estimatedCetRank && (
                  <span style={{ padding: '6px 14px', borderRadius: '20px', fontWeight: 600, fontSize: '13px', background: 'rgba(168, 85, 247, 0.2)', color: '#d8b4fe', border: '1px solid #a855f7' }}>
                    Estimated State Rank: <b>{aiAnalytics.estimatedCetRank}</b>
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* Middle Grid: Summary & Donut */}
          <div className="compact-result-middle-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', marginBottom: '24px' }}>
            <section className="compact-result-card" style={{ background: '#fff', borderRadius: '14px', padding: '24px', border: '1px solid #e2e8f0' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 16px', color: '#0f172a' }}>Attempt Breakdown</h2>
              <div className="compact-summary-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px' }}>
                <div style={{ background: '#eff6ff', padding: '12px 14px', borderRadius: '10px' }}>
                  <span className="summary-dot is-blue" />
                  <span style={{ color: '#64748b', fontSize: '13px' }}>Attempted</span>
                  <strong style={{ display: 'block', fontSize: '20px', color: '#1e40af' }}>{answeredQuestions}</strong>
                </div>
                <div style={{ background: '#f0fdf4', padding: '12px 14px', borderRadius: '10px' }}>
                  <span className="summary-dot is-green" />
                  <span style={{ color: '#64748b', fontSize: '13px' }}>Correct</span>
                  <strong style={{ display: 'block', fontSize: '20px', color: '#166534' }}>{correctAnswers}</strong>
                </div>
                <div style={{ background: '#fef2f2', padding: '12px 14px', borderRadius: '10px' }}>
                  <span className="summary-dot is-red" />
                  <span style={{ color: '#64748b', fontSize: '13px' }}>Incorrect</span>
                  <strong style={{ display: 'block', fontSize: '20px', color: '#991b1b' }}>{wrongAnswers}</strong>
                </div>
                <div style={{ background: '#fffbeb', padding: '12px 14px', borderRadius: '10px' }}>
                  <span className="summary-dot is-amber" />
                  <span style={{ color: '#64748b', fontSize: '13px' }}>Unanswered</span>
                  <strong style={{ display: 'block', fontSize: '20px', color: '#854d0e' }}>{unansweredQuestions}</strong>
                </div>
                <div style={{ background: '#faf5ff', padding: '12px 14px', borderRadius: '10px' }}>
                  <span className="summary-dot is-purple" />
                  <span style={{ color: '#64748b', fontSize: '13px' }}>Accuracy</span>
                  <strong style={{ display: 'block', fontSize: '20px', color: '#6b21a8' }}>{accuracy}%</strong>
                </div>
                <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '10px' }}>
                  <span className="summary-dot is-slate" />
                  <span style={{ color: '#64748b', fontSize: '13px' }}>Time Taken</span>
                  <strong style={{ display: 'block', fontSize: '20px', color: '#334155' }}>{timeTaken}</strong>
                </div>
              </div>
            </section>

            <section className="compact-result-card compact-analytics-card" style={{ background: '#fff', borderRadius: '14px', padding: '24px', border: '1px solid #e2e8f0' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 16px', color: '#0f172a' }}>Pacing & Efficiency</h2>
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
                  <div><label>Accuracy Ratio</label><strong style={{ color: accuracy >= 75 ? '#16a34a' : '#d97706' }}>{accuracy}% Accurate</strong></div>
                </div>
              </div>
            </section>
          </div>

          {/* Bottom Grid: Subject Breakdown & AI Summary */}
          <div className="compact-result-bottom-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', marginBottom: '24px' }}>
            <section className="compact-result-card compact-subject-card" style={{ background: '#fff', borderRadius: '14px', padding: '24px', border: '1px solid #e2e8f0' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 16px', color: '#0f172a' }}>Subject Performance</h2>
              {subjectWiseScores.map(subject => (
                <div className="compact-subject-row" key={subject.subject} style={{ marginBottom: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 600, color: '#1e293b' }}>{subject.subject}</span>
                    <strong style={{ color: '#0f172a' }}>{subject.score.toFixed(0)}/{subject.maxScore.toFixed(0)}</strong>
                  </div>
                  <div className="compact-subject-track" style={{ height: '8px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                    <span
                      style={{
                        display: 'block',
                        height: '100%',
                        borderRadius: '4px',
                        width: `${Math.max(0, Math.min(subject.percentage, 100))}%`,
                        background: subject.percentage >= 75 ? '#10b981' : subject.percentage >= 50 ? '#3b82f6' : '#f59e0b',
                      }}
                    />
                  </div>
                  <small style={{ color: '#64748b', display: 'block', marginTop: '4px' }}>
                    {subject.percentage >= 75 ? '🔥 Strong Area' : subject.percentage >= 50 ? '✅ Adequate' : '⚠️ Critical Focus Needed'} · {subject.percentage.toFixed(0)}%
                  </small>
                </div>
              ))}
            </section>

            <section className="compact-result-card compact-insights-card" style={{ background: '#fff', borderRadius: '14px', padding: '24px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="material-symbols-outlined" style={{ color: '#3b82f6' }}>auto_awesome</span>
                  AI Mentor Quick Summary
                </h2>
                <button
                  onClick={() => setActiveTab('aiCoach')}
                  style={{ background: '#eff6ff', color: '#1d4ed8', border: 'none', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                >
                  View Full Audit →
                </button>
              </div>
              <div className="compact-insights-columns" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
                <div style={{ background: '#f0fdf4', padding: '12px', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                  <b style={{ color: '#166534', display: 'block', marginBottom: '6px', fontSize: '13px' }}>Key Strengths</b>
                  {(aiAnalytics?.strengths || strongSubjects).slice(0, 3).map(item => (
                    <span key={item} style={{ display: 'block', fontSize: '12.5px', color: '#15803d', marginBottom: '3px' }}>✓ {item}</span>
                  ))}
                </div>
                <div style={{ background: '#fef2f2', padding: '12px', borderRadius: '8px', border: '1px solid #fecaca' }}>
                  <b style={{ color: '#991b1b', display: 'block', marginBottom: '6px', fontSize: '13px' }}>Needs Revision</b>
                  {(aiAnalytics?.weaknesses || weakSubjects).slice(0, 3).map(item => (
                    <span key={item} style={{ display: 'block', fontSize: '12.5px', color: '#b91c1c', marginBottom: '3px' }}>⚠ {item}</span>
                  ))}
                </div>
              </div>
              <p style={{ fontSize: '13.5px', lineHeight: 1.6, color: '#334155', margin: 0, fontStyle: 'italic' }}>
                "{aiAnalytics?.summaryDiagnosis || aiFeedback}"
              </p>
            </section>
          </div>

          {/* Question Grid Analytics */}
          {analyticsGrid && (
            <div className="compact-detailed-analytics" style={{ background: '#fff', borderRadius: '14px', padding: '24px', border: '1px solid #e2e8f0', marginBottom: '24px' }}>
              {analyticsGrid}
            </div>
          )}

          {/* Footer Actions */}
          <footer className="compact-result-actions" style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setActiveTab('solutions')}
              style={{ padding: '11px 20px', borderRadius: '8px', background: '#3b82f6', color: '#fff', border: 'none', fontWeight: 600, fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <span className="material-symbols-outlined">menu_book</span>
              Review Step-by-Step Solutions
            </button>
            {canRetake && (
              <button
                onClick={onRetakeExam}
                style={{ padding: '11px 20px', borderRadius: '8px', background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', fontWeight: 600, fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
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
        <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <div>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                OpenRouter AI Mentor Engine (GPT-4o)
              </span>
              <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', margin: '4px 0 0' }}>
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
                background: '#eff6ff',
                color: '#1d4ed8',
                border: '1px solid #bfdbfe',
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
              <span className="material-symbols-outlined spin" style={{ fontSize: '48px', color: '#3b82f6', marginBottom: '16px' }}>
                psychology
              </span>
              <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#1e293b', margin: '0 0 8px' }}>
                Analyzing your question patterns, pacing, and chapter accuracy...
              </h3>
              <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>
                Synthesizing personalized MHT-CET coaching advice powered by GPT-4o.
              </p>
            </div>
          ) : aiError && !aiAnalytics ? (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', padding: '24px', textAlign: 'center' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '36px', color: '#ef4444', marginBottom: '8px' }}>error</span>
              <h3 style={{ color: '#991b1b', margin: '0 0 8px', fontSize: '16px' }}>AI Analysis Unavailable</h3>
              <p style={{ color: '#7f1d1d', margin: '0 0 16px', fontSize: '14px' }}>{aiError}</p>
            </div>
          ) : (
            <div>
              {/* Executive Diagnosis Banner */}
              <div style={{ background: 'linear-gradient(to right, #eff6ff, #f0fdf4)', border: '1px solid #bfdbfe', borderRadius: '12px', padding: '20px 24px', marginBottom: '28px' }}>
                <h4 style={{ margin: '0 0 8px', fontSize: '15px', fontWeight: 700, color: '#1e3a8a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="material-symbols-outlined" style={{ color: '#2563eb' }}>verified</span>
                  Executive Academic Diagnosis
                </h4>
                <p style={{ margin: 0, fontSize: '15px', lineHeight: 1.7, color: '#1e293b' }}>
                  {aiAnalytics?.summaryDiagnosis}
                </p>
              </div>

              {/* State Rank & Percentile Projections */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginBottom: '28px' }}>
                <div style={{ background: '#f8fafc', borderRadius: '12px', padding: '20px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Projected CET Percentile</span>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: '#2563eb', margin: '6px 0 4px' }}>
                    {aiAnalytics?.projectedPercentile || `${((score / maxScore) * 100).toFixed(1)}%ile`}
                  </div>
                  <small style={{ color: '#64748b' }}>Estimated from standard MHT-CET normalization</small>
                </div>
                <div style={{ background: '#f8fafc', borderRadius: '12px', padding: '20px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Projected State Merit Rank</span>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: '#7c3aed', margin: '6px 0 4px' }}>
                    {aiAnalytics?.estimatedCetRank || 'Rank 3,000 - 6,000'}
                  </div>
                  <small style={{ color: '#64748b' }}>Across all Maharashtra applicants</small>
                </div>
                <div style={{ background: '#f8fafc', borderRadius: '12px', padding: '20px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Pacing & Speed Audit</span>
                  <div style={{ fontSize: '14.5px', fontWeight: 600, color: '#0f172a', margin: '8px 0 0', lineHeight: 1.5 }}>
                    {aiAnalytics?.speedAndAccuracyAnalysis || 'Maintain accurate calculations while increasing question cadence.'}
                  </div>
                </div>
              </div>

              {/* Strengths & Weaknesses Split Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginBottom: '32px' }}>
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '14px', padding: '22px' }}>
                  <h4 style={{ margin: '0 0 14px', fontSize: '16px', fontWeight: 700, color: '#166534', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-symbols-outlined">thumb_up</span>
                    Key Demonstrated Strengths
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.7, color: '#14532d', fontSize: '14px' }}>
                    {(aiAnalytics?.strengths || strongSubjects).map((s, idx) => (
                      <li key={idx} style={{ marginBottom: '6px' }}>{s}</li>
                    ))}
                  </ul>
                </div>

                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '14px', padding: '22px' }}>
                  <h4 style={{ margin: '0 0 14px', fontSize: '16px', fontWeight: 700, color: '#991b1b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-symbols-outlined">flag</span>
                    High-Impact Improvement Areas
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.7, color: '#7f1d1d', fontSize: '14px' }}>
                    {(aiAnalytics?.weaknesses || weakSubjects).map((w, idx) => (
                      <li key={idx} style={{ marginBottom: '6px' }}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Subject-Wise Action Plan */}
              {aiAnalytics?.actionPlan && aiAnalytics.actionPlan.length > 0 && (
                <div style={{ marginBottom: '32px' }}>
                  <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-symbols-outlined" style={{ color: '#2563eb' }}>rocket_launch</span>
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
                            border: `1px solid ${isHigh ? '#fca5a5' : isMed ? '#fde68a' : '#bfdbfe'}`,
                            borderRadius: '12px',
                            padding: '18px',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                            <span style={{ fontWeight: 700, fontSize: '15px', color: '#0f172a' }}>{plan.subject}</span>
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: '12px',
                                background: isHigh ? '#fef2f2' : isMed ? '#fefce8' : '#eff6ff',
                                color: isHigh ? '#dc2626' : isMed ? '#b45309' : '#1d4ed8',
                              }}
                            >
                              {plan.priority} Priority
                            </span>
                          </div>
                          <p style={{ fontSize: '13px', fontWeight: 600, color: '#475569', margin: '0 0 8px' }}>
                            🎯 Focus Chapter: <span style={{ color: '#0f172a' }}>{plan.focus}</span>
                          </p>
                          <p style={{ fontSize: '13.5px', color: '#334155', margin: 0, lineHeight: 1.5 }}>
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
                <div style={{ background: '#f8fafc', borderLeft: '4px solid #2563eb', padding: '16px 20px', borderRadius: '0 12px 12px 0' }}>
                  <b style={{ color: '#1e40af', display: 'block', marginBottom: '4px', fontSize: '13.5px' }}>
                    Mentor's Verdict & Motivational Note:
                  </b>
                  <p style={{ margin: 0, fontSize: '14.5px', color: '#334155', lineHeight: 1.6, fontStyle: 'italic' }}>
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
        <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', marginBottom: '24px' }}>
            <div>
              <h2 style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a', margin: '0 0 4px' }}>
                Complete Solution Booklet
              </h2>
              <p style={{ margin: 0, color: '#64748b', fontSize: '14px' }}>
                Detailed conceptual breakdowns and AI step-by-step solutions for every test question.
              </p>
              <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                <button
                  onClick={() => downloadCompleteSolutionBooklet(examName, questions, answers, aiSolutions)}
                  style={{
                    padding: '8px 16px', borderRadius: '8px', background: '#2563eb', color: '#fff',
                    border: 'none', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '6px'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>download</span>
                  Download Solutions Booklet
                </button>
                <button
                  onClick={() => shareTestReport(examName, score, maxScore, aiAnalytics?.projectedPercentile || String(percentage.toFixed(1)))}
                  style={{
                    padding: '8px 16px', borderRadius: '8px', background: '#f1f5f9', color: '#334155',
                    border: '1px solid #cbd5e1', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '6px'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>share</span>
                  Share Result
                </button>
              </div>
            </div>

            {/* Filter Pills */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
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
                    padding: '7px 14px',
                    borderRadius: '20px',
                    border: solutionFilter === f.key ? '1px solid #2563eb' : '1px solid #cbd5e1',
                    background: solutionFilter === f.key ? '#eff6ff' : '#f8fafc',
                    color: solutionFilter === f.key ? '#1d4ed8' : '#475569',
                    fontWeight: solutionFilter === f.key ? 700 : 500,
                    fontSize: '13px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {filteredQuestions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', background: '#f8fafc', borderRadius: '12px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '40px', color: '#94a3b8', marginBottom: '8px' }}>
                filter_list_off
              </span>
              <p style={{ color: '#64748b', fontSize: '15px', margin: 0 }}>
                No questions found under the "{solutionFilter}" filter.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {filteredQuestions.map(({ q, originalIndex, userAns, isCorrect, isIncorrect, isUnanswered }) => {
                const qKey = q._id || q.text.slice(0, 30)
                const isExpanded = expandedSolutions[qKey] || false
                const isLoadingAI = loadingAiQuestion[qKey] || false
                const aiSolutionText = aiSolutions[qKey]

                const correctLetter = String.fromCharCode(65 + Number(q.correctIndex ?? 0))
                const userLetter = userAns !== null && userAns !== undefined
                  ? String.fromCharCode(65 + Number(userAns))
                  : null

                return (
                  <div
                    key={qKey}
                    id={`question-card-${originalIndex}`}
                    style={{
                      border: `1px solid ${isIncorrect ? '#fca5a5' : isCorrect ? '#bbf7d0' : '#e2e8f0'}`,
                      borderRadius: '14px',
                      padding: '24px',
                      background: '#fff',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                    }}
                  >
                    {/* Header: Q Number, Badges, Status */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                          Q{originalIndex + 1}
                        </span>
                        <span style={{ fontSize: '12px', background: '#eff6ff', color: '#1d4ed8', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                          {q.subject || 'General'}
                        </span>
                        {q.topic && (
                          <span style={{ fontSize: '12px', background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: '6px' }}>
                            {q.topic}
                          </span>
                        )}
                        <span style={{ fontSize: '12px', color: '#64748b' }}>
                          +{q.marks || 1} {Number(q.negativeMarks || 0) > 0 ? `/ -${q.negativeMarks}` : '• No Negative Marking'}
                        </span>
                      </div>

                      {/* Result Pill */}
                      <div>
                        {isCorrect && (
                          <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#15803d', background: '#f0fdf4', border: '1px solid #86efac', padding: '4px 10px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>check_circle</span>
                            Correct (+{q.marks || 1})
                          </span>
                        )}
                        {isIncorrect && (
                          <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fca5a5', padding: '4px 10px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>cancel</span>
                            Incorrect {Number(q.negativeMarks || 0) > 0 ? `(-${q.negativeMarks})` : '(0)'}
                          </span>
                        )}
                        {isUnanswered && (
                          <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#854d0e', background: '#fffbeb', border: '1px solid #fde68a', padding: '4px 10px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>remove_circle_outline</span>
                            Unattempted (0)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Question Statement */}
                    <div style={{ fontSize: '15.5px', fontWeight: 500, color: '#0f172a', marginBottom: '18px', lineHeight: 1.6 }}>
                      <MathRenderer value={q.text} />
                    </div>

                    {/* Options List */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px', marginBottom: '20px' }}>
                      {q.options.map((opt, optIdx) => {
                        const isThisCorrect = optIdx === Number(q.correctIndex ?? 0)
                        const isThisUserAns = userAns !== null && optIdx === userAns

                        let border = '#e2e8f0'
                        let bg = '#f8fafc'
                        let badgeColor = '#64748b'

                        if (isThisCorrect) {
                          border = '#86efac'
                          bg = '#f0fdf4'
                          badgeColor = '#15803d'
                        } else if (isThisUserAns && !isThisCorrect) {
                          border = '#fca5a5'
                          bg = '#fef2f2'
                          badgeColor = '#b91c1c'
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
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14.5px', color: '#1e293b' }}>
                              <span style={{ fontWeight: 700, color: badgeColor, minWidth: '22px' }}>
                                {String.fromCharCode(65 + optIdx)})
                              </span>
                              <span><MathRenderer value={opt} /></span>
                            </div>
                            <div>
                              {isThisCorrect && (
                                <span style={{ color: '#16a34a', fontWeight: 700, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '2px' }}>
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
                    <div style={{ display: 'flex', gap: '24px', alignItems: 'center', padding: '10px 16px', background: '#f8fafc', borderRadius: '8px', marginBottom: '16px', fontSize: '13.5px' }}>
                      <div>
                        <span style={{ color: '#64748b', marginRight: '6px' }}>Correct Answer:</span>
                        <b style={{ color: '#16a34a' }}>Option {correctLetter}</b>
                      </div>
                      <div style={{ borderLeft: '1px solid #cbd5e1', height: '16px' }} />
                      <div>
                        <span style={{ color: '#64748b', marginRight: '6px' }}>Your Answer:</span>
                        {userLetter ? (
                          <b style={{ color: isCorrect ? '#16a34a' : '#dc2626' }}>
                            Option {userLetter} ({isCorrect ? 'Correct' : 'Wrong'})
                          </b>
                        ) : (
                          <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Not Attempted</span>
                        )}
                      </div>
                    </div>

                    {/* Author Solution (if available) */}
                    {q.solution && (
                      <div style={{ background: '#f1f5f9', borderRadius: '10px', padding: '14px 18px', marginBottom: '14px', borderLeft: '4px solid #3b82f6' }}>
                        <b style={{ color: '#1e40af', fontSize: '13.5px', display: 'block', marginBottom: '6px' }}>
                          Reference Solution:
                        </b>
                        <FormattedSolution content={q.solution} />
                      </div>
                    )}

                    {/* AI Step-by-Step Solution Section */}
                    {aiSolutionText && (
                      <div style={{ background: '#f8fafc', border: '1.5px solid #bfdbfe', borderRadius: '12px', padding: '20px', marginTop: '16px', position: 'relative' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                          <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#1e40af', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#2563eb' }}>auto_awesome</span>
                            GPT-4o Deep Step-by-Step Derivation & Strategy
                          </span>
                          <button
                            onClick={() => handleExplainQuestion(q, userAns)}
                            title="Regenerate"
                            style={{ background: 'transparent', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>refresh</span>
                            Re-solve
                          </button>
                        </div>
                        <FormattedSolution content={aiSolutionText} />
                      </div>
                    )}

                    {/* Action Bar */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '14px', borderTop: '1px solid #f1f5f9' }}>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        {!aiSolutionText && (
                          <button
                            onClick={() => handleExplainQuestion(q, userAns)}
                            disabled={isLoadingAI}
                            style={{
                              background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
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
                              boxShadow: '0 2px 4px rgba(37, 99, 235, 0.2)',
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
                              background: '#f8fafc',
                              border: '1px solid #cbd5e1',
                              color: '#475569',
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
