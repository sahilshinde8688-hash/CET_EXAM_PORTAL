import { useState, useEffect, useMemo, useRef } from 'react'
import { questionsAPI, usersAPI, testsAPI, session, Question } from '../lib/api'
import { MathRenderer } from '../lib/mathDisplay'
import ExamSuccessPage from './ExamSuccessPage'
import ExamResultDashboard from './ExamResultDashboard'
import FullscreenWarningModal from './FullscreenWarningModal'
import SubmissionAnimation from './SubmissionAnimation'
import { useFullscreenGuard } from '../lib/useFullscreenGuard'
import '../testInterface.css'

// Check if running in production mode
const isProductionMode = import.meta.env.VITE_PRODUCTION_MODE === 'true'

const QUESTION_ORDER_KEY = 'cet_exam_question_order_v2'

const shuffleQuestionsBySubject = (items: Question[]): Question[] => {
  const grouped = new Map<string, Question[]>()
  const subjectOrder: string[] = []

  items.forEach(question => {
    const subject = question.subject?.trim() || 'General'
    if (!grouped.has(subject)) {
      grouped.set(subject, [])
      subjectOrder.push(subject)
    }
    grouped.get(subject)?.push(question)
  })

  return subjectOrder.flatMap(subject => {
    const questions = [...(grouped.get(subject) || [])]
    for (let index = questions.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1))
      ;[questions[index], questions[randomIndex]] = [questions[randomIndex], questions[index]]
    }
    return questions
  })
}

const clearQuestionOrder = () => {
  localStorage.removeItem('cet_exam_question_order')
  localStorage.removeItem(QUESTION_ORDER_KEY)
}

const normalizeQuestion = (question: Partial<Question> & { [key: string]: any }): Question => ({
  _id: String(question._id || ''),
  subject: question.subject || 'General',
  chapter: question.chapter,
  subTopic: question.subTopic,
  topic: question.topic || 'General',
  text: question.text || '',
  imageUrl: question.imageUrl,
  options: Array.isArray(question.options) ? question.options : [],
  solution: question.solution,
  correctIndex: Number(question.correctIndex ?? 0),
  marks: Number(question.marks ?? 2),
  negativeMarks: Number(question.negativeMarks ?? 0.5),
  difficulty: (question.difficulty as Question['difficulty']) || 'Easy',
  isActive: question.isActive !== false,
  createdAt: question.createdAt,
})

const saveQuestionOrder = (questions: Question[]) => {
  localStorage.setItem(QUESTION_ORDER_KEY, JSON.stringify(questions.map(question => question._id)))
}

const loadQuestionOrder = (): string[] => {
  const savedOrder = localStorage.getItem(QUESTION_ORDER_KEY)
  if (!savedOrder) return []
  try {
    return JSON.parse(savedOrder)
  } catch {
    return []
  }
}

export default function TestInterface({ 
  onClose, 
  onBackRequest,
  onBackToAnalysis,
  onSubmissionComplete,
  onResultSaved,
  examName = 'MHT-CET Mock Test',
  durationMinutes = 120,
  reviewMode = false, 
  pastAnswers, 
  pastResultData 
}: { 
  onClose: () => void; 
  onBackRequest?: () => void;
  onBackToAnalysis?: () => void;
  onSubmissionComplete?: () => void;
  onResultSaved?: (result: any) => void;
  examName?: string;
  durationMinutes?: number;
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
  const [currentIndex, setCurrentIndex] = useState<number>(() => {
    if (reviewMode) return 0
    const saved = localStorage.getItem('cet_exam_current_index')
    return saved ? parseInt(saved, 10) : 0
  })
  const [answers, setAnswers] = useState<Record<string, number>>(() => {
    if (pastAnswers) return pastAnswers
    const saved = localStorage.getItem('cet_exam_answers')
    return saved ? JSON.parse(saved) : {}
  }) // questionId -> selected option index
  const [marked, setMarked] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('cet_exam_marked')
    return saved ? JSON.parse(saved) : {}
  })
  const [timeRemaining, setTimeRemaining] = useState<number>(() => {
    if (reviewMode) return durationMinutes * 60
    const saved = localStorage.getItem('cet_exam_time_remaining')
    return saved ? parseInt(saved, 10) : durationMinutes * 60
  }) // exam duration in seconds
  const [timeElapsed, setTimeElapsed] = useState<number>(() => {
    if (reviewMode) return 0
    const saved = localStorage.getItem('cet_exam_time_elapsed')
    return saved ? parseInt(saved, 10) : 0
  }) // Track actual elapsed time

  // Set ongoing test indicator in localStorage for Dashboard resume card
  useEffect(() => {
    if (reviewMode) return
    localStorage.setItem('cet_inProgressTest', JSON.stringify({
      title: 'MHT-CET Mock Test',
      message: 'Exam in progress. Resume to continue.'
    }))
  }, [reviewMode])

  // Sync state changes to localStorage to handle page reload and cross-page access
  useEffect(() => {
    if (reviewMode) return
    localStorage.setItem('cet_exam_current_index', currentIndex.toString())
  }, [currentIndex, reviewMode])

  useEffect(() => {
    if (reviewMode) return
    localStorage.setItem('cet_exam_answers', JSON.stringify(answers))
  }, [answers, reviewMode])

  useEffect(() => {
    if (reviewMode) return
    localStorage.setItem('cet_exam_marked', JSON.stringify(marked))
  }, [marked, reviewMode])

  useEffect(() => {
    if (reviewMode) return
    localStorage.setItem('cet_exam_time_remaining', timeRemaining.toString())
  }, [timeRemaining, reviewMode])

  useEffect(() => {
    if (reviewMode) return
    localStorage.setItem('cet_exam_time_elapsed', timeElapsed.toString())
  }, [timeElapsed, reviewMode])
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
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false)
  const [showSubmissionAnimation, setShowSubmissionAnimation] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showResultPage, setShowResultPage] = useState(reviewMode)
  const [confirmationId, setConfirmationId] = useState<string>('')
  const [user, setUser] = useState<{ name: string; mhcetId?: string; email: string } | null>(null)

  // Full-screen guard — active only during the live exam (not review/result/loading)
  const examActive = !reviewMode && !submitted && !loading && !showResultPage && !showSuccessPage
  const { warningType, fullscreenSupported, timerPaused, requestFullscreen, dismissFocusWarning } = useFullscreenGuard(examActive)

  useEffect(() => {
    if (!showSubmissionAnimation) return
    const successTimer = window.setTimeout(() => {
      setShowSubmissionAnimation(false)
      setShowSuccessPage(true)
    }, 5000)
    return () => window.clearTimeout(successTimer)
  }, [showSubmissionAnimation])

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
      const selected = Number(answers[q._id])
      const correctIndex = Number(q.correctIndex ?? 0)
      if (answers[q._id] === undefined) {
        // Check if marked for review
        if (marked[q._id]) return 'review'
        return 'unattempted'
      }
      if (selected === correctIndex) return 'correct'
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
      const normalizedMarks = Number(question.marks ?? 0)
      const normalizedNegativeMarks = Number(question.negativeMarks ?? 0)
      const normalizedCorrectIndex = Number(question.correctIndex ?? 0)
      maxScore += normalizedMarks
      const selectedRaw = answers[question._id]
      if (selectedRaw === undefined) return
      const selected = Number(selectedRaw)
      if (selected === normalizedCorrectIndex) {
        correct += 1
        score += normalizedMarks
      } else {
        incorrect += 1
        score -= normalizedNegativeMarks
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
    if (isSubmitting) return
    setIsSubmitting(true)
    const resultData = calculateResult()
    setResult(resultData)
    setSubmitted(true)

    // Clear saved progress on submission
    localStorage.removeItem('cet_exam_state')
    localStorage.removeItem('cet_exam_current_index')
    localStorage.removeItem('cet_exam_answers')
    localStorage.removeItem('cet_exam_marked')
    clearQuestionOrder()
    localStorage.removeItem('cet_exam_time_remaining')
    localStorage.removeItem('cet_exam_time_elapsed')
    localStorage.removeItem('cet_inProgressTest')
    
    // Calculate percentile (simple implementation based on score percentage)
    const percentile = resultData.maxScore > 0 ? ((resultData.score / resultData.maxScore) * 100) : 0
    
    const subjectWiseMap = new Map<string, { correct: number, total: number, marks: number, maxMarks: number }>()
    questions.forEach(q => {
      const subjectName = q.subject || 'General'
      const selected = Number(answers[q._id])
      const correctIndex = Number(q.correctIndex ?? 0)
      const marks = Number(q.marks ?? 0)
      const negativeMarks = Number(q.negativeMarks ?? 0)
      const existing = subjectWiseMap.get(subjectName) || { correct: 0, total: 0, marks: 0, maxMarks: 0 }
      existing.total += 1
      existing.maxMarks += marks
      if (answers[q._id] !== undefined && selected === correctIndex) {
        existing.correct += 1
        existing.marks += marks
      } else if (answers[q._id] !== undefined) {
        existing.marks = Math.max(0, existing.marks - negativeMarks)
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
        testName: examName,
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
    
    const newConfirmationId = `CONF-${Date.now()}-${Math.random().toString(36).slice(2, 11).toUpperCase()}`
    setConfirmationId(newConfirmationId)
    setShowSubmissionAnimation(true)
    setIsSubmitting(false)
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
    setTimeRemaining(durationMinutes * 60)
    setTimeElapsed(0)
    setSubmitted(false)
    setResult(null)
    setShowSuccessPage(false)
    setShowResultPage(false)
    setCurrentIndex(0)
    setActiveQ(null)
    setConfirmationId('')
    clearQuestionOrder()
  }

  // Load questions and user data in background (demo questions already loaded)
  useEffect(() => {
    const load = async () => {
      try {
        console.log('Loading questions from API...')
        const data = await questionsAPI.getAll({ isActive: true, includeAnswers: true })
        console.log('Questions loaded from API:', data.length)
        
        // If API returns questions, use them
        if (data.length > 0) {
          const normalizedQuestions = data.map(normalizeQuestion)
          if (reviewMode) {
            setQuestions(normalizedQuestions)
          } else {
            const savedQuestionIds = loadQuestionOrder()
            const questionsById = new Map(normalizedQuestions.map(question => [question._id, question]))
            const orderedQuestions = savedQuestionIds
              .map(questionId => questionsById.get(questionId))
              .filter((question): question is Question => Boolean(question))
            const newQuestions = normalizedQuestions.filter(question => !savedQuestionIds.includes(question._id))
            const nextQuestions = savedQuestionIds.length > 0
              ? [...orderedQuestions, ...newQuestions]
              : shuffleQuestionsBySubject(normalizedQuestions)

            setQuestions(nextQuestions)
            saveQuestionOrder(nextQuestions)
          }
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


  // Timer — pauses automatically when fullscreen/focus warning is active
  useEffect(() => {
    if (loading) return
    const timer = setInterval(() => {
      if (timerPaused) return // Do not tick while warning modal is shown
      setTimeRemaining(t => {
        if (t > 0) {
          setTimeElapsed(e => e + 1)
          return t - 1
        }
        clearInterval(timer)
        return 0
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [loading, timerPaused])

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
      const selected = Number(answers[q._id])
      const correctIndex = Number(q.correctIndex ?? 0)
      const marks = Number(q.marks ?? 0)
      const negativeMarks = Number(q.negativeMarks ?? 0)
      const existing = subjectWiseMap.get(subjectName) || { correct: 0, total: 0, marks: 0, maxMarks: 0 }
      
      existing.total += 1
      existing.maxMarks += marks
      
      if (answers[q._id] !== undefined && selected === correctIndex) {
        existing.correct += 1
        existing.marks += marks
      } else if (answers[q._id] !== undefined) {
        existing.marks = Math.max(0, existing.marks - negativeMarks)
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
        examName={examName}
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
        onBackToAnalysis={onBackToAnalysis}
        onRetakeExam={handleRetakeExam}
        candidateName={user?.name || 'Student'}
        rollNumber={user?.mhcetId || 'N/A'}
        examName={examName}
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



  const handleBackAction = () => {
    if (reviewMode) {
      setShowResultPage(true)
    } else if (submitted) {
      onClose()
    } else {
      if (onBackRequest) {
        onBackRequest()
      } else {
        onClose()
      }
    }
  }

  const handleNext = () => {
    const currentSubject = questions[currentIndex]?.subject || 'General'
    const nextIdx = questions.findIndex((q, i) => i > currentIndex && (q.subject || 'General') === currentSubject)
    if (nextIdx !== -1) {
      setCurrentIndex(nextIdx)
      return
    }

    // At the end of a section, continue from the first question in the next section.
    const nextSectionIdx = questions.findIndex((q, i) => i > currentIndex && (q.subject || 'General') !== currentSubject)
    if (nextSectionIdx !== -1) {
      setCurrentIndex(nextSectionIdx)
    }
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
          <button className="test-back-btn" type="button" onClick={handleBackAction}>
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <span className="test-brand">CET Prep Pro</span>
          <div className="test-sep" />
          <h1 className="test-title">{examName}</h1>
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
          <div className="test-timer" style={timerPaused ? { borderColor: '#f59e0b', background: 'rgba(245,158,11,0.1)', color: '#d97706' } : {}}>
            <span className="material-symbols-outlined">{timerPaused ? 'timer_off' : 'timer'}</span>
            <span className="test-timer-text">
              {reviewMode ? 'Review Mode' : formatTime(timeRemaining)}
            </span>
            {timerPaused && !reviewMode && (
              <span style={{
                fontSize: '10px', fontWeight: 800, letterSpacing: '0.06em',
                background: '#f59e0b', color: '#fff', padding: '2px 6px',
                borderRadius: '4px', animation: 'timerPausePulse 1.4s ease-in-out infinite'
              }}>PAUSED</span>
            )}
          </div>
          <style>{`@keyframes timerPausePulse { 0%,100%{opacity:1} 50%{opacity:0.45} }`}</style>
          {reviewMode ? (
            <button className="test-submit-btn" onClick={() => setShowResultPage(true)}>Back to Analysis</button>
          ) : (
            <button className="test-submit-btn" onClick={handleBackAction}>Exit</button>
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
                    const selectedIndex = Number(answers[currentQuestion._id])
                    const correctIndex = Number(currentQuestion.correctIndex ?? 0)
                    const isSelected = selectedIndex === i
                    const isCorrect = i === correctIndex
                    
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
                        <span style={{ fontSize: '16px', fontWeight: 600, color: Number(answers[currentQuestion._id]) === Number(currentQuestion.correctIndex ?? 0) ? '#10b981' : (answers[currentQuestion._id] !== undefined ? '#ef4444' : '#64748b') }}>
                          {answers[currentQuestion._id] !== undefined ? `Option ${String.fromCharCode(65 + Number(answers[currentQuestion._id]))}` : 'Not Attempted'}
                        </span>
                      </div>
                      <div>
                        <span style={{ fontSize: '13px', color: '#64748b', display: 'block', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Correct Answer</span>
                        <span style={{ fontSize: '16px', fontWeight: 600, color: '#10b981' }}>
                          Option {String.fromCharCode(65 + Number(currentQuestion.correctIndex ?? 0))}
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

      {showSubmitConfirm && (
        <div className="test-submit-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="test-submit-confirm-title">
          <div className="test-submit-confirm-modal">
            <span className="material-symbols-outlined test-submit-confirm-icon">task_alt</span>
            <h2 id="test-submit-confirm-title">Submit Test?</h2>
            <p>
              You have answered {Object.keys(answers).filter(id => questions.some(question => question._id === id)).length} of {questions.length} questions.
            </p>
            <p className="test-submit-confirm-warning">Once submitted, you cannot change your answers.</p>
            <div className="test-submit-confirm-actions">
              <button type="button" onClick={() => setShowSubmitConfirm(false)} disabled={isSubmitting}>
                Go Back
              </button>
              <button type="button" onClick={() => { setShowSubmitConfirm(false); void submitTest() }} disabled={isSubmitting}>
                {isSubmitting ? 'Submitting...' : 'Submit Test'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSubmissionAnimation && <SubmissionAnimation />}

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
            <button className="test-action-btn test-action-btn--submit" onClick={() => setShowSubmitConfirm(true)} disabled={isSubmitting}>
              Submit Test
            </button>
          )}
        </div>
      </footer>

      {/* ── Fullscreen / Focus-loss warning modal ───────────────────────── */}
      <FullscreenWarningModal
        warningType={warningType}
        fullscreenSupported={fullscreenSupported}
        onRequestFullscreen={requestFullscreen}
        onDismissFocusWarning={dismissFocusWarning}
      />
    </div>
  )
}
