import { useState, useEffect, useMemo, useRef } from 'react'
import { questionsAPI, usersAPI, testsAPI, session, Question } from '../lib/api'
import { MathRenderer } from '../lib/mathDisplay'
import ExamSuccessPage from './ExamSuccessPage'
import ExamResultDashboard from './ExamResultDashboard'
import '../testInterface.css'

// Check if running in production mode
const isProductionMode = import.meta.env.VITE_PRODUCTION_MODE === 'true'

export default function TestInterface({ 
  onClose, 
  onResultSaved,
  reviewMode = false, 
  pastAnswers, 
  pastResultData 
}: { 
  onClose: () => void; 
  onResultSaved?: (result: any) => void;
  reviewMode?: boolean;
  pastAnswers?: Record<string, number>;
  pastResultData?: any;
}) {
  // Generate demo questions function must be defined before useState
  const generateDemoQuestions = (): Question[] => {
    return [
      {
        _id: 'demo-1',
        subject: 'Physics',
        topic: 'Mechanics',
        text: 'A body of mass 5 kg is moving with a velocity of 10 m/s. What is its kinetic energy?',
        options: ['250 J', '500 J', '100 J', '50 J'],
        correctIndex: 0,
        marks: 2,
        negativeMarks: 0.5,
        difficulty: 'Easy',
        isActive: true,
      },
      {
        _id: 'demo-2',
        subject: 'Chemistry',
        topic: 'Atomic Structure',
        text: 'What is the atomic number of Carbon?',
        options: ['6', '8', '12', '14'],
        correctIndex: 0,
        marks: 2,
        negativeMarks: 0.5,
        difficulty: 'Easy',
        isActive: true,
      },
      {
        _id: 'demo-3',
        subject: 'Mathematics',
        topic: 'Calculus',
        text: 'What is the derivative of x²?',
        options: ['2x', 'x', 'x²/2', '2'],
        correctIndex: 0,
        marks: 2,
        negativeMarks: 0.5,
        difficulty: 'Easy',
        isActive: true,
      },
    ]
  }

  // Start with demo questions immediately to prevent blank screen
  const [questions, setQuestions] = useState<Question[]>(() => generateDemoQuestions())
  const [loading, setLoading] = useState(false) // Start false since we have demo questions
  const [error, setError] = useState<string | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, number>>(pastAnswers || {}) // questionId -> selected option index
  const [marked, setMarked] = useState<Record<string, boolean>>({})
  const [timeRemaining, setTimeRemaining] = useState(2 * 60 * 60) // 2 hours in seconds
  const [timeElapsed, setTimeElapsed] = useState(0) // Track actual elapsed time
  const [submitted, setSubmitted] = useState(reviewMode)
  const [result, setResult] = useState<{
    total: number
    answered: number
    marked: number
    notAnswered: number
    correct: number
    incorrect: number
    score: number
    maxScore: number
    duration: number
  } | null>(pastResultData || null)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [activeQ, setActiveQ] = useState<number | null>(null)
  const [showSuccessPage, setShowSuccessPage] = useState(false)
  const [showResultPage, setShowResultPage] = useState(reviewMode)
  const [confirmationId, setConfirmationId] = useState<string>('')
  const [user, setUser] = useState<{ name: string; mhcetId?: string; email: string } | null>(null)

  // Load user data on mount
  useEffect(() => {
    const loadUser = async () => {
      try {
        const userData = await usersAPI.me()
        console.log('User data loaded:', userData)
        // Accept any valid user data, even if incomplete
        if (userData && (userData.name || userData.email)) {
          setUser({
            name: userData.name || 'Student',
            mhcetId: userData.mhcetId,
            email: userData.email,
          })
        } else {
          console.warn('User data invalid:', userData)
          // Set minimal fallback to prevent N/A
          setUser({
            name: 'Student',
            mhcetId: undefined,
            email: '',
          })
        }
      } catch (error) {
        console.error('Failed to load user data:', error)
        // Set fallback user data so the page doesn't show N/A
        setUser({
          name: 'Student',
          mhcetId: undefined,
          email: '',
        })
      }
    }
    loadUser()
  }, [])

  // Start test when component mounts
  useEffect(() => {
    console.log('TestInterface mounted, questions loaded:', questions.length)
  }, [])

  const getQuestionResultState = (index: number) => {
    try {
      const q = questions[index]
      if (!q) return 'unattempted'
      const selected = answers[q._id]
      if (selected === undefined) {
        // Check if marked for review
        if (marked[q._id]) return 'review'
        return 'unattempted'
      }
      if (selected === q.correctIndex) return 'correct'
      return 'incorrect'
    } catch (err) {
      console.error('Error in getQuestionResultState:', err)
      return 'unattempted'
    }
  }

  const calculateResult = () => {
    const total = questions.length
    const answered = Object.keys(answers).length
    const markedCount = Object.values(marked).filter(Boolean).length
    const notAnswered = total - answered
    let correct = 0
    let incorrect = 0
    let score = 0
    let maxScore = 0

    questions.forEach(question => {
      maxScore += question.marks
      const selected = answers[question._id]
      if (selected === undefined) return
      if (selected === question.correctIndex) {
        correct += 1
        score += question.marks
      } else {
        incorrect += 1
        score -= question.negativeMarks
      }
    })

    return {
      total,
      answered,
      marked: markedCount,
      notAnswered,
      correct,
      incorrect,
      score: Math.max(score, 0),
      maxScore,
      duration: timeElapsed, // Use actual elapsed time
    }
  }

  const submitTest = async () => {
    const resultData = calculateResult()
    setResult(resultData)
    setSubmitted(true)
    
    // Calculate percentile (simple implementation based on score percentage)
    const percentile = resultData.maxScore > 0 ? ((resultData.score / resultData.maxScore) * 100) : 0
    
    const subjectWiseMap = new Map<string, { correct: number, total: number, marks: number, maxMarks: number }>()
    questions.forEach(q => {
      const subjectName = q.subject || 'General'
      const selected = answers[q._id]
      const existing = subjectWiseMap.get(subjectName) || { correct: 0, total: 0, marks: 0, maxMarks: 0 }
      existing.total += 1
      existing.maxMarks += q.marks
      if (selected === q.correctIndex) {
        existing.correct += 1
        existing.marks += q.marks
      } else if (selected !== undefined) {
        existing.marks = Math.max(0, existing.marks - q.negativeMarks)
      }
      subjectWiseMap.set(subjectName, existing)
    })
    const subjectWisePayload = Array.from(subjectWiseMap.entries()).map(([subject, data]) => ({
      subject: subject || 'General',
      score: data.marks,
      maxScore: data.maxMarks,
      percentage: data.maxMarks > 0 ? (data.marks / data.maxMarks) * 100 : 0
    })).filter(s => s.maxScore > 0)
    
    // Save test result to backend
    try {
      const savedResult = await testsAPI.submitResult({
        testName: 'MHT-CET Mock Test',
        subject: 'Mock Test',
        score: resultData.score,
        totalMarks: resultData.maxScore,
        percentile: percentile,
        duration: resultData.duration,
        subjectWiseScores: subjectWisePayload,
        answers: answers,
        correct: resultData.correct,
        incorrect: resultData.incorrect,
        unanswered: resultData.notAnswered,
        totalQuestions: resultData.total,
      })
      onResultSaved?.(savedResult)
    } catch (error) {
      console.error('Failed to save test result:', error)
    }
    
    // Exit fullscreen when test is submitted
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen().catch(() => {})
    }
    
    // Generate confirmation ID once and store it
    const newConfirmationId = `CONF-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`
    setConfirmationId(newConfirmationId)
    
    // Ensure user data is loaded - wait up to 5 seconds
    const startTime = Date.now()
    while (!user && Date.now() - startTime < 5000) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    // If user is still null after waiting, try loading it now
    if (!user) {
      try {
        const userData = await usersAPI.me()
        if (userData && userData._id) {
          setUser({
            name: userData.name,
            mhcetId: userData.mhcetId,
            email: userData.email,
          })
        } else {
          console.error('Invalid user data received:', userData)
          // Still don't show fallback - show error state
          setUser(null)
        }
      } catch (error) {
        console.error('Failed to load user data on submit:', error)
        setUser(null)
      }
    }
    
    // Final check - only show success page if we have user data
    if (user) {
      setShowSuccessPage(true)
    } else {
      console.error('Cannot show success page - no user data available')
      // Show error or keep on test page
      return
    }
    
  }

  const startTest = async () => {
    // Skip fullscreen for now to avoid issues
    console.log('Test started')
  }

  const handleViewResults = () => {
    setShowSuccessPage(false)
    setShowResultPage(true)
  }

  const handleRetakeExam = () => {
    // Reset all state for retake
    setAnswers({})
    setMarked({})
    setTimeRemaining(2 * 60 * 60)
    setTimeElapsed(0)
    setSubmitted(false)
    setResult(null)
    setShowSuccessPage(false)
    setShowResultPage(false)
    setCurrentIndex(0)
    setActiveQ(null)
    setConfirmationId('')
  }

  // Load questions and user data in background (demo questions already loaded)
  useEffect(() => {
    const load = async () => {
      try {
        console.log('Loading questions from API...')
        const data = await questionsAPI.getAll({ isActive: true })
        console.log('Questions loaded from API:', data.length)
        
        // If API returns questions, use them
        if (data.length > 0) {
          setQuestions(data)
          setError(null)
        } else {
          console.warn('No questions from API, keeping demo questions')
        }
      } catch (e) {
        console.error('Failed to load questions from API:', e)
        console.warn('Keeping demo questions')
        // Demo questions already loaded, no need to do anything
      }
    }
    
    // Load in background after a short delay
    const timeout = setTimeout(() => {
      load().catch(err => console.error('Error in load questions:', err))
    }, 100)
    
    return () => clearTimeout(timeout)
  }, [])


  // Timer
  useEffect(() => {
    if (loading) return
    const timer = setInterval(() => {
      setTimeRemaining(t => {
        if (t > 0) {
          const newTime = t - 1
          // Also track elapsed time
          setTimeElapsed(e => e + 1)
          return newTime
        }
        clearInterval(timer)
        return 0
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [loading])

  const formatTime = (seconds: number) => {
    try {
      const h = Math.floor(seconds / 3600)
      const m = Math.floor((seconds % 3600) / 60)
      const s = seconds % 60
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    } catch (err) {
      console.error('Error in formatTime:', err)
      return '00:00:00'
    }
  }

  const currentQuestion = questions[currentIndex]

  const selectOption = (index: number) => {
    if (!currentQuestion) return
    setAnswers(prev => ({ ...prev, [currentQuestion._id]: index }))
  }

  const toggleMarked = () => {
    if (!currentQuestion) return
    setMarked(prev => ({ ...prev, [currentQuestion._id]: !prev[currentQuestion._id] }))
  }

  const isCurrentMarked = currentQuestion ? marked[currentQuestion._id] : false

  const openLightbox = (imageUrl: string) => {
    setLightboxImage(imageUrl)
    setLightboxOpen(true)
  }

  const closeLightbox = () => {
    setLightboxOpen(false)
    setLightboxImage(null)
  }

  const getQuestionState = (index: number) => {
    try {
      const q = questions[index]
      if (!q) return 'unvisited'
      if (index === currentIndex) return 'current'
      if (answers[q._id] !== undefined) return 'answered'
      if (marked[q._id]) return 'marked'
      return 'not-answered'
    } catch (err) {
      console.error('Error in getQuestionState:', err)
      return 'unvisited'
    }
  }

  // All hooks must be called at the top before any conditional returns
  // Calculate subject-wise scores with useMemo to prevent recalculation
  const subjectWiseScores = useMemo(() => {
    if (!showResultPage || !result) return []
    
    const subjectWiseMap = new Map<string, { correct: number; total: number; marks: number; maxMarks: number }>()
    
    questions.forEach(q => {
      const subjectName = q.subject?.trim() || 'General'
      const selected = answers[q._id]
      const existing = subjectWiseMap.get(subjectName) || { correct: 0, total: 0, marks: 0, maxMarks: 0 }
      
      existing.total += 1
      existing.maxMarks += q.marks
      
      if (selected === q.correctIndex) {
        existing.correct += 1
        existing.marks += q.marks
      } else if (selected !== undefined) {
        existing.marks = Math.max(0, existing.marks - q.negativeMarks)
      }
      
      subjectWiseMap.set(subjectName, existing)
    })

    return Array.from(subjectWiseMap.entries()).map(([subject, data]) => ({
      subject: subject || 'General',
      score: data.marks,
      maxScore: data.maxMarks,
      percentage: data.maxMarks > 0 ? (data.marks / data.maxMarks) * 100 : 0
    })).filter(s => s.maxScore > 0) // Only show subjects with questions
  }, [showResultPage, result, questions, answers])

  // Conditional returns after all hooks are called
  if (error) {
    return (
      <div style={{ 
        position: 'fixed', 
        inset: 0, 
        background: '#f8fafc', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        zIndex: 99999
      }}>
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <h2 style={{ fontSize: '24px', color: '#dc2626', marginBottom: '16px' }}>Something went wrong</h2>
          <p style={{ color: '#64748b', marginBottom: '24px' }}>{error}</p>
          <button onClick={onClose} style={{ padding: '12px 24px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
            Go Back
          </button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ 
        position: 'fixed', 
        top: 0, 
        left: 0, 
        right: 0, 
        bottom: 0, 
        background: '#f8fafc', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        zIndex: 99999,
        width: '100vw',
        height: '100vh'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ 
            width: '80px', 
            height: '80px', 
            border: '4px solid #e2e8f0', 
            borderTopColor: '#2563eb', 
            borderRadius: '50%', 
            animation: 'spin 1s linear infinite',
            margin: '0 auto 24px'
          }} />
          <div style={{ fontSize: '20px', fontWeight: 600, color: '#0f172a', marginBottom: '8px' }}>Loading Test Questions...</div>
          <p style={{ fontSize: '14px', color: '#64748b' }}>Please wait while we prepare your test</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    )
  }

  if (questions.length === 0) {
    return (
      <div style={{ 
        position: 'fixed', 
        inset: 0, 
        background: '#f8fafc', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        zIndex: 99999,
        minHeight: '100vh'
      }}>
        <div style={{ textAlign: 'center', padding: '40px', maxWidth: '500px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '80px', color: '#ef4444', marginBottom: '24px', display: 'block' }}>error</span>
          <h2 style={{ fontSize: '28px', fontWeight: 700, color: '#0f172a', marginBottom: '12px' }}>Unable to Load Test</h2>
          <p style={{ fontSize: '16px', color: '#64748b', marginBottom: '32px', lineHeight: 1.6 }}>No questions available at the moment. Please check your internet connection and try again.</p>
          <button 
            onClick={onClose}
            style={{ 
              padding: '14px 32px', 
              background: '#2563eb', 
              color: 'white', 
              border: 'none', 
              borderRadius: '12px', 
              fontSize: '16px', 
              fontWeight: 600, 
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)'
            }}
          >
            Go Back
          </button>
        </div>
      </div>
    )
  }

  if (showSuccessPage && result) {
    // Only show if we have user data
    if (!user) {
      return (
        <div style={{ 
          position: 'fixed', 
          inset: 0, 
          background: '#f8fafc', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          zIndex: 99999 
        }}>
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '60px', color: '#ef4444', marginBottom: '20px', display: 'block' }}>error</span>
            <h2 style={{ fontSize: '24px', fontWeight: 600, color: '#0f172a', marginBottom: '12px' }}>Unable to Load User Data</h2>
            <p style={{ color: '#64748b', marginBottom: '24px' }}>Please check your connection and try again.</p>
            <button onClick={onClose} style={{ padding: '12px 24px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
              Go Back
            </button>
          </div>
        </div>
      )
    }

    return (
      <ExamSuccessPage
        onClose={onClose}
        onViewDashboard={handleViewResults}
        examName="MHT-CET Mock Test"
        candidateName={user.name}
        rollNumber={user.mhcetId || 'N/A'}
        submissionTime={new Date().toLocaleString()}
        totalQuestions={result.total}
        attemptedQuestions={result.answered}
        unansweredQuestions={result.notAnswered}
        timeTaken={formatTime(result.duration)}
        confirmationId={confirmationId}
      />
    )
  }

  if (showResultPage && result) {
    const percentage = result.maxScore > 0 ? (result.score / result.maxScore) * 100 : 0
    const hasPassed = percentage >= 50 // Assuming 50% is pass mark

    // Identify strengths and weaknesses
    const strengths = subjectWiseScores
      .filter(s => s.percentage >= 70)
      .map(s => s.subject)
    
    const weaknesses = subjectWiseScores
      .filter(s => s.percentage < 50)
      .map(s => s.subject)

    // Generate AI feedback
    let aiFeedback = ''
    if (percentage >= 80) {
      aiFeedback = 'Excellent performance! You have demonstrated strong understanding across multiple subjects. Keep up the great work!'
    } else if (percentage >= 60) {
      aiFeedback = 'Good performance! You have a solid foundation. Focus on improving your weak areas to achieve better scores.'
    } else if (percentage >= 50) {
      aiFeedback = 'You have passed the exam. However, there is room for improvement. Review the topics you found challenging.'
    } else {
      aiFeedback = 'You did not meet the passing criteria. We recommend revisiting fundamental concepts and practicing more questions.'
    }

    const analyticsGridContent = (
      <div className="test-qgrid-card" style={{ marginBottom: '24px' }}>
        <div className="test-qgrid-header">
          <div>
            <h2 className="test-qgrid-title">Question-by-Question Analytics</h2>
            <p className="test-qgrid-sub">Click any box to view the detailed question and solution.</p>
          </div>
          <div className="test-qlegend">
            <div className="test-ql-item">
              <span className="test-ql-box test-ql-box--correct" />
              <span>Correct</span>
            </div>
            <div className="test-ql-item">
              <span className="test-ql-box test-ql-box--incorrect" />
              <span>Incorrect</span>
            </div>
            <div className="test-ql-item">
              <span className="test-ql-box test-ql-box--unattempted" />
              <span>Unattempted</span>
            </div>
            <div className="test-ql-item">
              <span className="test-ql-box test-ql-box--review" />
              <span>Review</span>
            </div>
          </div>
        </div>
        <div className="test-qgrid">
          {questions.map((q, i) => {
            const state = getQuestionResultState(i)
            return (
              <button
                key={q._id || i}
                className={`test-q-box test-q-box--${state}`}
                onClick={() => {
                  setCurrentIndex(i)
                  setShowResultPage(false)
                }}
                title={`Q${i + 1}: ${state}`}
              >
                {i + 1}
              </button>
            )
          })}
        </div>
      </div>
    )

    return (
      <ExamResultDashboard
        onClose={onClose}
        onRetakeExam={handleRetakeExam}
        candidateName={user?.name || 'Student'}
        rollNumber={user?.mhcetId || 'N/A'}
        examName="MHT-CET Mock Test"
        score={result.score}
        maxScore={result.maxScore}
        percentage={percentage}
        passMark={50}
        timeTaken={formatTime(result.duration)}
        correctAnswers={result.correct}
        wrongAnswers={result.incorrect}
        unansweredQuestions={result.notAnswered}
        subjectWiseScores={subjectWiseScores}
        strengths={strengths.length > 0 ? strengths : ['Need more practice']}
        weaknesses={weaknesses.length > 0 ? weaknesses : ['Overall improvement needed']}
        aiFeedback={aiFeedback}
        canRetake={true}
        hasPassed={hasPassed}
        analyticsGrid={analyticsGridContent}
      />
    )
  }



  const handleNext = () => {
    const currentSubject = questions[currentIndex]?.subject || 'General'
    const nextIdx = questions.findIndex((q, i) => i > currentIndex && (q.subject || 'General') === currentSubject)
    if (nextIdx !== -1) setCurrentIndex(nextIdx)
  }

  const handlePrev = () => {
    const currentSubject = questions[currentIndex]?.subject || 'General'
    let prevIdx = -1
    for (let i = currentIndex - 1; i >= 0; i--) {
      if ((questions[i].subject || 'General') === currentSubject) {
        prevIdx = i
        break
      }
    }
    if (prevIdx !== -1) setCurrentIndex(prevIdx)
  }

  return (
    <div className="test-root">
      <header className="test-header">
        <div className="test-header-left">
          <button className="test-back-btn" type="button" onClick={onClose}>
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <span className="test-brand">CET Prep Pro</span>
          <div className="test-sep" />
          <h1 className="test-title">MHT-CET Mock Test</h1>
          {questions.length > 0 && (
            <>
              <div className="test-sep" />
              <select 
                className="test-subject-select"
                value={questions[currentIndex]?.subject || 'General'}
                onChange={(e) => {
                  const subject = e.target.value
                  const firstIndex = questions.findIndex(q => (q.subject || 'General') === subject)
                  if (firstIndex !== -1) setCurrentIndex(firstIndex)
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid #e2e8f0',
                  background: '#f8fafc',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#334155',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                {Array.from(new Set(questions.map(q => q.subject || 'General'))).map(sub => (
                  <option key={sub} value={sub}>{sub}</option>
                ))}
              </select>
            </>
          )}
        </div>
        <div className="test-header-right">
          <div className="test-timer">
            <span className="material-symbols-outlined">timer</span>
            <span className="test-timer-text">{reviewMode ? 'Review Mode' : formatTime(timeRemaining)}</span>
          </div>
          {reviewMode ? (
            <button className="test-submit-btn" onClick={() => setShowResultPage(true)}>Back to Analysis</button>
          ) : (
            <button className="test-submit-btn" onClick={onClose}>Exit</button>
          )}
        </div>
      </header>

      <main className="test-main">
        <section className="test-question-area">
          {currentQuestion && (
            <>
              <div className="test-question-header">
                <div className="test-q-meta">
                  <span className="test-q-number">{currentIndex + 1}</span>
                  <div>
                    <p className="test-q-topic">{currentQuestion.subject} • {currentQuestion.topic}</p>
                    <p className="test-q-marks">+{currentQuestion.marks} Marks • -{currentQuestion.negativeMarks} Negative</p>
                  </div>
                </div>
                <button className="test-report-btn">
                  <span className="material-symbols-outlined">report</span>
                  Report Error
                </button>
              </div>

              <div className="test-question-body">
                <div className="test-question-text">
                  <MathRenderer value={currentQuestion.text} />
                </div>

                {currentQuestion.imageUrl && (
                  <div className="test-question-image-wrap">
                    <img
                      className="test-question-image"
                      src={currentQuestion.imageUrl}
                      alt="Question prompt"
                      onClick={() => openLightbox(currentQuestion.imageUrl!)}
                      style={{ cursor: 'pointer' }}
                    />
                    <p className="test-image-hint">Click image to enlarge</p>
                  </div>
                )}

                <div className="test-options">
                  {currentQuestion.options.map((opt, i) => {
                    const isSelected = answers[currentQuestion._id] === i
                    const isCorrect = i === currentQuestion.correctIndex
                    
                    let optionClass = ''
                    if (reviewMode) {
                      if (isCorrect) optionClass = 'test-option--correct-review'
                      else if (isSelected && !isCorrect) optionClass = 'test-option--incorrect-review'
                    } else if (isSelected) {
                      optionClass = 'test-option--active'
                    }

                    return (
                      <button
                        key={i}
                        className={`test-option ${optionClass}`}
                        onClick={() => !reviewMode && selectOption(i)}
                      >
                        <div className="test-option-letter">
                          <span className={`test-option-circle ${isSelected ? 'test-option-circle--active' : ''}`}>{String.fromCharCode(65 + i)}</span>
                          <span className="test-option-text"><MathRenderer value={opt} /></span>
                        </div>
                        {reviewMode && isCorrect && <span className="material-symbols-outlined test-option-check" style={{color: '#10b981'}}>check_circle</span>}
                        {reviewMode && isSelected && !isCorrect && <span className="material-symbols-outlined test-option-check" style={{color: '#ef4444'}}>cancel</span>}
                        {!reviewMode && isSelected && <span className="material-symbols-outlined test-option-check">check_circle</span>}
                      </button>
                    )
                  })}
                </div>

                {reviewMode && (
                  <div className="test-review-explanation" style={{ marginTop: '32px', padding: '24px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="material-symbols-outlined" style={{ color: '#3b82f6' }}>info</span>
                      Detailed Solution
                    </h3>
                    <div style={{ marginBottom: '20px', display: 'flex', gap: '32px' }}>
                      <div>
                        <span style={{ fontSize: '13px', color: '#64748b', display: 'block', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Your Answer</span>
                        <span style={{ fontSize: '16px', fontWeight: 600, color: answers[currentQuestion._id] === currentQuestion.correctIndex ? '#10b981' : (answers[currentQuestion._id] !== undefined ? '#ef4444' : '#64748b') }}>
                          {answers[currentQuestion._id] !== undefined ? `Option ${String.fromCharCode(65 + answers[currentQuestion._id])}` : 'Not Attempted'}
                        </span>
                      </div>
                      <div>
                        <span style={{ fontSize: '13px', color: '#64748b', display: 'block', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Correct Answer</span>
                        <span style={{ fontSize: '16px', fontWeight: 600, color: '#10b981' }}>
                          Option {String.fromCharCode(65 + currentQuestion.correctIndex)}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: '15px', lineHeight: '1.7', color: '#334155', borderTop: '1px solid #e2e8f0', paddingTop: '20px' }}>
                      {currentQuestion.solution ? (
                        <MathRenderer value={currentQuestion.solution} />
                      ) : (
                        <p style={{ color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>No detailed explanation provided for this question.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        <aside className="test-sidebar">
          <div className="test-palette">
            <div className="test-palette-header">
              <h4 className="test-palette-title">Question Palette</h4>
              <div className="test-legend">
                <div className="test-legend-item"><span className="test-legend-dot test-legend-dot--answered" /> Answered</div>
                <div className="test-legend-item"><span className="test-legend-dot test-legend-dot--marked" /> Marked</div>
                <div className="test-legend-item"><span className="test-legend-dot test-legend-dot--not-answered" /> Not Answered</div>
                <div className="test-legend-item"><span className="test-legend-dot test-legend-dot--unvisited" /> Unvisited</div>
              </div>
            </div>
            <div className="test-palette-grid">
              {questions.map((q, i) => ({ q, i }))
                .filter(({ q }) => (q.subject || 'General') === (questions[currentIndex]?.subject || 'General'))
                .map(({ i }) => (
                  <div
                    key={i}
                    className={`test-palette-item test-palette-item--${getQuestionState(i)}`}
                    onClick={() => setCurrentIndex(i)}
                  >
                    {i + 1}
                  </div>
              ))}
            </div>
          </div>
        </aside>
      </main>

      {lightboxOpen && lightboxImage && (
        <div className="test-lightbox" onClick={closeLightbox}>
          <div className="test-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <button className="test-lightbox-close" onClick={closeLightbox}>
              <span className="material-symbols-outlined">close</span>
            </button>
            <img
              className="test-lightbox-image"
              src={lightboxImage}
              alt="Enlarged question image"
            />
          </div>
        </div>
      )}

      <footer className="test-footer">
        <div className="test-footer-left">
          <button className="test-nav-btn test-nav-btn--prev" onClick={handlePrev}>
            <span className="material-symbols-outlined">chevron_left</span>
            Previous
          </button>
          <button 
            className={`test-nav-btn test-nav-btn--mark ${isCurrentMarked ? 'test-nav-btn--mark-active' : ''}`} 
            onClick={toggleMarked}
          >
            <span className="material-symbols-outlined">{isCurrentMarked ? 'bookmark' : 'bookmark_add'}</span>
            {isCurrentMarked ? 'Marked for Review' : 'Mark for Review'}
          </button>
        </div>
        <div className="test-footer-right">
          {!reviewMode && (
            <button className="test-action-btn test-action-btn--clear" onClick={() => {
              if (currentQuestion) {
                setAnswers(prev => {
                  const newAnswers = {...prev}
                  delete newAnswers[currentQuestion._id]
                  return newAnswers
                })
              }
            }}>Clear Response</button>
          )}
          <button className="test-action-btn test-action-btn--save" onClick={handleNext}>
            {reviewMode ? 'Next Question' : 'Save & Next'}
            <span className="material-symbols-outlined">chevron_right</span>
          </button>
          {!reviewMode && (
            <button className="test-action-btn test-action-btn--submit" onClick={submitTest}>
              Submit Test
            </button>
          )}
        </div>
      </footer>
    </div>
  )
}
