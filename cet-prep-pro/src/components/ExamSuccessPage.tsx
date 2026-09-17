import { useEffect, useRef } from 'react'
import lottie from 'lottie-web'
import successAnimation from '../assets/success.json'

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
  const animationContainer = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!animationContainer.current) return
    const animation = lottie.loadAnimation({
      container: animationContainer.current,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      animationData: successAnimation,
    })

    return () => animation.destroy()
  }, [])

  return (
    <div className="test-success-root">
      <div className="test-success-container">
        <div className="test-success-card">
          <div ref={animationContainer} className="test-success-animation" aria-hidden="true" />
          <h1 className="test-success-title">Exam Submitted Successfully!</h1>
          <p className="test-success-message">
            Your answers have been securely submitted. You can view your result under the Results section.
          </p>
          <p className="test-success-confirmation">Confirmation ID: {confirmationId}</p>
          <div className="test-success-actions">
            <button className="test-success-btn test-success-btn--primary" onClick={onViewDashboard}>
              <span className="material-symbols-outlined">analytics</span>
              View Results
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}