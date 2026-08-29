import { useEffect, useState } from 'react'

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
  subjectWiseScores: Array<{ subject: string; score: number; maxScore: number; percentage: number }>
  strengths: string[]
  weaknesses: string[]
  aiFeedback: string
  canRetake: boolean
  hasPassed: boolean
  analyticsGrid?: React.ReactNode
}

export default function ExamResultDashboard({
  onClose,
  onBackToAnalysis,
  onRetakeExam,
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
}: ExamResultProps) {
  const [animatedScore, setAnimatedScore] = useState(0)
  const answeredQuestions = correctAnswers + wrongAnswers
  const totalQuestions = answeredQuestions + unansweredQuestions
  const answeredPercent = totalQuestions ? Math.round((answeredQuestions / totalQuestions) * 100) : 0
  const accuracy = answeredQuestions ? Math.round((correctAnswers / answeredQuestions) * 100) : 0
  const strongSubjects = strengths.length ? strengths : ['Build consistency']
  const weakSubjects = weaknesses.length ? weaknesses : ['Keep practicing']

  useEffect(() => {
    const start = performance.now()
    const duration = 1200
    const animate = (now: number) => {
      const progress = Math.min((now - start) / duration, 1)
      const easedProgress = 1 - Math.pow(1 - progress, 4)
      setAnimatedScore(Math.round(easedProgress * score))
      if (progress < 1) requestAnimationFrame(animate)
    }
    const frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [score])

  return (
    <div className="compact-result-root">
      <header className="compact-result-header">
        <div>
          <span className="compact-result-eyebrow">Test Completed</span>
          <h1>{examName}</h1>
          <p>Submitted on {new Date().toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' })}</p>
        </div>
        <button className="compact-result-back" onClick={onBackToAnalysis || onClose}>
          <span className="material-symbols-outlined">arrow_back</span>
          Back to Analysis
        </button>
      </header>

      <main className="compact-result-content">
        <section className="compact-result-score-panel">
          <span className="compact-result-label">Overall Score</span>
          <strong>{animatedScore}<small>/{maxScore.toFixed(0)}</small></strong>
          <span className={`compact-result-performance ${hasPassed ? 'is-pass' : 'is-fail'}`}>
            {percentage.toFixed(0)}% • {hasPassed ? 'Good Performance' : 'Needs Improvement'}
          </span>
          <p>Keep practicing to strengthen your performance across all subjects.</p>
        </section>

        <div className="compact-result-middle-grid">
          <section className="compact-result-card">
            <h2>Summary</h2>
            <div className="compact-summary-grid">
              <div><span className="summary-dot is-blue" />Attempted<strong>{answeredQuestions}</strong></div>
              <div><span className="summary-dot is-green" />Correct<strong>{correctAnswers}</strong></div>
              <div><span className="summary-dot is-red" />Incorrect<strong>{wrongAnswers}</strong></div>
              <div><span className="summary-dot is-amber" />Unanswered<strong>{unansweredQuestions}</strong></div>
              <div><span className="summary-dot is-purple" />Accuracy<strong>{accuracy}%</strong></div>
              <div><span className="summary-dot is-slate" />Time Taken<strong>{timeTaken}</strong></div>
            </div>
          </section>

          <section className="compact-result-card compact-analytics-card">
            <h2>Analytics</h2>
            <div className="compact-analytics-layout">
              <div className="compact-donut" style={{ '--correct': `${totalQuestions ? correctAnswers / totalQuestions * 100 : 0}%`, '--incorrect': `${totalQuestions ? wrongAnswers / totalQuestions * 100 : 0}%` } as React.CSSProperties}>
                <div><strong>{answeredPercent}%</strong><span>Answered</span></div>
              </div>
              <div className="compact-donut-legend">
                <span><i className="is-blue" />Correct <b>{correctAnswers}</b></span>
                <span><i className="is-red" />Incorrect <b>{wrongAnswers}</b></span>
                <span><i className="is-slate" />Skip <b>{unansweredQuestions}</b></span>
              </div>
              <div className="compact-time-analysis">
                <span>Time Analysis</span>
                <div><label>Avg. Time / Question</label><strong>{totalQuestions ? timeTaken : '00:00'}</strong></div>
                <div><label>Fastest Question</label><strong className="is-blue-text">{answeredQuestions ? 'Recorded' : '--'}</strong></div>
                <div><label>Slowest Question</label><strong className="is-red-text">{unansweredQuestions ? 'Unattempted' : '--'}</strong></div>
              </div>
            </div>
          </section>
        </div>

        <div className="compact-result-bottom-grid">
          <section className="compact-result-card compact-subject-card">
            <h2>Subject Performance</h2>
            {subjectWiseScores.map(subject => (
              <div className="compact-subject-row" key={subject.subject}>
                <div><span>{subject.subject}</span><strong>{subject.score.toFixed(0)}/{subject.maxScore.toFixed(0)}</strong></div>
                <div className="compact-subject-track"><span style={{ width: `${Math.max(0, Math.min(subject.percentage, 100))}%` }} /></div>
                <small>{subject.percentage >= 75 ? 'Strong' : subject.percentage >= 50 ? 'Good' : 'Needs focus'} · {subject.percentage.toFixed(0)}%</small>
              </div>
            ))}
          </section>

          <section className="compact-result-card compact-insights-card">
            <h2><span className="material-symbols-outlined">auto_awesome</span> AI Performance Insights</h2>
            <div className="compact-insights-columns">
              <div><b>Strengths</b>{strongSubjects.slice(0, 3).map(item => <span key={item}>◦ {item}</span>)}</div>
              <div><b>Needs Improvement</b>{weakSubjects.slice(0, 3).map(item => <span key={item}>◦ {item}</span>)}</div>
            </div>
            <p>{aiFeedback}</p>
          </section>
        </div>

        {analyticsGrid && <div className="compact-detailed-analytics">{analyticsGrid}</div>}

        <footer className="compact-result-actions">
          <button onClick={() => alert('Downloading result PDF...')}><span className="material-symbols-outlined">download</span>Download Result</button>
          {canRetake && <button onClick={onRetakeExam}><span className="material-symbols-outlined">replay</span>Retake Test</button>}
          <button className="is-primary" onClick={onClose}><span className="material-symbols-outlined">dashboard</span>Dashboard</button>
        </footer>
      </main>
      <div className="compact-result-footer">© 2026 CET Prep Pro. All Rights Reserved.</div>
    </div>
  )
}
