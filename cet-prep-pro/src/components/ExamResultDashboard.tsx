import { useState } from 'react'

interface ExamResultProps {
  onClose: () => void
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
  subjectWiseScores: Array<{
    subject: string
    score: number
    maxScore: number
    percentage: number
  }>
  strengths: string[]
  weaknesses: string[]
  aiFeedback: string
  canRetake: boolean
  hasPassed: boolean
  analyticsGrid?: React.ReactNode
}

export default function ExamResultDashboard({
  onClose,
  onRetakeExam,
  candidateName,
  rollNumber,
  examName,
  score,
  maxScore,
  percentage,
  passMark,
  rank,
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

  const handleDownloadCertificate = () => {
    if (hasPassed) {
      alert('Downloading certificate...')
    }
  }

  const handleDownloadResult = () => {
    alert('Downloading result PDF...')
  }

  return (
    <div className="test-result-root">
      {/* Header with Congratulations */}
      <div className="test-result-header">
        <div className="test-result-congrats">🎉</div>
        <h1>Congratulations, {candidateName}!</h1>
        <p>You have successfully completed the {examName}</p>
      </div>

      {/* Main Content */}
      <div className="test-result-main">
        {/* Candidate Profile Card */}
        <div className="test-result-profile">
          <div className="test-result-avatar">
            {candidateName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <div className="test-result-profile-info">
            <h2 className="test-result-profile-name">{candidateName}</h2>
            <p className="test-result-profile-details">
              Roll Number: {rollNumber} • {examName}
            </p>
          </div>
          {hasPassed ? (
            <span className="test-result-badge test-result-badge--pass">PASSED</span>
          ) : (
            <span className="test-result-badge test-result-badge--fail">FAILED</span>
          )}
        </div>

        {/* Score Overview Cards */}
        <div className="test-result-grid">
          <div className="test-result-stat-card">
            <p className="test-result-stat-label">Score</p>
            <p className="test-result-stat-value test-result-stat-value--score">
              {score}/{maxScore}
            </p>
            <p className="test-result-stat-value" style={{ fontSize: '18px', marginTop: '8px' }}>
              {percentage.toFixed(1)}%
            </p>
          </div>

          <div className="test-result-stat-card">
            <p className="test-result-stat-label">Percentage</p>
            <p className={`test-result-stat-value ${hasPassed ? 'test-result-stat-value--pass' : 'test-result-stat-value--fail'}`}>
              {percentage.toFixed(1)}%
            </p>
            <p style={{ fontSize: '14px', color: '#64748b', marginTop: '8px' }}>
              Pass Mark: {passMark}%
            </p>
          </div>

          {rank && (
            <div className="test-result-stat-card">
              <p className="test-result-stat-label">Rank</p>
              <p className="test-result-stat-value">#{rank}</p>
            </div>
          )}

          <div className="test-result-stat-card">
            <p className="test-result-stat-label">Time Taken</p>
            <p className="test-result-stat-value" style={{ fontSize: '28px' }}>{timeTaken}</p>
          </div>

          <div className="test-result-stat-card">
            <p className="test-result-stat-label">Correct Answers</p>
            <p className="test-result-stat-value test-result-stat-value--pass" style={{ fontSize: '28px' }}>
              {correctAnswers}
            </p>
          </div>

          <div className="test-result-stat-card">
            <p className="test-result-stat-label">Wrong Answers</p>
            <p className="test-result-stat-value test-result-stat-value--fail" style={{ fontSize: '28px' }}>
              {wrongAnswers}
            </p>
          </div>

          <div className="test-result-stat-card">
            <p className="test-result-stat-label">Unanswered</p>
            <p className="test-result-stat-value" style={{ fontSize: '28px', color: '#f59e0b' }}>
              {unansweredQuestions}
            </p>
          </div>
        </div>

        {/* Subject-wise Performance Chart */}
        <div className="test-result-chart-card" style={{ display: 'block', marginBottom: '24px' }}>
          <h3 className="test-result-chart-title" style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '20px' }}>Subject-wise Performance</h3>
          {subjectWiseScores && subjectWiseScores.length > 0 && subjectWiseScores.some(s => s.maxScore > 0) ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {subjectWiseScores.map((subject, index) => (
                <div key={index} style={{ display: 'block' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>{subject.subject}</span>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#2563eb' }}>
                      {subject.score.toFixed(1)}/{subject.maxScore.toFixed(1)} ({subject.percentage.toFixed(1)}%)
                    </span>
                  </div>
                  <div style={{ 
                    width: '100%', 
                    height: '16px', 
                    background: '#e5e7eb', 
                    borderRadius: '9999px', 
                    overflow: 'hidden',
                    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)'
                  }}>
                    <div
                      style={{
                        width: `${Math.max(subject.percentage, 0)}%`,
                        height: '100%',
                        background: subject.percentage >= 70 
                          ? 'linear-gradient(90deg, #10b981 0%, #059669 100%)'
                          : subject.percentage >= 40
                          ? 'linear-gradient(90deg, #f59e0b 0%, #d97706 100%)'
                          : 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)',
                        borderRadius: '9999px',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                        minWidth: subject.percentage > 0 ? '8px' : '0px'
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ textAlign: 'center', color: '#64748b', padding: '20px' }}>
              No subject-wise performance data available for this test.
            </p>
          )}
        </div>

        {/* Strengths & Weaknesses */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginBottom: '24px' }}>
          <div className="test-result-chart-card">
            <h3 className="test-result-chart-title" style={{ color: '#10b981' }}>
              <span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: '8px' }}>trending_up</span>
              Strengths
            </h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {strengths.map((strength, index) => (
                <li key={index} style={{ padding: '12px 0', borderBottom: index < strengths.length - 1 ? '1px solid #e2e8f0' : 'none', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span className="material-symbols-outlined" style={{ color: '#10b981' }}>check_circle</span>
                  <span style={{ fontSize: '14px', color: '#0f172a' }}>{strength}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="test-result-chart-card">
            <h3 className="test-result-chart-title" style={{ color: '#ef4444' }}>
              <span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: '8px' }}>trending_down</span>
              Areas to Improve
            </h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {weaknesses.map((weakness, index) => (
                <li key={index} style={{ padding: '12px 0', borderBottom: index < weaknesses.length - 1 ? '1px solid #e2e8f0' : 'none', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span className="material-symbols-outlined" style={{ color: '#ef4444' }}>arrow_upward</span>
                  <span style={{ fontSize: '14px', color: '#0f172a' }}>{weakness}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Analytics Grid */}
        {analyticsGrid}

        {/* AI Feedback */}
        <div className="test-result-chart-card" style={{ background: 'linear-gradient(135deg, #667eea15 0%, #764ba215 100%)', border: '2px solid #667eea30' }}>
          <h3 className="test-result-chart-title" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            <span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: '8px', WebkitTextFillColor: '#667eea' }}>auto_awesome</span>
            AI-Generated Feedback
          </h3>
          <p style={{ fontSize: '15px', lineHeight: '1.8', color: '#334155', margin: 0 }}>
            {aiFeedback}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="test-result-actions">
          <button className="test-success-btn test-success-btn--primary" onClick={onClose}>
            <span className="material-symbols-outlined">dashboard</span>
            Return to Dashboard
          </button>
          
          {hasPassed && (
            <button className="test-success-btn test-success-btn--secondary" onClick={handleDownloadCertificate}>
              <span className="material-symbols-outlined">card_membership</span>
              Download Certificate
            </button>
          )}

          <button className="test-success-btn test-success-btn--secondary" onClick={handleDownloadResult}>
            <span className="material-symbols-outlined">download</span>
            Download Result PDF
          </button>

          {canRetake && (
            <button className="test-success-btn test-success-btn--primary" onClick={onRetakeExam} style={{ background: '#10b981' }}>
              <span className="material-symbols-outlined">replay</span>
              Retake Exam
            </button>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="test-result-footer">
        <p className="test-result-footer-text">Thank you for participating. Best of luck for your future endeavors!</p>
      </div>
    </div>
  )
}