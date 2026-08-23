import { useState, useEffect } from 'react'

interface ExamSuccessProps {
  onClose: () => void
  onViewDashboard: () => void
  examName: string
  candidateName: string
  rollNumber: string
  submissionTime: string
  totalQuestions: number
  attemptedQuestions: number
  unansweredQuestions: number
  timeTaken: string
  confirmationId: string
}

export default function ExamSuccessPage({
  onClose,
  onViewDashboard,
  examName,
  candidateName,
  rollNumber,
  submissionTime,
  totalQuestions,
  attemptedQuestions,
  unansweredQuestions,
  timeTaken,
  confirmationId,
}: ExamSuccessProps) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    // Animate progress bar
    const timer = setTimeout(() => setProgress(100), 100)
    return () => clearTimeout(timer)
  }, [])

  const handleDownloadReceipt = () => {
    // TODO: Implement PDF download
    alert('Downloading submission receipt...')
  }

  const handleLogout = () => {
    // TODO: Implement logout
    onClose()
  }

  return (
    <div className="test-success-root">
      <div className="test-success-container">
        <div className="test-success-card">
          {/* Animated Checkmark */}
          <div className="test-success-checkmark">
            <span className="material-symbols-outlined test-success-checkmark-icon">check</span>
          </div>

          {/* Title and Message */}
          <h1 className="test-success-title">Exam Submitted Successfully!</h1>
          <p className="test-success-message">
            Your answers have been securely submitted. Thank you for completing the examination.
          </p>

          {/* Progress Bar */}
          <div className="test-success-progress">
            <div className="test-success-progress-bar" style={{ width: `${progress}%` }} />
          </div>

          {/* Exam Details Card */}
          <div className="test-success-details">
            <div className="test-success-detail-item">
              <p className="test-success-detail-label">Exam Name</p>
              <p className="test-success-detail-value">{examName}</p>
            </div>
            <div className="test-success-detail-item">
              <p className="test-success-detail-label">Candidate Name</p>
              <p className="test-success-detail-value">{candidateName}</p>
            </div>
            <div className="test-success-detail-item">
              <p className="test-success-detail-label">Roll Number</p>
              <p className="test-success-detail-value">{rollNumber}</p>
            </div>
            <div className="test-success-detail-item">
              <p className="test-success-detail-label">Submission Date & Time</p>
              <p className="test-success-detail-value">{submissionTime}</p>
            </div>
            <div className="test-success-detail-item">
              <p className="test-success-detail-label">Total Questions</p>
              <p className="test-success-detail-value">{totalQuestions}</p>
            </div>
            <div className="test-success-detail-item">
              <p className="test-success-detail-label">Attempted Questions</p>
              <p className="test-success-detail-value">{attemptedQuestions}</p>
            </div>
            <div className="test-success-detail-item">
              <p className="test-success-detail-label">Unanswered Questions</p>
              <p className="test-success-detail-value">{unansweredQuestions}</p>
            </div>
            <div className="test-success-detail-item">
              <p className="test-success-detail-label">Total Time Taken</p>
              <p className="test-success-detail-value">{timeTaken}</p>
            </div>
          </div>

          {/* Submission Status */}
          <div className="test-success-info">
            <p className="test-success-info-title">
              <span className="material-symbols-outlined">verified</span>
              Submission Status: Successfully Submitted
            </p>
            <ul className="test-success-info-list">
              <li><strong>Auto Saved:</strong> Your responses were auto-saved every 30 seconds</li>
              <li><strong>Confirmation ID:</strong> {confirmationId}</li>
              <li>Please save this confirmation ID for future reference</li>
            </ul>
          </div>

          {/* Information Card */}
          <div className="test-success-info" style={{ background: '#fef3c7', borderColor: '#fcd34d' }}>
            <p className="test-success-info-title" style={{ color: '#92400e' }}>
              <span className="material-symbols-outlined">info</span>
              Important Information
            </p>
            <ul className="test-success-info-list" style={{ color: '#78350f' }}>
              <li>Results will be announced after evaluation.</li>
              <li>You will receive an email and SMS notification when results are available.</li>
              <li>Keep your confirmation ID for future reference.</li>
            </ul>
          </div>

          {/* Action Buttons */}
          <div className="test-success-actions">
            <button className="test-success-btn test-success-btn--primary" onClick={onViewDashboard}>
              <span className="material-symbols-outlined">dashboard</span>
              View Dashboard
            </button>
            <button className="test-success-btn test-success-btn--secondary" onClick={handleDownloadReceipt}>
              <span className="material-symbols-outlined">download</span>
              Download Submission Receipt
            </button>
            <button className="test-success-btn test-success-btn--outline" onClick={handleLogout}>
              <span className="material-symbols-outlined">logout</span>
              Logout
            </button>
          </div>

          {/* Footer */}
          <div className="test-success-footer">
            <p className="test-success-footer-text">Thank you for participating.</p>
          </div>
        </div>
      </div>
    </div>
  )
}