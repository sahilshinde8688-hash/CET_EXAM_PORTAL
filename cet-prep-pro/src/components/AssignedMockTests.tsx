import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { mockTestAssignmentsAPI, type MockTestAssignment, type StartedMockTest } from '../lib/api'
import { MathRenderer } from '../lib/mathDisplay'
import '../testInterface.css'

type Props = { onBack?: () => void; embedded?: boolean }
type SafeQuestion = {
  _id: string
  subject: string
  topic: string
  text: string
  imageUrl?: string
  options: string[]
  marks: number
}
type ActiveAttempt = Omit<StartedMockTest, 'questions'> & { questions: SafeQuestion[] }

const card: CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 20 }
const button: CSSProperties = { border: 0, background: '#2563eb', color: '#fff', borderRadius: 8, padding: '10px 16px', fontWeight: 700, cursor: 'pointer' }
const dateLabel = (value: string, timeZone = 'Asia/Kolkata') => new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone })
const formatTime = (value: number) => `${Math.floor(value / 3600).toString().padStart(2, '0')}:${Math.floor((value % 3600) / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`
const formatCountdown = (value: number) => {
  const seconds = Math.max(0, Math.floor(value / 1000))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return `${days ? `${days}d ` : ''}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Could not complete the request. Please try again.'

export default function AssignedMockTests({ onBack, embedded = false }: Props) {
  const [assignments, setAssignments] = useState<MockTestAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  const [active, setActive] = useState<ActiveAttempt | null>(null)
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [remaining, setRemaining] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [result, setResult] = useState<{ score: number; totalMarks: number } | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const progressQueue = useRef<Promise<unknown>>(Promise.resolve())
  const answersRef = useRef(answers)
  const elapsedRef = useRef(0)

  const loadAssignments = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    setError('')
    try {
      const response = await mockTestAssignmentsAPI.getStudentAssignments()
      setAssignments(response.assignments)
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      if (!background) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAssignments()
    const refreshInterval = window.setInterval(() => { void loadAssignments(true) }, 15000)
    const refreshOnFocus = () => { void loadAssignments(true) }
    window.addEventListener('focus', refreshOnFocus)
    return () => {
      window.clearInterval(refreshInterval)
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [loadAssignments])
  useEffect(() => { answersRef.current = answers }, [answers])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!active || submitted) return
    const updateTime = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - new Date(active.attempt.startedAt).getTime()) / 1000))
      elapsedRef.current = elapsed
      const windowRemaining = Math.ceil((new Date(active.assignment.endDateTime).getTime() - Date.now()) / 1000)
      setRemaining(Math.max(0, Math.min(active.assignment.duration * 60 - elapsed, windowRemaining)))
    }
    updateTime()
    const timer = window.setInterval(updateTime, 1000)
    return () => window.clearInterval(timer)
  }, [active, submitted])

  const saveProgress = useCallback(async (nextAnswers = answersRef.current) => {
    if (!active || submitted) return
    const request = progressQueue.current
      .catch(() => undefined)
      .then(() => mockTestAssignmentsAPI.saveProgress(active.attempt._id, nextAnswers, elapsedRef.current))
    progressQueue.current = request
    try {
      await request
      setError('')
    } catch (saveError) {
      setError(`Progress could not be saved. Check your connection and retry. ${errorMessage(saveError)}`)
    }
  }, [active, submitted])

  useEffect(() => {
    if (!active || submitted) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => { void saveProgress(answers) }, 450)
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [answers, active, saveProgress, submitted])

  useEffect(() => {
    if (!active || submitted) return
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void saveProgress()
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      void saveProgress()
      event.preventDefault()
      event.returnValue = ''
    }
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [active, saveProgress, submitted])

  const start = async (assignment: MockTestAssignment) => {
    setError('')
    try {
      const started = await mockTestAssignmentsAPI.start(assignment._id) as ActiveAttempt
      setActive(started)
      setAnswers(started.attempt.answers || {})
      setCurrentIndex(0)
      setSubmitted(false)
      setResult(null)
    } catch (startError) {
      setError(errorMessage(startError))
      await loadAssignments()
    }
  }

  const submit = useCallback(async (confirmSubmission = true) => {
    if (!active || submitting || submitted) return
    if (confirmSubmission && !window.confirm('Submit this mock test? You cannot change your answers afterward.')) return
    setSubmitting(true)
    setError('')
    try {
      const response = await mockTestAssignmentsAPI.submit(active.attempt._id, answers, elapsedRef.current)
      if (response.result) setResult({ score: response.result.score, totalMarks: response.result.totalMarks })
      setSubmitted(true)
      await loadAssignments()
    } catch (submitError) {
      if (Date.now() >= new Date(active.assignment.endDateTime).getTime()) {
        setError('This test has expired. Answers saved before the deadline were preserved.')
        setActive(null)
        await loadAssignments()
      } else {
        setError(errorMessage(submitError))
      }
    } finally {
      setSubmitting(false)
    }
  }, [active, answers, loadAssignments, submitted, submitting])

  useEffect(() => {
    if (active && !submitted && remaining === 0 && active.questions.length
      && (elapsedRef.current >= active.assignment.duration * 60
        || now >= new Date(active.assignment.endDateTime).getTime())) void submit(false)
  }, [active, now, remaining, submit, submitted])

  useEffect(() => {
    if (!active || submitted || active.assignment.allowBackNavigation) return
    const guard = () => {
      window.history.pushState({ assignedTestGuard: true }, '')
      setError('Back navigation is disabled for this assigned test.')
    }
    window.history.pushState({ assignedTestGuard: true }, '')
    window.addEventListener('popstate', guard)
    return () => window.removeEventListener('popstate', guard)
  }, [active, submitted])

  if (active && submitted) {
    return <main className="test-root">
      <section className="test-result-card" style={{ margin: 'auto', textAlign: 'center' }}>
        <div className="test-success-animation" aria-hidden="true">✓</div>
        <h1>Mock test submitted</h1>
        <p>{active.assignment.mockTestName} · Attempt {active.attempt.attemptNumber}</p>
        {result && <p><strong>Score: {result.score} / {result.totalMarks}</strong></p>}
        {!result && <p>Your result will be available according to the assignment's result visibility settings.</p>}
        <button className="test-submit-btn" onClick={() => { setActive(null); setSubmitted(false); void loadAssignments() }}>Back to assigned tests</button>
      </section>
    </main>
  }

  if (active) {
    const question = active.questions[currentIndex]
    const goToQuestion = (index: number) => {
      if (active.assignment.allowBackNavigation || index >= currentIndex) {
        setCurrentIndex(Math.max(0, Math.min(index, active.questions.length - 1)))
      }
    }
    const questionState = (index: number) => {
      const item = active.questions[index]
      if (index === currentIndex) return 'current'
      return item && answers[item._id] !== undefined ? 'answered' : 'not-answered'
    }
    const selectAnswer = (optionIndex: number) => {
      if (!question) return
      setAnswers(previous => ({ ...previous, [question._id]: optionIndex }))
    }
    const clearAnswer = () => {
      if (!question) return
      setAnswers(previous => {
        const next = { ...previous }
        delete next[question._id]
        return next
      })
    }
    const nextQuestion = () => {
      if (currentIndex < active.questions.length - 1) setCurrentIndex(index => index + 1)
      else void submit()
    }
    const previousQuestion = () => setCurrentIndex(index => Math.max(0, index - 1))

    return <main className="test-root">
      <header className="test-header">
        <div className="test-header-left">
          <div className="test-brand"><img src="/logo.png" alt="CETNova" /></div>
          <div className="test-sep" />
          <h1 className="test-title">{active.assignment.mockTestName}</h1>
          <div className="test-sep" />
          <span className="test-title">Attempt {active.attempt.attemptNumber} · {currentIndex + 1} / {active.questions.length}</span>
        </div>
        <div className="test-header-right">
          <div className="test-timer" role="timer" aria-live="polite">
            <span className="material-symbols-outlined">timer</span>
            <span className="test-timer-text">{formatTime(remaining)}</span>
          </div>
          <button className="test-submit-btn" type="button" disabled={submitting} onClick={() => void submit()}>
            {submitting ? 'Submitting…' : 'Submit Test'}
          </button>
        </div>
      </header>
      {error && <p role="alert" style={{ color: '#b91c1c', margin: '8px 32px 0' }}>{error}</p>}
      <main className="test-main">
        <section className="test-question-area">
          {question && <>
            <div className="test-question-header">
              <div className="test-q-meta">
                <span className="test-q-number">{currentIndex + 1}</span>
                <div>
                  <p className="test-q-topic">{question.subject} · {question.topic}</p>
                  <p className="test-q-marks">{question.marks} Marks</p>
                </div>
              </div>
            </div>
            <div className="test-question-body">
              <div className="test-question-text"><MathRenderer value={question.text} /></div>
              {question.imageUrl && (
                <div className="test-question-image-wrap">
                  <img className="test-question-image" src={question.imageUrl} alt="Question illustration" />
                </div>
              )}
              <div className="test-options">
                {question.options.map((option, index) => {
                  const selected = Number(answers[question._id]) === index
                  return <button
                    key={`${question._id}-${index}`}
                    type="button"
                    className={`test-option${selected ? ' test-option--active' : ''}`}
                    onClick={() => selectAnswer(index)}
                  >
                    <span className="test-option-letter">
                      <span className={`test-option-circle${selected ? ' test-option-circle--active' : ''}`}>{String.fromCharCode(65 + index)}</span>
                      <span className="test-option-text"><MathRenderer value={option} /></span>
                    </span>
                    {selected && <span className="material-symbols-outlined test-option-check">check_circle</span>}
                  </button>
                })}
              </div>
              <p style={{ color: '#64748b', fontSize: 13, margin: '20px 0 0' }}>
                Progress is automatically saved. {active.assignment.allowResume ? 'You can resume after an interruption.' : 'Resume is disabled by the administrator.'}
              </p>
            </div>
          </>}
        </section>
        <aside className="test-sidebar">
          <div className="test-palette">
            <div className="test-palette-header">
              <h2 className="test-palette-title">Question Palette</h2>
              <div className="test-legend">
                <div className="test-legend-item"><span className="test-legend-dot test-legend-dot--answered" /> Answered</div>
                <div className="test-legend-item"><span className="test-legend-dot test-legend-dot--not-answered" /> Not Answered</div>
              </div>
            </div>
            <div className="test-palette-grid">
              {active.questions.map((item, index) => (
                <button
                  key={item._id}
                  type="button"
                  className={`test-palette-item test-palette-item--${questionState(index)}`}
                  aria-label={`Question ${index + 1}${answers[item._id] !== undefined ? ', answered' : ', not answered'}`}
                  aria-current={index === currentIndex ? 'step' : undefined}
                  disabled={!active.assignment.allowBackNavigation && index < currentIndex}
                  onClick={() => goToQuestion(index)}
                  style={{ appearance: 'none', border: questionState(index) === 'not-answered' ? '1px solid #cbd5e1' : 0, fontFamily: 'inherit' }}
                >
                  {index + 1}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </main>
      <footer className="test-footer">
        <div className="test-footer-left">
          <button className="test-nav-btn test-nav-btn--prev" type="button" disabled={currentIndex === 0 || !active.assignment.allowBackNavigation} onClick={previousQuestion}>
            <span className="material-symbols-outlined">chevron_left</span>Previous
          </button>
        </div>
        <div className="test-footer-right">
          <button className="test-action-btn test-action-btn--clear" type="button" onClick={clearAnswer}>Clear Response</button>
          <button className="test-action-btn test-action-btn--save" type="button" onClick={nextQuestion}>
            {currentIndex < active.questions.length - 1 ? 'Save & Next' : 'Submit Test'}
            <span className="material-symbols-outlined">chevron_right</span>
          </button>
        </div>
      </footer>
    </main>
  }

  const Container = embedded ? 'section' : 'main'
  return <Container id={embedded ? 'assigned-mock-tests' : undefined} style={{ maxWidth: embedded ? 'none' : 1300, padding: embedded ? '8px 0 0' : 24, margin: embedded ? '24px 0 30px' : '0 auto', color: '#0f172a' }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
      <div>{!embedded && <button type="button" style={{ ...button, background: '#475569', marginBottom: 10 }} onClick={onBack}>← Mock Tests</button>}<h2 className={embedded ? 'mt-hero-title' : undefined} style={{ margin: 0, ...(embedded ? { fontSize: 22 } : {}) }}>Assigned Mock Tests</h2><p className={embedded ? 'mt-hero-sub' : undefined} style={{ color: '#64748b', margin: '5px 0 0' }}>Tests assigned to your student account.</p></div>
      <button className={embedded ? 'mt-quick-btn' : undefined} style={embedded ? undefined : { ...button, background: '#475569' }} onClick={() => void loadAssignments()}>Refresh</button>
    </header>
    {error && <p role="alert" style={{ ...card, color: '#b91c1c', borderColor: '#fecaca' }}>{error}</p>}
    {loading ? <p>Loading assigned mock tests…</p> : assignments.length === 0 ? <section className={embedded ? 'mt-empty' : undefined} style={embedded ? undefined : card}>No mock tests have been assigned to you yet.</section> : (
      <div className={embedded ? 'mt-cards-grid' : undefined} style={embedded ? undefined : { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
        {assignments.map(assignment => {
          const startAt = new Date(assignment.startDateTime).getTime()
          const endAt = new Date(assignment.endDateTime).getTime()
          const attemptSubmitted = assignment.hasSubmittedAttempt === true
          const status = assignment.status === 'In Progress' && now < endAt
            ? 'In Progress'
            : attemptSubmitted
              ? 'Submitted'
              : now >= endAt
                ? 'Expired'
                : now < startAt
                  ? 'Upcoming'
                  : assignment.status === 'Completed'
                    ? 'Submitted'
                    : 'Available'
          const canStart = status === 'Available' || status === 'In Progress'
          return <article key={assignment._id} className={embedded ? 'mt-glass-card mt-test-card' : undefined} style={embedded ? undefined : card}>
            {embedded && status === 'Available' && <div className="mt-recommended-badge">Assigned to you</div>}
            {embedded && <div className="mt-card-icon mt-icon--blue"><span className="material-symbols-outlined">assignment</span></div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <h3 className={embedded ? 'mt-card-title' : undefined} style={embedded ? undefined : { fontSize: 19, margin: 0 }}>{assignment.mockTestName}</h3>
              <span className={embedded ? 'mt-diff-badge mt-diff-medium' : undefined} style={embedded ? undefined : { borderRadius: 99, padding: '4px 9px', background: status === 'Available' ? '#dcfce7' : '#f1f5f9', fontSize: 12, fontWeight: 700 }}>{status}</span>
            </div>
            <p className={embedded ? 'mt-card-desc' : undefined} style={embedded ? undefined : { color: '#64748b' }}>{assignment.subject || assignment.examType || 'Mock Test'} · {assignment.questionCount ?? '—'} questions</p>
            <div className={embedded ? 'mt-card-meta' : undefined} style={embedded ? undefined : { display: 'grid', gap: 5, margin: '0 0 16px' }}>
              <span className={embedded ? 'mt-meta-item' : undefined}><span className="material-symbols-outlined">format_list_bulleted</span>{assignment.questionCount ?? '—'} Qs</span>
              <span className={embedded ? 'mt-meta-item' : undefined}><span className="material-symbols-outlined">schedule</span>{assignment.duration} Mins</span>
              <span className={embedded ? 'mt-meta-item' : undefined}><span className="material-symbols-outlined">grade</span>{assignment.totalMarks ?? '—'} Marks</span>
              <span className={embedded ? 'mt-meta-item' : undefined}>Attempts: {assignment.attemptsRemaining === null ? 'Unlimited' : `${assignment.attemptsRemaining} left`}</span>
            </div>
            <div className={embedded ? 'mt-card-desc' : undefined} style={embedded ? { marginBottom: 14 } : undefined}>
              <p><strong>Start:</strong> {dateLabel(assignment.startDateTime, assignment.timeZone)}</p>
              <p><strong>Expiry:</strong> {dateLabel(assignment.endDateTime, assignment.timeZone)} ({assignment.timeZone})</p>
              {status === 'Upcoming' && <p role="timer"><strong>Available in:</strong> {formatCountdown(startAt - now)}</p>}
              {status === 'Available' && <p role="timer"><strong>Closes in:</strong> {formatCountdown(endAt - now)}</p>}
              {assignment.results?.map((item, index) => <p key={`${assignment._id}-result-${index}`}><strong>Attempt {index + 1} result:</strong> {item.score} / {item.totalMarks}</p>)}
            </div>
            <button type="button" className={embedded ? `mt-start-btn${canStart ? ' mt-start-btn--primary' : ''}` : undefined} disabled={!canStart || assignment.attemptsRemaining === 0} style={embedded ? undefined : { ...button, opacity: canStart && assignment.attemptsRemaining !== 0 ? 1 : 0.5 }} onClick={() => void start(assignment)}>{status === 'In Progress' ? 'Resume Test' : status === 'Upcoming' ? 'Starts Soon' : status === 'Available' ? 'Start Now' : status === 'Submitted' ? 'Submitted' : 'Test Expired'}{embedded && canStart && <span className="material-symbols-outlined">arrow_forward</span>}</button>
          </article>
        })}
      </div>
    )}
  </Container>
}
