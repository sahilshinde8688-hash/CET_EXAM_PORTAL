import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { mockTestAssignmentsAPI, mockTestsAPI, questionsAPI, usersAPI, type AuthUser, type MockTest, type MockTestAssignment, type MockTestAttempt } from '../lib/api'
import { dateTimeToUtc } from '../lib/timeZone'

type Props = { onBack: () => void }
type Target = 'all' | 'students' | 'batch' | 'branch' | 'examType'
type Settings = {
  startDateTime: string
  endDateTime: string
  timeZone: string
  attemptLimit: string
  visibility: 'scheduled' | 'available' | 'draft'
  resultVisibility: 'immediate' | 'after_close' | 'admin_only' | 'hidden'
  randomizeQuestions: boolean
  randomizeOptions: boolean
  allowBackNavigation: boolean
  allowResume: boolean
}

const toZonedDateTime = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`
}

const initialSettings = (): Settings => {
  const timeZone = 'Asia/Kolkata'
  const start = new Date(Date.now() + 60 * 60 * 1000)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return {
    startDateTime: toZonedDateTime(start, timeZone),
    endDateTime: toZonedDateTime(end, timeZone),
    timeZone,
    attemptLimit: '1',
    visibility: 'scheduled',
    resultVisibility: 'immediate',
    randomizeQuestions: false,
    randomizeOptions: false,
    allowBackNavigation: true,
    allowResume: true,
  }
}

const panelStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 14,
  padding: 20,
  marginBottom: 18,
}
const inputStyle: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  color: '#0f172a',
  background: '#fff',
}
const actionStyle: CSSProperties = {
  padding: '10px 15px',
  border: '0',
  borderRadius: 8,
  color: '#fff',
  background: '#2563eb',
  fontWeight: 700,
  cursor: 'pointer',
}
const secondaryStyle: CSSProperties = {
  ...actionStyle,
  background: '#f1f5f9',
  color: '#334155',
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : 'The request failed. Please try again.'
const studentId = (student: AuthUser) => student.id || student._id
const studentLabel = (student: AuthUser) => `${student.name} · ${student.email} · ${student.mhcetId || studentId(student)}`

export default function AdminMockTestAssignments({ onBack }: Props) {
  const [tests, setTests] = useState<MockTest[]>([])
  const [students, setStudents] = useState<AuthUser[]>([])
  const [assignments, setAssignments] = useState<MockTestAssignment[]>([])
  const [marks, setMarks] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [view, setView] = useState<'list' | 'form' | 'review'>('list')
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>([])
  const [target, setTarget] = useState<Target>('all')
  const [studentSearch, setStudentSearch] = useState('')
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([])
  const [groupValue, setGroupValue] = useState('')
  const [settings, setSettings] = useState<Settings>(initialSettings)
  const [allowDuplicateAssignment, setAllowDuplicateAssignment] = useState(false)
  const [editing, setEditing] = useState<MockTestAssignment | null>(null)
  const [attempts, setAttempts] = useState<MockTestAttempt[]>([])
  const [attemptsTitle, setAttemptsTitle] = useState('')

  const reload = async () => {
    setLoading(true)
    setError('')
    try {
      const [adminTests, activeStudents, existingAssignments] = await Promise.all([
        mockTestsAPI.getAllAdmin(),
        usersAPI.getAll('approved'),
        mockTestAssignmentsAPI.getAdminAssignments(),
      ])
      setTests(adminTests)
      setStudents(activeStudents.filter(student => student.role === 'student' && student.status === 'approved'))
      setAssignments(existingAssignments.assignments)
      const questionIds = Array.from(new Set(adminTests.flatMap(test => test.questionIds || [])))
      if (questionIds.length) {
        const batches: string[][] = []
        for (let index = 0; index < questionIds.length; index += 100) batches.push(questionIds.slice(index, index + 100))
        const questionBatches = await Promise.all(batches.map(ids => questionsAPI.getAllAdmin({ ids })))
        const allQuestions = questionBatches.flat()
        const marksById = new Map(allQuestions.map(question => [question._id, Number(question.marks) || 0]))
        setMarks(Object.fromEntries(adminTests.map(test => [
          test._id,
          (test.questionIds || []).reduce((total, id) => total + (marksById.get(id) || 0), 0),
        ])))
      } else {
        setMarks({})
      }
    } catch (loadError) {
      setError(messageOf(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    const refreshInterval = window.setInterval(() => {
      void mockTestAssignmentsAPI.getAdminAssignments()
        .then(response => setAssignments(response.assignments))
        .catch(loadError => setError(messageOf(loadError)))
    }, 15000)
    return () => window.clearInterval(refreshInterval)
  }, [])

  const availableBatches = useMemo(() => [...new Set(students.map(item => item.batch).filter((value): value is number => Number.isFinite(value)))].sort((a, b) => a - b), [students])
  const filteredStudents = useMemo(() => students.filter(student => {
    const query = studentSearch.trim().toLowerCase()
    const searchMatch = !query || [student.name, student.email, student.mhcetId, student._id, student.id]
      .some(value => String(value || '').toLowerCase().includes(query))
    const groupMatch = target !== 'batch' && target !== 'branch' && target !== 'examType'
      ? true
      : target === 'batch'
        ? String(student.batch) === groupValue
        : target === 'branch'
          ? student.branch === groupValue
          : student.examType === groupValue
    return searchMatch && groupMatch
  }), [students, studentSearch, target, groupValue])

  const selectedStudents = useMemo(() => students.filter(student => selectedStudentIds.includes(studentId(student))), [students, selectedStudentIds])
  const selectedTests = useMemo(() => tests.filter(test => selectedTestIds.includes(test._id)), [tests, selectedTestIds])
  const estimatedRecipientIds = useMemo(() => {
    if (target === 'all') return students.map(studentId)
    if (target === 'students') return selectedStudentIds
    return filteredStudents.map(studentId)
  }, [target, students, selectedStudentIds, filteredStudents])
  const estimatedRecipients = useMemo(() => students.filter(student => estimatedRecipientIds.includes(studentId(student))), [students, estimatedRecipientIds])

  const startForm = (testId?: string, assignment?: MockTestAssignment, isReassign = false) => {
    setError('')
    setNotice('')
    setEditing(assignment || null)
    setSelectedTestIds(assignment ? [assignment.mockTestId] : testId ? [testId] : [])
    setTarget(assignment?.assignedTo || (isReassign ? 'students' : 'all'))
    setSelectedStudentIds(isReassign ? [] : assignment?.studentIds || [])
    setGroupValue(assignment?.batchId ? String(assignment.batchId) : assignment?.branch || assignment?.examType || '')
    setStudentSearch('')
    setAllowDuplicateAssignment(isReassign)
    setSettings(assignment ? {
      startDateTime: toZonedDateTime(new Date(assignment.startDateTime), assignment.timeZone || 'Asia/Kolkata'),
      endDateTime: toZonedDateTime(new Date(assignment.endDateTime), assignment.timeZone || 'Asia/Kolkata'),
      timeZone: assignment.timeZone || 'Asia/Kolkata',
      attemptLimit: assignment.attemptLimit === null ? 'unlimited' : String(assignment.attemptLimit),
      visibility: assignment.visibility,
      resultVisibility: assignment.resultVisibility,
      randomizeQuestions: assignment.randomizeQuestions,
      randomizeOptions: assignment.randomizeOptions,
      allowBackNavigation: assignment.allowBackNavigation,
      allowResume: assignment.allowResume,
    } : initialSettings())
    setView('form')
  }

  const updateSettings = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(current => ({ ...current, [key]: value }))
  }

  const toggleStudent = (id: string) => setSelectedStudentIds(current =>
    current.includes(id) ? current.filter(existing => existing !== id) : [...current, id])

  const toggleVisibleStudents = (select: boolean) => {
    const visibleIds = filteredStudents.map(studentId)
    setSelectedStudentIds(current => select
      ? [...new Set([...current, ...visibleIds])]
      : current.filter(id => !visibleIds.includes(id)))
  }

  const validate = () => {
    if (!selectedTestIds.length) return 'Select at least one mock test.'
    if (!estimatedRecipientIds.length) return 'Select at least one student or a group containing students.'
    if (!settings.startDateTime || !settings.endDateTime || settings.endDateTime <= settings.startDateTime) return 'Expiry date and time must be later than the start date and time.'
    if (new Date(dateTimeToUtc(settings.endDateTime.slice(0, 10), settings.endDateTime.slice(11, 16), settings.timeZone)).getTime() <= Date.now()) return 'The expiry date and time must be in the future.'
    if (selectedTests.some(test => !test.duration || test.duration < 1)) return 'The selected mock test has an invalid duration.'
    if (selectedTests.some(test => !(test.questionIds || []).length)) return 'Every selected mock test must contain at least one saved question.'
    if (selectedTests.some(test => (marks[test._id] || 0) <= 0)) return 'Every selected mock test must have valid question marks.'
    if (target === 'students' && !selectedStudentIds.length) return 'Select at least one student.'
    if (['batch', 'branch', 'examType'].includes(target) && !groupValue) return `Select a ${target === 'examType' ? 'exam category' : target}.`
    return ''
  }

  const submit = async () => {
    const validation = validate()
    if (validation) {
      setError(validation)
      return
    }
    setSaving(true)
    setError('')
    let completed = 0
    try {
      const confirmReschedule = Boolean(editing && ['active', 'expired'].includes(editing.schedulingStatus)
        && window.confirm('This test is active or expired. Confirm that you want to reschedule it? Existing submissions will be preserved.'))
      if (editing && ['active', 'expired'].includes(editing.schedulingStatus) && !confirmReschedule) return
      for (const test of selectedTests) {
        const payload = {
          mockTestId: test._id,
          assignedTo: target,
          studentIds: selectedStudentIds,
          batchId: target === 'batch' ? Number(groupValue) : undefined,
          branch: target === 'branch' ? groupValue : undefined,
          examType: target === 'examType' ? groupValue : undefined,
          ...settings,
          startDateTime: dateTimeToUtc(settings.startDateTime.slice(0, 10), settings.startDateTime.slice(11, 16), settings.timeZone),
          endDateTime: dateTimeToUtc(settings.endDateTime.slice(0, 10), settings.endDateTime.slice(11, 16), settings.timeZone),
          confirmReschedule,
          attemptLimit: settings.attemptLimit === 'unlimited' ? null : Number(settings.attemptLimit),
          allowDuplicateAssignment,
        }
        if (editing && selectedTests.length === 1) await mockTestAssignmentsAPI.update(editing._id, payload)
        else await mockTestAssignmentsAPI.create(payload)
        completed += 1
      }
      setNotice(editing ? 'Assignment updated successfully.' : `${completed} mock test${completed === 1 ? '' : 's'} assigned to ${estimatedRecipientIds.length} student${estimatedRecipientIds.length === 1 ? '' : 's'}.`)
      await reload()
      setView('list')
    } catch (submitError) {
      if (completed) {
        await reload()
        setError(`${messageOf(submitError)} ${completed} assignment${completed === 1 ? '' : 's'} were already created; review the assignments list before retrying.`)
      } else {
        setError(messageOf(submitError))
      }
    } finally {
      setSaving(false)
    }
  }

  const cancelAssignment = async (assignment: MockTestAssignment) => {
    if (!window.confirm(`Delete the schedule for "${assignment.mockTestName}"? If attempts exist, the assignment will be archived so history is preserved.`)) return
    setError('')
    try {
      const result = await mockTestAssignmentsAPI.cancel(assignment._id)
      setNotice(result.message)
      await reload()
    } catch (cancelError) {
      setError(messageOf(cancelError))
    }
  }

  const extendDeadline = async (assignment: MockTestAssignment) => {
    const zone = assignment.timeZone || 'Asia/Kolkata'
    const suggested = toZonedDateTime(new Date(new Date(assignment.endDateTime).getTime() + 24 * 60 * 60 * 1000), zone)
    const selected = window.prompt(`New end date and time in ${zone} (YYYY-MM-DDTHH:mm):`, suggested)
    if (!selected) return
    const confirmReschedule = ['active', 'expired'].includes(assignment.schedulingStatus)
      && window.confirm('This test is active or expired. Confirm the schedule change? Existing submissions will be preserved.')
    if (['active', 'expired'].includes(assignment.schedulingStatus) && !confirmReschedule) return
    setError('')
    try {
      await mockTestAssignmentsAPI.update(assignment._id, {
        startDateTime: assignment.startDateTime,
        endDateTime: dateTimeToUtc(selected.slice(0, 10), selected.slice(11, 16), zone),
        timeZone: zone,
        confirmReschedule,
        attemptLimit: assignment.attemptLimit,
        visibility: assignment.visibility,
        resultVisibility: assignment.resultVisibility,
        randomizeQuestions: assignment.randomizeQuestions,
        randomizeOptions: assignment.randomizeOptions,
        allowBackNavigation: assignment.allowBackNavigation,
        allowResume: assignment.allowResume,
      })
      setNotice('Assignment deadline extended.')
      await reload()
    } catch (extendError) {
      setError(messageOf(extendError))
    }
  }

  const showAttempts = async (assignment: MockTestAssignment) => {
    setError('')
    setAttemptsTitle(assignment.mockTestName)
    try {
      const result = await mockTestAssignmentsAPI.getAttempts(assignment._id)
      setAttempts(result.attempts)
    } catch (attemptError) {
      setError(messageOf(attemptError))
      setAttempts([])
    }
  }

  const groupName = target === 'all' ? 'All approved students'
    : target === 'students' ? `${selectedStudentIds.length} selected student${selectedStudentIds.length === 1 ? '' : 's'}`
      : target === 'batch' ? `Batch ${groupValue || '—'}`
        : target === 'branch' ? `${groupValue || 'Branch'} branch`
          : `${groupValue || 'Exam category'} category`

  return (
    <section className="amta-section">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <button type="button" style={{ ...secondaryStyle, marginBottom: 10, minHeight: 44 }} onClick={onBack}>← Mock tests</button>
          <h1 style={{ margin: 0, fontSize: 24 }}>Mock Test Assignments</h1>
          <p style={{ margin: '6px 0 0', color: '#64748b' }}>Assign saved tests to students and manage deadlines and attempts.</p>
        </div>
        {view === 'list' && <button type="button" style={{ ...actionStyle, minHeight: 44 }} onClick={() => startForm()}>Assign Mock Test</button>}
      </header>

      {error && <div role="alert" style={{ ...panelStyle, color: '#b91c1c', borderColor: '#fecaca', background: '#fef2f2' }}>{error}</div>}
      {notice && <div role="status" style={{ ...panelStyle, color: '#166534', borderColor: '#bbf7d0', background: '#f0fdf4' }}>{notice}</div>}

      {view === 'list' && (
        <>
          <div style={{ overflowX: 'auto', ...panelStyle }}>
            {loading ? <p>Loading tests and assignments…</p> : (
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 920 }}>
                <thead><tr>{['Mock Test', 'Test ID', 'Subject / Exam Type', 'Questions', 'Marks', 'Duration', 'Created', 'Assigned', 'Status', 'Actions'].map(title => <th key={title} style={{ textAlign: 'left', padding: 10, borderBottom: '1px solid #e2e8f0', fontSize: 12, color: '#64748b' }}>{title}</th>)}</tr></thead>
                <tbody>{tests.map(test => (
                  <tr key={test._id}>
                    <td style={{ padding: 10, borderBottom: '1px solid #f1f5f9', fontWeight: 700 }}>{test.title}</td>
                    <td style={{ padding: 10, borderBottom: '1px solid #f1f5f9', fontSize: 12 }}>{test._id}</td>
                    <td style={{ padding: 10, borderBottom: '1px solid #f1f5f9' }}>{test.subject} · {test.examType || '—'}</td>
                    <td style={{ padding: 10, borderBottom: '1px solid #f1f5f9' }}>{test.questionIds?.length || 0}</td>
                    <td style={{ padding: 10, borderBottom: '1px solid #f1f5f9' }}>{marks[test._id] ?? '—'}</td>
                    <td style={{ padding: 10, borderBottom: '1px solid #f1f5f9' }}>{test.duration} min</td>
                    <td style={{ padding: 10, borderBottom: '1px solid #f1f5f9' }}>{test.createdAt ? new Date(test.createdAt).toLocaleDateString('en-IN') : '—'}</td>
                    <td style={{ padding: 10, borderBottom: '1px solid #f1f5f9' }}>{new Set(assignments.filter(item => item.mockTestId === test._id && item.status === 'active').flatMap(item => item.studentIds)).size}</td>
                    <td style={{ padding: 10, borderBottom: '1px solid #f1f5f9' }}>{test.status}</td>
                    <td style={{ padding: 10, borderBottom: '1px solid #f1f5f9' }}><button type="button" style={secondaryStyle} onClick={() => startForm(test._id)}>Assign</button></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
          <div style={panelStyle}>
            <h2 style={{ marginTop: 0 }}>Assigned Mock Tests</h2>
            {assignments.length === 0 ? <p style={{ color: '#64748b' }}>No assignments yet.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
                  <thead><tr>{['Mock Test', 'Assigned Students', 'Start', 'End', 'Attempts', 'Status', 'Actions'].map(title => <th key={title} style={{ textAlign: 'left', padding: 10, borderBottom: '1px solid #e2e8f0' }}>{title}</th>)}</tr></thead>
                  <tbody>{assignments.map(assignment => (
                    <tr key={assignment._id}>
                      <td style={{ padding: 10, borderBottom: '1px solid #f1f5f9' }}><strong>{assignment.mockTestName}</strong><small style={{ display: 'block', color: '#64748b' }}>{assignment._id}</small></td>
                      <td style={{ padding: 10, borderBottom: '1px solid #f1f5f9' }}>{assignment.assignedStudentCount}</td>
                      <td style={{ padding: 10, borderBottom: '1px solid #f1f5f9' }}>{new Date(assignment.startDateTime).toLocaleString('en-IN', { timeZone: assignment.timeZone || 'Asia/Kolkata' })} ({assignment.timeZone || 'Asia/Kolkata'})</td>
                      <td style={{ padding: 10, borderBottom: '1px solid #f1f5f9' }}>{new Date(assignment.endDateTime).toLocaleString('en-IN', { timeZone: assignment.timeZone || 'Asia/Kolkata' })}</td>
                      <td style={{ padding: 10, borderBottom: '1px solid #f1f5f9' }}>{assignment.attemptLimit === null ? 'Unlimited' : assignment.attemptLimit}</td>
                      <td style={{ padding: 10, borderBottom: '1px solid #f1f5f9' }}>{assignment.schedulingStatus} · {assignment.status}</td>
                      <td style={{ padding: 10, borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button type="button" style={secondaryStyle} onClick={() => void showAttempts(assignment)}>View attempts</button>
                        <button type="button" style={secondaryStyle} onClick={() => void showAttempts(assignment)}>View results</button>
                        <button type="button" style={secondaryStyle} onClick={() => startForm(undefined, assignment)}>Edit</button>
                        <button type="button" style={secondaryStyle} onClick={() => startForm(assignment.mockTestId, undefined, true)}>Reassign</button>
                        <button type="button" style={secondaryStyle} onClick={() => void extendDeadline(assignment)}>Extend deadline</button>
                        {assignment.status === 'active' && <button type="button" style={{ ...secondaryStyle, color: '#b91c1c' }} onClick={() => void cancelAssignment(assignment)}>Delete schedule</button>}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
          {attemptsTitle && (
            <div style={panelStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <h3 style={{ marginTop: 0 }}>Attempts: {attemptsTitle}</h3>
                <button type="button" style={secondaryStyle} onClick={() => setAttemptsTitle('')}>Close</button>
              </div>
              {attempts.length === 0 ? <p>No student attempts found.</p> : <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Student ID', 'Attempt', 'Started', 'Submitted', 'Status', 'Score'].map(title => <th key={title} style={{ textAlign: 'left', padding: 8 }}>{title}</th>)}</tr></thead>
                <tbody>{attempts.map(attempt => <tr key={attempt._id}><td>{attempt.studentId}</td><td>{attempt.attemptNumber}</td><td>{new Date(attempt.startedAt).toLocaleString('en-IN')}</td><td>{attempt.submittedAt ? new Date(attempt.submittedAt).toLocaleString('en-IN') : '—'}</td><td>{attempt.status}</td><td>{attempt.score ?? '—'} / {attempt.totalMarks}</td></tr>)}</tbody>
              </table></div>}
            </div>
          )}
        </>
      )}

      {view === 'form' && (
        <>
          <div style={panelStyle}>
            <h2 style={{ marginTop: 0 }}>1. Select Mock Test{!editing && 's'}</h2>
            <div style={{ maxHeight: 250, overflow: 'auto' }}>
              {tests.map(test => <label key={test._id} style={{ display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid #f1f5f9', padding: '10px 4px' }}>
                <input type="checkbox" disabled={Boolean(editing)} checked={selectedTestIds.includes(test._id)} onChange={() => setSelectedTestIds(current => current.includes(test._id) ? current.filter(id => id !== test._id) : [...current, test._id])} />
                <span style={{ flex: 1 }}><strong>{test.title}</strong><small style={{ display: 'block', color: '#64748b' }}>{test._id} · {test.subject} · {test.examType || 'Exam type not set'} · {test.questionIds?.length || 0} questions · {marks[test._id] ?? '—'} marks · {test.duration} min · {test.status}</small></span>
              </label>)}
            </div>
          </div>

          <div style={panelStyle}>
            <h2 style={{ marginTop: 0 }}>2. Select Students</h2>
            <label style={{ display: 'block', maxWidth: 380, marginBottom: 12 }}>Assign to
              <select disabled={Boolean(editing)} style={{ ...inputStyle, marginTop: 5 }} value={target} onChange={event => { setTarget(event.target.value as Target); setGroupValue(''); setSelectedStudentIds([]) }}>
                <option value="all">All approved students</option><option value="students">Specific students</option><option value="batch">Batch / class</option><option value="branch">Branch</option><option value="examType">Exam category</option>
              </select>
            </label>
            {target === 'batch' && <label style={{ display: 'block', maxWidth: 380, marginBottom: 12 }}>Batch<select disabled={Boolean(editing)} style={{ ...inputStyle, marginTop: 5 }} value={groupValue} onChange={event => setGroupValue(event.target.value)}><option value="">Select batch</option>{availableBatches.map(batch => <option key={batch} value={batch}>{batch}</option>)}</select></label>}
            {target === 'branch' && <label style={{ display: 'block', maxWidth: 380, marginBottom: 12 }}>Branch<select disabled={Boolean(editing)} style={{ ...inputStyle, marginTop: 5 }} value={groupValue} onChange={event => setGroupValue(event.target.value)}><option value="">Select branch</option>{['Byculla', 'Worli', 'Prabhadevi'].map(branch => <option key={branch}>{branch}</option>)}</select></label>}
            {target === 'examType' && <label style={{ display: 'block', maxWidth: 380, marginBottom: 12 }}>Exam category<select disabled={Boolean(editing)} style={{ ...inputStyle, marginTop: 5 }} value={groupValue} onChange={event => setGroupValue(event.target.value)}><option value="">Select category</option>{['PCM', 'PCB', 'PCMB'].map(category => <option key={category}>{category}</option>)}</select></label>}
            {target === 'students' && (
              <>
                <input style={{ ...inputStyle, maxWidth: 500 }} value={studentSearch} onChange={event => setStudentSearch(event.target.value)} placeholder="Search by name, email, or student ID" />
                <div style={{ display: 'flex', gap: 8, margin: '10px 0' }}><button disabled={Boolean(editing)} style={secondaryStyle} type="button" onClick={() => toggleVisibleStudents(true)}>Select all shown</button><button disabled={Boolean(editing)} style={secondaryStyle} type="button" onClick={() => toggleVisibleStudents(false)}>Deselect shown</button><span style={{ alignSelf: 'center', color: '#475569' }}>{selectedStudentIds.length} selected</span></div>
                <div style={{ maxHeight: 240, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, padding: '0 10px' }}>
                  {filteredStudents.map(student => <label key={studentId(student)} style={{ display: 'flex', gap: 10, padding: 8, borderBottom: '1px solid #f1f5f9' }}><input type="checkbox" disabled={Boolean(editing)} checked={selectedStudentIds.includes(studentId(student))} onChange={() => toggleStudent(studentId(student))} /><span>{studentLabel(student)}<small style={{ display: 'block', color: '#64748b' }}>{student.branch || 'No branch'} · {student.batch || 'No batch'} · {student.examType || 'No exam category'}</small></span></label>)}
                  {!filteredStudents.length && <p style={{ color: '#64748b' }}>No approved students match this search/filter.</p>}
                </div>
                <div style={{ marginTop: 10, color: '#334155' }}><strong>Selected before assignment:</strong> {selectedStudents.length ? selectedStudents.map(student => student.name).join(', ') : 'No students selected'}</div>
              </>
            )}
            {target !== 'students' && <p style={{ color: '#334155' }}>Matching students: <strong>{estimatedRecipientIds.length}</strong>{target === 'examType' && !estimatedRecipientIds.length && <span> — confirm students have this exam category saved in their profile.</span>}</p>}
            {!editing && <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}><input type="checkbox" checked={allowDuplicateAssignment} onChange={event => setAllowDuplicateAssignment(event.target.checked)} />Allow intentional repeat assignments to students already assigned these tests.</label>}
          </div>

          <div style={panelStyle}>
            <h2 style={{ marginTop: 0 }}>3. Assignment Settings</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 14 }}>
              <label>Start date &amp; time<input type="datetime-local" style={{ ...inputStyle, marginTop: 5 }} value={settings.startDateTime} onChange={event => updateSettings('startDateTime', event.target.value)} /></label>
              <label>End date &amp; time<input type="datetime-local" style={{ ...inputStyle, marginTop: 5 }} value={settings.endDateTime} onChange={event => updateSettings('endDateTime', event.target.value)} /></label>
              <label>Time zone<select style={{ ...inputStyle, marginTop: 5 }} value={settings.timeZone} onChange={event => updateSettings('timeZone', event.target.value)}>{['Asia/Kolkata', 'UTC', 'Asia/Dubai', 'Europe/London', 'America/New_York'].map(zone => <option key={zone}>{zone}</option>)}</select></label>
              <label>Attempt limit<select style={{ ...inputStyle, marginTop: 5 }} value={settings.attemptLimit} onChange={event => updateSettings('attemptLimit', event.target.value)}><option value="1">1 attempt</option><option value="2">2 attempts</option><option value="3">3 attempts</option><option value="unlimited">Unlimited</option></select></label>
              <label>Test visibility<select style={{ ...inputStyle, marginTop: 5 }} value={settings.visibility} onChange={event => updateSettings('visibility', event.target.value as Settings['visibility'])}><option value="scheduled">Scheduled</option><option value="available">Available</option><option value="draft">Draft</option></select></label>
              <label>Result visibility<select style={{ ...inputStyle, marginTop: 5 }} value={settings.resultVisibility} onChange={event => updateSettings('resultVisibility', event.target.value as Settings['resultVisibility'])}><option value="immediate">Show immediately after submission</option><option value="after_close">Show after test closes</option><option value="admin_only">Admin only</option><option value="hidden">Hide result</option></select></label>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 16 }}>
              {([
                ['randomizeQuestions', 'Randomize questions'],
                ['randomizeOptions', 'Randomize answer options'],
                ['allowResume', 'Allow resume after interruption'],
              ] as const).map(([key, label]) => <label key={key} style={{ display: 'flex', gap: 7, alignItems: 'center' }}><input type="checkbox" checked={settings[key]} onChange={event => updateSettings(key, event.target.checked)} />{label}</label>)}
              <label style={{ display: 'flex', gap: 7, alignItems: 'center' }}><input type="checkbox" checked={!settings.allowBackNavigation} onChange={event => updateSettings('allowBackNavigation', !event.target.checked)} />Prevent back navigation</label>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}><button style={secondaryStyle} type="button" onClick={() => setView('list')}>Cancel</button><button style={actionStyle} type="button" onClick={() => { const validation = validate(); if (validation) setError(validation); else { setError(''); setView('review') } }}>Review assignment</button></div>
        </>
      )}

      {view === 'review' && (
        <div style={panelStyle}>
          <h2 style={{ marginTop: 0 }}>Confirm Assignment</h2>
          <p><strong>Mock Test:</strong> {selectedTests.map(test => test.title).join(', ')}</p>
          <p><strong>Students:</strong> {estimatedRecipientIds.length} ({groupName})</p>
          <p><strong>Selected students:</strong> {estimatedRecipients.slice(0, 30).map(student => student.name).join(', ')}{estimatedRecipients.length > 30 ? `, and ${estimatedRecipients.length - 30} more` : ''}</p>
          <p><strong>Start:</strong> {new Date(settings.startDateTime).toLocaleString('en-IN')}</p>
          <p><strong>End:</strong> {new Date(settings.endDateTime).toLocaleString('en-IN')}</p>
          <p><strong>Duration:</strong> {selectedTests.map(test => `${test.title}: ${test.duration} minutes`).join('; ')}</p>
          <p><strong>Attempts:</strong> {settings.attemptLimit === 'unlimited' ? 'Unlimited' : settings.attemptLimit}</p>
          <p><strong>Random Questions:</strong> {settings.randomizeQuestions ? 'Enabled' : 'Disabled'} · <strong>Random Options:</strong> {settings.randomizeOptions ? 'Enabled' : 'Disabled'}</p>
          <p><strong>Visibility:</strong> {settings.visibility} · <strong>Results:</strong> {settings.resultVisibility}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
            <button style={secondaryStyle} type="button" disabled={saving} onClick={() => setView('list')}>Cancel</button>
            <button style={secondaryStyle} type="button" disabled={saving} onClick={() => setView('form')}>Edit</button>
            <button style={actionStyle} type="button" disabled={saving} onClick={() => void submit()}>{saving ? 'Assigning…' : 'Confirm Assignment'}</button>
          </div>
        </div>
      )}
    </section>
  )
}
