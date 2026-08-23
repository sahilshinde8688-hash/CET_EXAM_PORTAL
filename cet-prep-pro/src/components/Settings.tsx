import { useEffect, useMemo, useState } from 'react'
import Sidebar from './Sidebar'
import { session, testsAPI, usersAPI, type AuthUser, type TestResult } from '../lib/api'

type Page = 'signin' | 'dashboard' | 'mocktests' | 'results' | 'analytics' | 'settings' | 'admin-dashboard'

interface SettingsProps { onNavigate?: (page: Page) => void }

export default function Settings({ onNavigate }: SettingsProps) {
  const [user, setUser] = useState<AuthUser | null>(() => session.get<AuthUser>())
  const [results, setResults] = useState<TestResult[]>([])
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({ name: user?.name || '', phone: user?.phone || '', branch: user?.branch || '', batch: user?.batch?.toString() || '' })

  useEffect(() => {
    Promise.all([usersAPI.me(), testsAPI.getMyResults()]).then(([profile, history]) => {
      setUser(profile); setResults(history.sort((a, b) => new Date(b.attemptedAt).getTime() - new Date(a.attemptedAt).getTime()))
      setForm({ name: profile.name || '', phone: profile.phone || '', branch: profile.branch || '', batch: profile.batch?.toString() || '' })
    }).catch(error => console.error('Failed to load profile:', error))
  }, [])

  const averagePercentile = results.length ? results.reduce((sum, result) => sum + result.percentile, 0) / results.length : 0
  const averageScore = results.length ? results.reduce((sum, result) => sum + result.score, 0) / results.length : 0
  const chartResults = [...results].slice(0, 7).reverse()
  const subjects = useMemo(() => {
    const totals = new Map<string, { score: number; max: number }>()
    results.forEach(result => {
      if (result.subjectWiseScores?.length) result.subjectWiseScores.forEach(item => {
        const current = totals.get(item.subject) || { score: 0, max: 0 }
        totals.set(item.subject, { score: current.score + item.score, max: current.max + item.maxScore })
      })
    })
    return [...totals.entries()].map(([subject, value]) => ({ subject, percentage: value.max ? Math.round(value.score / value.max * 100) : 0 })).slice(0, 4)
  }, [results])
  const filteredResults = results.filter(result => `${result.testName} ${result.subject}`.toLowerCase().includes(query.toLowerCase())).slice(0, 5)

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setMessage('')
    try {
      const response = await usersAPI.updateProfile(form); setUser(response.user); session.save(response.user); setEditing(false); setMessage('Profile saved')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to save profile') } finally { setSaving(false) }
  }

  const exportResults = () => {
    const csv = ['Test,Subject,Score,Percentile,Date', ...results.map(result => [result.testName, result.subject, `${result.score}/${result.totalMarks}`, result.percentile, new Date(result.attemptedAt).toLocaleDateString()].join(','))].join('\n')
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = 'cet-test-history.csv'; link.click(); URL.revokeObjectURL(link.href)
  }

  return <div className="settings-root settings-profile-root">
    <Sidebar activePage="settings" onNavigate={onNavigate} />
    <main className="settings-profile-workspace">
      <header className="profile-toolbar"><div className="profile-search"><span className="material-symbols-outlined">search</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tests, subjects, or logs..." /></div><button className="profile-date"><span className="material-symbols-outlined">calendar_today</span>Last 30 Days<span className="material-symbols-outlined">expand_more</span></button><button className="profile-export" onClick={exportResults}><span className="material-symbols-outlined">table_view</span>Export</button></header>
      <div className="profile-page-heading"><div><p className="profile-kicker">Account settings</p><h1>Student profile</h1><p>Manage your details and review your preparation record.</p></div><button className="profile-edit-btn" onClick={() => setEditing(!editing)}><span className="material-symbols-outlined">{editing ? 'close' : 'edit'}</span>{editing ? 'Cancel' : 'Edit profile'}</button></div>
      {message && <p className="profile-save-message">{message}</p>}
      {editing ? <form className="profile-edit-form" onSubmit={saveProfile}><label>Full name<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} required /></label><label>Phone<input value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></label><label>Branch<input value={form.branch} onChange={event => setForm({ ...form, branch: event.target.value })} /></label><label>Batch<input value={form.batch} onChange={event => setForm({ ...form, batch: event.target.value })} /></label><button className="profile-save-btn" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button></form> : <>
        <section className="profile-overview-grid"><article className="profile-card profile-bio-card"><div className="profile-card-heading"><h2><span className="material-symbols-outlined">person</span>Detailed bio</h2><span className="profile-approved">{user?.status || 'Account'}</span></div><div className="profile-bio-grid"><div><small>Registration date</small><strong>{user?.createdAt ? new Date(user.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</strong></div><div><small>Email address</small><strong className="profile-blue">{user?.email || '—'}</strong></div><div><small>Contact number</small><strong>{user?.phone || '—'}</strong></div><div><small>Branch</small><strong>{user?.branch || '—'}</strong></div><div><small>MHT-CET ID</small><strong>{user?.mhcetId || 'Not assigned'}</strong></div><div><small>Batch</small><strong>{user?.batch || '—'}</strong></div></div></article><div className="profile-kpi-column"><article className="profile-percentile-card"><small>Average percentile</small><strong>{averagePercentile.toFixed(1)}%</strong><span>{results.length ? `${results.length} completed test${results.length === 1 ? '' : 's'}` : 'No completed tests yet'}</span></article><div className="profile-mini-grid"><article className="profile-mini-card"><small>Tests done</small><strong>{results.length}</strong></article><article className="profile-mini-card"><small>Average score</small><strong>{averageScore.toFixed(0)}<em>/{results[0]?.totalMarks || 200}</em></strong></article></div></div></section>
        <section className="profile-analytics-grid"><article className="profile-card profile-trend-card"><div className="profile-card-heading"><div><h2>Score trends</h2><p>Based on your completed tests</p></div><span className="profile-current-tag">CURRENT</span></div>{chartResults.length ? <><div className="profile-chart">{chartResults.map((result, index) => <div className="profile-chart-column" key={result._id}><div className="profile-chart-bar" style={{ height: `${Math.max(8, result.score / (result.totalMarks || 200) * 100)}%` }}><span>{Math.round(result.score)}</span></div><small>T-{index + 1}</small></div>)}</div></> : <div className="profile-empty">Complete a mock test to see your score trend.</div>}</article><article className="profile-card profile-subject-card"><div className="profile-card-heading"><h2>Subject-wise proficiency</h2></div>{subjects.length ? subjects.map((item, index) => <div className="profile-subject-row" key={item.subject}><div><strong>{item.subject}</strong><span>{item.percentage}%</span></div><div className={`profile-subject-track profile-subject-track--${index % 3}`}><i style={{ width: `${item.percentage}%` }} /></div></div>) : <div className="profile-empty">Subject insights appear after a test with subject scores.</div>}</article></section>
        <section className="profile-card profile-history-card"><div className="profile-card-heading"><div><h2>Test history</h2><p>Your latest completed attempts</p></div><button className="profile-archive-btn" onClick={() => onNavigate?.('results')}>View full archive<span className="material-symbols-outlined">arrow_forward</span></button></div>{filteredResults.length ? <div className="profile-history-list">{filteredResults.map(result => <div className="profile-history-row" key={result._id}><div className="profile-history-icon"><span className="material-symbols-outlined">{result.subject?.toLowerCase().includes('math') ? 'calculate' : 'assignment_turned_in'}</span></div><div className="profile-history-name"><strong>{result.testName || 'Mock test'}</strong><small>{result.subject || 'All subjects'} · {new Date(result.attemptedAt).toLocaleDateString()}</small></div><strong className="profile-history-score">{Math.round(result.score)}/{result.totalMarks}</strong><span className="profile-history-percentile">{result.percentile.toFixed(1)} percentile</span><span className="profile-history-status">Completed</span></div>)}</div> : <div className="profile-empty">No tests match your search.</div>}</section>
      </>}
    </main>
  </div>
}
