import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { mockTestAssignmentsAPI, type MockTestAssignment, type StartedMockTest } from '../lib/api'
import ExamInstructions from './ExamInstructions'
import TestInterface from './TestInterface'

type Props = { onBack?: () => void; embedded?: boolean; toolbarActions?: ReactNode }

const card: CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 20 }
const button: CSSProperties = { border: 0, background: '#2563eb', color: '#fff', borderRadius: 8, padding: '10px 16px', fontWeight: 700, cursor: 'pointer' }
const dateLabel = (value: string, timeZone = 'Asia/Kolkata') => new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone })
const formatCountdown = (value: number) => {
  const seconds = Math.max(0, Math.floor(value / 1000))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return `${days ? `${days}d ` : ''}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Could not complete the request. Please try again.'

export default function AssignedMockTests({ onBack, embedded = false, toolbarActions }: Props) {
  const [assignments, setAssignments] = useState<MockTestAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  const [active, setActive] = useState<StartedMockTest | null>(null)
  const [pendingStart, setPendingStart] = useState<MockTestAssignment | null>(null)
  const [startingAssignmentId, setStartingAssignmentId] = useState<string | null>(null)
  const progressQueue = useRef<Promise<unknown>>(Promise.resolve())
  const assignmentRequestInFlight = useRef(false)
  const lastAssignmentRequestAt = useRef(0)

  const loadAssignments = useCallback(async (background = false) => {
    if (assignmentRequestInFlight.current) return
    if (background && (document.hidden || Date.now() - lastAssignmentRequestAt.current < 30_000)) return
    assignmentRequestInFlight.current = true
    lastAssignmentRequestAt.current = Date.now()
    if (!background) setLoading(true)
    try {
      const response = await mockTestAssignmentsAPI.getStudentAssignments()
      setAssignments(response.assignments)
      setError('')
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      assignmentRequestInFlight.current = false
      if (!background) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAssignments()
    const refreshInterval = window.setInterval(() => { void loadAssignments(true) }, 60000)
    const refreshOnFocus = () => { void loadAssignments(true) }
    window.addEventListener('focus', refreshOnFocus)
    return () => {
      window.clearInterval(refreshInterval)
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [loadAssignments])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const start = useCallback(async (assignment: MockTestAssignment) => {
    setPendingStart(null)
    setStartingAssignmentId(assignment._id)
    setError('')
    try {
      const started = await mockTestAssignmentsAPI.start(assignment._id)
      setActive(started)
    } catch (startError) {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen().catch(() => {})
      }
      setError(errorMessage(startError))
      await loadAssignments()
    } finally {
      setStartingAssignmentId(null)
    }
  }, [loadAssignments])

  const saveProgress = useCallback(async (answers: Record<string, number>, timeSpent: number) => {
    if (!active || active.attempt.status !== 'in_progress') return
    const request = progressQueue.current
      .catch(() => undefined)
      .then(() => mockTestAssignmentsAPI.saveProgress(active.attempt._id, answers, timeSpent))
    progressQueue.current = request
    await request
  }, [active])

  const submitAttempt = useCallback(async (answers: Record<string, number>, timeSpent: number) => {
    if (!active) throw new Error('The active assignment could not be found. Refresh and resume the test.')
    try {
      await progressQueue.current.catch(progressError => {
        console.error('Assigned-test progress save failed before submission:', progressError)
      })
      const response = await mockTestAssignmentsAPI.submit(active.attempt._id, answers, timeSpent)
      setActive(current => current ? { ...current, attempt: response.attempt } : current)
      return response
    } catch (submitError) {
      const deadline = Math.min(
        Date.parse(active.assignment.endDateTime),
        Date.parse(active.attempt.startedAt) + active.assignment.duration * 60_000,
      )
      if (Date.now() >= deadline) {
        setActive(null)
        await loadAssignments()
        throw new Error('The test deadline has passed. Previously saved answers were preserved.')
      }
      throw submitError
    }
  }, [active, loadAssignments])

  const refreshActiveAssignment = useCallback(async () => {
    if (!active) return
    try {
      const response = await mockTestAssignmentsAPI.getStudentAssignments()
      setAssignments(response.assignments)
      const refreshed = response.assignments.find(assignment => assignment._id === active.assignment._id)
      if (refreshed) {
        setActive(current => current ? { ...current, assignment: refreshed } : current)
      }
    } catch (refreshError) {
      setError(errorMessage(refreshError))
    }
  }, [active])

  useEffect(() => {
    if (!active || active.attempt.status !== 'in_progress' || active.assignment.allowBackNavigation) return
    const guard = () => {
      window.history.pushState({ assignedTestGuard: true }, '')
      setError('Back navigation is disabled for this assigned test.')
    }
    window.history.pushState({ assignedTestGuard: true }, '')
    window.addEventListener('popstate', guard)
    return () => window.removeEventListener('popstate', guard)
  }, [active])

  if (pendingStart) {
    return (
      <ExamInstructions
        assignedTest
        assignmentName={pendingStart.mockTestName}
        assignmentSubject={pendingStart.subject || pendingStart.examType || 'Mock Test'}
        durationMinutes={pendingStart.duration}
        totalMarks={pendingStart.totalMarks}
        onStart={() => { void start(pendingStart) }}
        onCancel={() => setPendingStart(null)}
      />
    )
  }

  if (active) {
    return (
      <TestInterface
        key={active.attempt._id}
        onClose={() => {
          setActive(null)
          void loadAssignments()
        }}
        examName={active.assignment.mockTestName}
        durationMinutes={active.assignment.duration}
        questionCount={active.questions.length}
        questionIds={active.attempt.questionIds}
        assignedAttempt={active}
        onAssignedSave={saveProgress}
        onAssignedSubmit={submitAttempt}
        onAssignedSubmitted={refreshActiveAssignment}
        onAssignedRetake={() => {
          setActive(null)
          setPendingStart(active.assignment)
        }}
      />
    )
  }

  const Container = embedded ? 'section' : 'main'
  return <Container id={embedded ? 'assigned-mock-tests' : undefined} style={{ maxWidth: embedded ? 'none' : 1300, padding: embedded ? '8px 0 0' : 24, margin: embedded ? '24px 0 30px' : '0 auto', color: '#0f172a' }}>
    <header className={embedded ? 'mt-assigned-header' : undefined} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
      <div>{!embedded && <button type="button" style={{ ...button, background: '#475569', marginBottom: 10 }} onClick={onBack}>← Mock Tests</button>}<h2 className={embedded ? 'mt-hero-title' : undefined} style={{ margin: 0, ...(embedded ? { fontSize: 22 } : {}) }}>Assigned Mock Tests</h2><p className={embedded ? 'mt-hero-sub' : undefined} style={{ color: '#64748b', margin: '5px 0 0' }}>Tests assigned to your student account.</p></div>
      <div className={embedded ? 'mt-assigned-toolbar' : undefined}>
        {toolbarActions}
        <button className={embedded ? 'mt-quick-btn' : undefined} style={embedded ? undefined : { ...button, background: '#475569' }} onClick={() => void loadAssignments()}>Refresh</button>
      </div>
    </header>
    {error && <p role="alert" style={{ ...card, color: '#b91c1c', borderColor: '#fecaca' }}>{error}</p>}
    {loading ? <p>Loading assigned mock tests…</p> : assignments.length === 0 && !error ? <section className={embedded ? 'mt-empty' : undefined} style={embedded ? undefined : card}>No mock tests have been assigned to you yet.</section> : assignments.length > 0 && (
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
            <button
              type="button"
              className={embedded ? `mt-start-btn${canStart ? ' mt-start-btn--primary' : ''}` : undefined}
              disabled={!canStart || assignment.attemptsRemaining === 0 || startingAssignmentId === assignment._id}
              style={embedded ? undefined : { ...button, opacity: canStart && assignment.attemptsRemaining !== 0 ? 1 : 0.5 }}
              onClick={() => status === 'In Progress' ? void start(assignment) : setPendingStart(assignment)}
            >
              {startingAssignmentId === assignment._id ? 'Starting…' : status === 'In Progress' ? 'Resume Test' : status === 'Upcoming' ? 'Starts Soon' : status === 'Available' ? 'Start Now' : status === 'Submitted' ? 'Submitted' : 'Test Expired'}
              {embedded && canStart && <span className="material-symbols-outlined">arrow_forward</span>}
            </button>
          </article>
        })}
      </div>
    )}
  </Container>
}
