import { useEffect, useMemo, useState } from 'react'
import {
  mockTestsAPI,
  questionsAPI,
  testsAPI,
  usersAPI,
  type AuthUser,
  type MockTest,
  type Question,
  type TestResult,
} from '../lib/api'
import '../adminAnalysis.css'

type AnalysisTab = 'overview' | 'students' | 'tests' | 'subjects' | 'questions' | 'leaderboard' | 'reports'
type DateRange = 'all' | '7' | '30' | '90'

type StudentMetric = {
  id: string
  name: string
  email: string
  attempts: number
  average: number
  best: number
  accuracy: number
  correct: number
  incorrect: number
  skipped: number
  lastAttempt?: string
}

type SubjectMetric = {
  subject: string
  attempts: number
  score: number
  accuracy: number
  correct: number
  questions: number
  time: number
}

const asNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
const percent = (value: number, total: number) => total > 0 ? Math.round((value / total) * 100) : 0
const dateLabel = (value?: string) => value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '-'
const fullDate = (value?: string) => value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'

function getStudentId(result: TestResult) {
  return typeof result.userId === 'object' ? String(result.userId?._id || result.userId?.email || '') : String(result.userId || '')
}

function getStudentName(result: TestResult) {
  return typeof result.userId === 'object' ? result.userId?.name || result.userId?.email || 'Unknown student' : 'Student'
}

function downloadCsv(filename: string, rows: Array<Record<string, string | number>>) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const csv = [headers.join(','), ...rows.map(row => headers.map(header => JSON.stringify(row[header] ?? '')).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function BarList({ items, empty = 'No data available for this range.' }: { items: Array<{ label: string; value: number; detail?: string }>; empty?: string }) {
  if (!items.length) return <div className="aa-empty">{empty}</div>
  const max = Math.max(...items.map(item => item.value), 1)
  return <div className="aa-bars">{items.map(item => (
    <div className="aa-bar-row" key={item.label}>
      <div className="aa-bar-label"><span>{item.label}</span><strong>{item.detail || item.value}</strong></div>
      <div className="aa-bar-track"><span style={{ width: `${Math.max(3, (item.value / max) * 100)}%` }} /></div>
    </div>
  ))}</div>
}

export default function AdminAnalysis() {
  const [tab, setTab] = useState<AnalysisTab>('overview')
  const [range, setRange] = useState<DateRange>('30')
  const [search, setSearch] = useState('')
  const [studentFilter, setStudentFilter] = useState('All students')
  const [testFilter, setTestFilter] = useState('All tests')
  const [results, setResults] = useState<TestResult[]>([])
  const [students, setStudents] = useState<AuthUser[]>([])
  const [tests, setTests] = useState<MockTest[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([
      testsAPI.getAllAdmin(),
      usersAPI.getAll('approved'),
      mockTestsAPI.getAll(),
      questionsAPI.getAll({ isActive: true, includeAnswers: true }),
    ]).then(([loadedResults, loadedStudents, loadedTests, loadedQuestions]) => {
      if (cancelled) return
      setResults(loadedResults)
      setStudents(loadedStudents)
      setTests(loadedTests)
      setQuestions(loadedQuestions)
    }).catch((loadError: unknown) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Unable to load analytics data.')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const filteredResults = useMemo(() => {
    const cutoff = range === 'all' ? 0 : Date.now() - Number(range) * 24 * 60 * 60 * 1000
    return results.filter(result => {
      const studentName = getStudentName(result).toLowerCase()
      const matchesSearch = !search.trim() || studentName.includes(search.toLowerCase()) || result.testName.toLowerCase().includes(search.toLowerCase()) || result.subject.toLowerCase().includes(search.toLowerCase())
      const matchesStudent = studentFilter === 'All students' || getStudentId(result) === studentFilter
      const matchesTest = testFilter === 'All tests' || result.testName === testFilter
      return matchesSearch && matchesStudent && matchesTest && new Date(result.attemptedAt).getTime() >= cutoff
    })
  }, [range, results, search, studentFilter, testFilter])

  const metrics = useMemo(() => {
    const totalScore = filteredResults.reduce((sum, result) => sum + asNumber(result.score), 0)
    const totalMarks = filteredResults.reduce((sum, result) => sum + asNumber(result.totalMarks), 0)
    const correct = filteredResults.reduce((sum, result) => sum + asNumber(result.correct), 0)
    const incorrect = filteredResults.reduce((sum, result) => sum + asNumber(result.incorrect), 0)
    const skipped = filteredResults.reduce((sum, result) => sum + asNumber(result.unanswered), 0)
    const questionsAttempted = correct + incorrect + skipped
    const completed = filteredResults.filter(result => asNumber(result.unanswered) === 0).length
    return {
      attempts: filteredResults.length,
      averageScore: filteredResults.length ? totalScore / filteredResults.length : 0,
      averageAccuracy: percent(correct, questionsAttempted),
      highestScore: filteredResults.length ? Math.max(...filteredResults.map(result => asNumber(result.score))) : 0,
      completionRate: percent(completed, filteredResults.length),
      correct,
      incorrect,
      skipped,
      totalMarks,
    }
  }, [filteredResults])

  const studentMetrics = useMemo<StudentMetric[]>(() => {
    const map = new Map<string, StudentMetric>()
    filteredResults.forEach(result => {
      const id = getStudentId(result) || getStudentName(result)
      const existing = map.get(id) || { id, name: getStudentName(result), email: typeof result.userId === 'object' ? result.userId?.email || '' : '', attempts: 0, average: 0, best: 0, accuracy: 0, correct: 0, incorrect: 0, skipped: 0, lastAttempt: result.attemptedAt }
      existing.attempts += 1
      existing.average += asNumber(result.score)
      existing.best = Math.max(existing.best, asNumber(result.score))
      existing.correct += asNumber(result.correct)
      existing.incorrect += asNumber(result.incorrect)
      existing.skipped += asNumber(result.unanswered)
      if (!existing.lastAttempt || new Date(result.attemptedAt) > new Date(existing.lastAttempt)) existing.lastAttempt = result.attemptedAt
      map.set(id, existing)
    })
    return [...map.values()].map(student => ({ ...student, average: student.attempts ? student.average / student.attempts : 0, accuracy: percent(student.correct, student.correct + student.incorrect + student.skipped) })).sort((a, b) => b.average - a.average)
  }, [filteredResults])

  const subjectMetrics = useMemo<SubjectMetric[]>(() => {
    const map = new Map<string, SubjectMetric>()
    filteredResults.forEach(result => {
      const scores = result.subjectWiseScores?.length ? result.subjectWiseScores : [{ subject: result.subject || 'Uncategorized', score: result.score, maxScore: result.totalMarks, percentage: percent(result.score, result.totalMarks) }]
      scores.forEach(item => {
        const subject = item.subject || 'Uncategorized'
        const existing = map.get(subject) || { subject, attempts: 0, score: 0, accuracy: 0, correct: 0, questions: 0, time: 0 }
        existing.attempts += 1
        existing.score += asNumber(item.percentage)
        existing.time += asNumber(result.duration)
        map.set(subject, existing)
      })
      const subject = result.subject || 'Uncategorized'
      const existing = map.get(subject)
      if (existing) {
        existing.correct += asNumber(result.correct)
        existing.questions += asNumber(result.totalQuestions)
      }
    })
    return [...map.values()].map(item => ({ ...item, score: item.attempts ? item.score / item.attempts : 0, accuracy: percent(item.correct, item.questions), time: item.attempts ? item.time / item.attempts : 0 })).sort((a, b) => b.score - a.score)
  }, [filteredResults])

  const testMetrics = useMemo(() => [...new Set(filteredResults.map(result => result.testName))].map(testName => {
    const rows = filteredResults.filter(result => result.testName === testName)
    const scores = rows.map(result => asNumber(result.score))
    const correct = rows.reduce((sum, result) => sum + asNumber(result.correct), 0)
    const total = rows.reduce((sum, result) => sum + asNumber(result.totalQuestions), 0)
    return { testName, attempts: rows.length, average: scores.reduce((sum, score) => sum + score, 0) / rows.length, highest: Math.max(...scores), lowest: Math.min(...scores), accuracy: percent(correct, total), completion: percent(rows.filter(result => !asNumber(result.unanswered)).length, rows.length) }
  }).sort((a, b) => b.attempts - a.attempts), [filteredResults])

  const questionMetrics = useMemo(() => {
    const map = new Map<string, { id: string; attempts: number; optionCounts: number[] }>()
    filteredResults.forEach(result => Object.entries(result.answers || {}).forEach(([id, answer]) => {
      const current = map.get(id) || { id, attempts: 0, optionCounts: [] }
      current.attempts += 1
      const option = Number(answer)
      current.optionCounts[option] = (current.optionCounts[option] || 0) + 1
      map.set(id, current)
    }))
    return [...map.values()].sort((a, b) => b.attempts - a.attempts).slice(0, 12)
  }, [filteredResults])

  const trend = useMemo(() => {
    const map = new Map<string, { attempts: number; score: number }>()
    filteredResults.forEach(result => {
      const key = new Date(result.attemptedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
      const current = map.get(key) || { attempts: 0, score: 0 }
      current.attempts += 1
      current.score += asNumber(result.score)
      map.set(key, current)
    })
    return [...map.entries()].slice(-10).map(([label, value]) => ({ label, value: value.attempts, detail: `${value.attempts} attempt${value.attempts === 1 ? '' : 's'}` }))
  }, [filteredResults])

  const exportRows = () => downloadCsv('cet-admin-analytics.csv', filteredResults.map(result => ({ student: getStudentName(result), test: result.testName, subject: result.subject, score: result.score, totalMarks: result.totalMarks, accuracy: percent(asNumber(result.correct), asNumber(result.totalQuestions)), attemptedAt: fullDate(result.attemptedAt) })))

  const tabs: Array<{ id: AnalysisTab; label: string; icon: string }> = [
    { id: 'overview', label: 'Overview', icon: 'dashboard' },
    { id: 'students', label: 'Students', icon: 'group' },
    { id: 'tests', label: 'Tests', icon: 'quiz' },
    { id: 'subjects', label: 'Subjects & Chapters', icon: 'category' },
    { id: 'questions', label: 'Questions', icon: 'help' },
    { id: 'leaderboard', label: 'Leaderboard', icon: 'leaderboard' },
    { id: 'reports', label: 'Reports', icon: 'download' },
  ]

  if (loading) return <div className="aa-state"><span className="material-symbols-outlined">progress_activity</span><h2>Loading analytics</h2><p>Collecting students, tests, questions, and attempt history.</p></div>
  if (error) return <div className="aa-state aa-state--error"><span className="material-symbols-outlined">error</span><h2>Analytics unavailable</h2><p>{error}</p><button type="button" onClick={() => window.location.reload()}>Retry</button></div>

  return (
    <section className="aa-root">
      <div className="aa-heading"><div><p className="aa-kicker">Admin reporting</p><h1>Analysis Dashboard</h1><p>Live performance intelligence from the portal&apos;s students and test results.</p></div><div className="aa-heading-actions"><button type="button" onClick={exportRows}><span className="material-symbols-outlined">download</span>Export CSV</button><button type="button" className="aa-button aa-button--dark" onClick={() => window.print()}><span className="material-symbols-outlined">picture_as_pdf</span>Print / PDF</button></div></div>
      <div className="aa-toolbar"><div className="aa-tabs">{tabs.map(item => <button key={item.id} type="button" className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)}><span className="material-symbols-outlined">{item.icon}</span>{item.label}</button>)}</div><div className="aa-filters"><label><span className="material-symbols-outlined">search</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search students, tests..." /></label><select value={range} onChange={event => setRange(event.target.value as DateRange)}><option value="all">All time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></div></div>
      <div className="aa-filter-row"><select value={studentFilter} onChange={event => setStudentFilter(event.target.value)}><option>All students</option>{students.map(student => <option key={student._id} value={student._id}>{student.name}</option>)}</select><select value={testFilter} onChange={event => setTestFilter(event.target.value)}><option>All tests</option>{tests.map(test => <option key={test._id} value={test.title}>{test.title}</option>)}</select><span>{filteredResults.length.toLocaleString()} attempt{filteredResults.length === 1 ? '' : 's'} in view</span></div>

      {tab === 'overview' && <>
        <div className="aa-kpis">{[
          ['Total students', students.length, 'group'], ['Total tests', tests.length, 'quiz'], ['Total questions', questions.length, 'database'], ['Total attempts', metrics.attempts, 'history'], ['Average score', metrics.averageScore.toFixed(1), 'speed'], ['Average accuracy', `${metrics.averageAccuracy}%`, 'target'], ['Highest score', metrics.highestScore, 'workspace_premium'], ['Completion rate', `${metrics.completionRate}%`, 'task_alt'],
        ].map(([label, value, icon]) => <div className="aa-kpi" key={String(label)}><span className="material-symbols-outlined">{icon}</span><p>{label}</p><strong>{value}</strong></div>)}</div>
        <div className="aa-grid aa-grid--overview"><article className="aa-card aa-card--wide"><div className="aa-card-heading"><div><h2>Attempts and registration activity</h2><p>Daily attempt volume for the selected date range.</p></div><span className="aa-card-badge">{metrics.attempts} total</span></div><BarList items={trend} /></article><article className="aa-card"><div className="aa-card-heading"><div><h2>Outcome mix</h2><p>Across all visible attempts.</p></div></div><div className="aa-outcome"><div><strong>{metrics.correct}</strong><span>Correct</span></div><div><strong>{metrics.incorrect}</strong><span>Wrong</span></div><div><strong>{metrics.skipped}</strong><span>Skipped</span></div></div><div className="aa-donut"><span style={{ background: '#2563eb', flex: metrics.correct || 1 }} /><span style={{ background: '#ef4444', flex: metrics.incorrect || 1 }} /><span style={{ background: '#cbd5e1', flex: metrics.skipped || 1 }} /></div></article></div>
        <div className="aa-grid"><article className="aa-card"><div className="aa-card-heading"><div><h2>Subject performance</h2><p>Accuracy and average percentage by subject.</p></div></div><BarList items={subjectMetrics.map(item => ({ label: item.subject, value: item.accuracy, detail: `${item.accuracy}% accuracy` }))} /></article><article className="aa-card"><div className="aa-card-heading"><div><h2>Top students</h2><p>Highest average scores in view.</p></div></div><div className="aa-ranking">{studentMetrics.slice(0, 5).map((student, index) => <div key={student.id}><b>{index + 1}</b><span>{student.name}</span><strong>{student.average.toFixed(1)}</strong></div>)}</div></article></div>
      </>}

      {tab === 'students' && <DataTable title="Student analysis" subtitle="Attempts, scores, accuracy, and answer outcomes by student." headers={['Student', 'Tests attempted', 'Average score', 'Best score', 'Accuracy', 'Correct / Wrong / Skipped', 'Last attempt']} rows={studentMetrics.map(student => [student.name, student.attempts, student.average.toFixed(1), student.best, `${student.accuracy}%`, `${student.correct} / ${student.incorrect} / ${student.skipped}`, fullDate(student.lastAttempt)])} empty="No student attempts match the current filters." />}
      {tab === 'tests' && <DataTable title="Test analysis" subtitle="Compare attempts, scores, accuracy, and completion by test." headers={['Test', 'Attempts', 'Average', 'Highest', 'Lowest', 'Accuracy', 'Completion']} rows={testMetrics.map(test => [test.testName, test.attempts, test.average.toFixed(1), test.highest, test.lowest, `${test.accuracy}%`, `${test.completion}%`])} empty="No test attempts match the current filters." />}
      {tab === 'subjects' && <DataTable title="Subject and chapter analysis" subtitle="Subject metrics are computed from stored subject-wise result snapshots." headers={['Subject', 'Attempts', 'Average %', 'Accuracy', 'Correct', 'Questions', 'Avg time']} rows={subjectMetrics.map(subject => [subject.subject, subject.attempts, `${subject.score.toFixed(1)}%`, `${subject.accuracy}%`, subject.correct, subject.questions, `${Math.round(subject.time / 60)}m`])} empty="No subject data is available in the selected range." />}
      {tab === 'questions' && <DataTable title="Question analysis" subtitle="Question attempts and selected option distribution from stored answer snapshots." headers={['Question ID', 'Attempts', 'Most selected option', 'Option distribution']} rows={questionMetrics.map(question => { const option = question.optionCounts.indexOf(Math.max(...question.optionCounts)); return [question.id, question.attempts, option >= 0 ? `Option ${option + 1}` : '-', question.optionCounts.map((count, index) => `${index + 1}:${count || 0}`).join('  ')] })} empty="No answer-level snapshots are stored for the selected attempts." />}
      {tab === 'leaderboard' && <>
        <LeaderboardShowcase students={studentMetrics.slice(0, 6)} />
        <DataTable title="Overall leaderboard" subtitle="Ranked by average score across the selected attempts." headers={['Rank', 'Student', 'Attempts', 'Average score', 'Best score', 'Accuracy', 'Percentile']} rows={studentMetrics.map((student, index) => { const bestResult = filteredResults.filter(result => getStudentId(result) === student.id).sort((a, b) => asNumber(b.score) - asNumber(a.score))[0]; return [index + 1, student.name, student.attempts, student.average.toFixed(1), student.best, `${student.accuracy}%`, bestResult?.percentile ? `${asNumber(bestResult.percentile).toFixed(1)}%` : '-'] })} empty="No leaderboard data is available." />
      </>}
      {tab === 'reports' && <div className="aa-report-panel"><div><p className="aa-kicker">Export center</p><h2>Build a filtered report</h2><p>Current filters include {filteredResults.length} attempts, {studentMetrics.length} students, and {subjectMetrics.length} subjects. Export the same view as CSV or use the browser print dialog to save PDF.</p></div><div className="aa-report-actions"><button type="button" onClick={exportRows}><span className="material-symbols-outlined">table_view</span>Download CSV</button><button type="button" className="aa-button aa-button--dark" onClick={() => window.print()}><span className="material-symbols-outlined">picture_as_pdf</span>Save as PDF</button></div></div>}
    </section>
  )
}

function LeaderboardShowcase({ students }: { students: StudentMetric[] }) {
  const podium = [students[1], students[0], students[2]]
  return <section className="aa-leaderboard-showcase">
    <div className="aa-leaderboard-heading"><div><p className="aa-kicker">Top performers</p><h2>Leaderboard spotlight</h2><p>Celebrating the strongest average scores in the selected period.</p></div><span className="aa-leaderboard-season"><span className="material-symbols-outlined">emoji_events</span>Live rankings</span></div>
    <div className="aa-podium">{podium.map((student, index) => student ? <div key={student.id} className={`aa-podium-place aa-podium-place--${index === 1 ? 'first' : index === 0 ? 'second' : 'third'}`}>
      <div className="aa-podium-avatar">{student.name.trim().charAt(0).toUpperCase() || 'S'}</div>
      <strong>{student.name}</strong><span>{student.attempts} test{student.attempts === 1 ? '' : 's'} · {student.accuracy}% accuracy</span><b>{student.average.toFixed(1)} avg</b><div className="aa-podium-column"><span>{index === 1 ? '1' : index === 0 ? '2' : '3'}</span></div>
    </div> : <div key={index} className="aa-podium-place aa-podium-place--empty"><div className="aa-podium-column"><span>-</span></div></div>)}</div>
    <div className="aa-leaderboard-list">{students.slice(3).map((student, index) => <div key={student.id}><span className="aa-list-rank">{index + 4}</span><span className="aa-list-avatar">{student.name.trim().charAt(0).toUpperCase() || 'S'}</span><strong>{student.name}</strong><span>{student.attempts} attempts</span><b>{student.average.toFixed(1)} avg</b></div>)}</div>
  </section>
}

function DataTable({ title, subtitle, headers, rows, empty }: { title: string; subtitle: string; headers: string[]; rows: Array<Array<string | number>>; empty: string }) {
  const [page, setPage] = useState(0)
  const [sortIndex, setSortIndex] = useState<number | null>(null)
  const [descending, setDescending] = useState(false)
  const pageSize = 10
  const sortedRows = useMemo(() => {
    if (sortIndex === null) return rows
    return [...rows].sort((left, right) => {
      const a = left[sortIndex]
      const b = right[sortIndex]
      const numericA = Number(a)
      const numericB = Number(b)
      const comparison = Number.isNaN(numericA) || Number.isNaN(numericB)
        ? String(a).localeCompare(String(b))
        : numericA - numericB
      return descending ? -comparison : comparison
    })
  }, [descending, rows, sortIndex])
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const visibleRows = sortedRows.slice(page * pageSize, (page + 1) * pageSize)
  useEffect(() => { setPage(0) }, [rows])
  const isLeaderboard = title.toLowerCase().includes('leaderboard')
  return <article className={`aa-card aa-table-card${isLeaderboard ? ' aa-table-card--leaderboard' : ''}`}><div className="aa-card-heading"><div><h2>{title}</h2><p>{subtitle}</p></div><span className="aa-card-badge">{rows.length} rows</span></div>{rows.length ? <><div className="aa-table-wrap"><table><thead><tr>{headers.map((header, headerIndex) => <th key={header}><button type="button" onClick={() => { if (sortIndex === headerIndex) setDescending(value => !value); else { setSortIndex(headerIndex); setDescending(false) } }}>{header}<span className="material-symbols-outlined">{sortIndex === headerIndex ? (descending ? 'south' : 'north') : 'unfold_more'}</span></button></th>)}</tr></thead><tbody>{visibleRows.map((row, rowIndex) => <tr key={`${page}-${rowIndex}`}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div><div className="aa-pagination"><span>Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, sortedRows.length)} of {sortedRows.length}</span><div><button type="button" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous</button><strong>{page + 1} / {pageCount}</strong><button type="button" disabled={page >= pageCount - 1} onClick={() => setPage(value => value + 1)}>Next</button></div></div></> : <div className="aa-empty">{empty}</div>}</article>
}
