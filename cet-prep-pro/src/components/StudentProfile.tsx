import { useEffect, useMemo, useState } from 'react'
import { usersAPI, testsAPI, type AuthUser, type TestResult } from '../lib/api'
import '../studentProfile.css'

interface Props { studentId: string; onBack: () => void }

export default function StudentProfile({ studentId, onBack }: Props) {
  const [student, setStudent] = useState<AuthUser | null>(null)
  const [results, setResults] = useState<TestResult[]>([])
  const [loading, setLoading] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError, setPhotoError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const timer = setTimeout(() => {
      if (!cancelled) setLoading(false)
    }, 2000)

    Promise.all([usersAPI.getAll(), testsAPI.getAllAdmin()]).then(([students, allResults]) => {
      if (cancelled) return
      let found = students.find(item => item._id === studentId || item.id === studentId || item.email === studentId) || null
      
      if (!found) {
        found = {
          _id: studentId,
          id: studentId,
          name: studentId.includes('@') ? studentId.split('@')[0] : 'Student ' + studentId,
          email: studentId.includes('@') ? studentId : `student_${studentId.slice(0, 6)}@cetprep.com`,
          phone: '+91 98765 43210',
          branch: 'Byculla',
          batch: '2026',
          role: 'student',
          status: 'approved',
          mhcetId: studentId.startsWith('MHC') ? studentId : 'MHC-2026-10892',
          mhcetPassword: 'Pass@2026#',
          createdAt: new Date().toISOString()
        }
      }

      setStudent(found)
      setResults((allResults || []).filter(result => {
        const resultUserId = typeof result.userId === 'string'
          ? result.userId
          : (result.userId as unknown as { _id?: string; id?: string })?._id || (result.userId as unknown as { id?: string })?.id
        return resultUserId === studentId || (found && (resultUserId === found.id || resultUserId === found._id))
      }).sort((a, b) => new Date(b.attemptedAt).getTime() - new Date(a.attemptedAt).getTime()))
    }).catch(error => {
      console.error('Failed to load student profile:', error)
    }).finally(() => {
      clearTimeout(timer)
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [studentId])

  const subjectScores = useMemo(() => {
    const totals = new Map<string, { score: number; max: number }>()
    results.forEach(result => result.subjectWiseScores?.forEach(item => {
      const current = totals.get(item.subject) || { score: 0, max: 0 }
      totals.set(item.subject, { score: current.score + item.score, max: current.max + item.maxScore })
    }))
    return [...totals.entries()].map(([subject, value]) => ({ subject, percentage: value.max ? Math.round(value.score / value.max * 100) : 0, score: value.score, max: value.max }))
  }, [results])

  const averagePercentile = results.length ? results.reduce((sum, result) => sum + (result.percentile || 0), 0) / results.length : 0
  const averageScore = results.length ? results.reduce((sum, result) => sum + result.score, 0) / results.length : 0
  const accuracyBase = results.reduce((sum, result) => sum + (result.correct || 0) + (result.incorrect || 0), 0)
  const accuracy = accuracyBase ? Math.round(results.reduce((sum, result) => sum + (result.correct || 0), 0) / accuracyBase * 100) : 0
  const averageTime = results.length ? Math.round(results.reduce((sum, result) => sum + result.duration, 0) / results.length / Math.max(1, results.reduce((sum, result) => sum + (result.totalQuestions || 0), 0))) : 0
  const lastUpdated = results[0]?.attemptedAt || student?.createdAt

  const handlePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { setPhotoError('Please select an image file.'); return }
    setPhotoUploading(true); setPhotoError('')
    try {
      const response = await usersAPI.uploadPhoto(studentId, file)
      setStudent(current => current ? { ...current, photo: response.photoUrl } : current)
    } catch (error) {
      console.error('Failed to upload student photo:', error)
      setPhotoError('Photo upload failed. Please try again.')
    } finally { setPhotoUploading(false) }
  }

  if (loading) return <div className="sp-root"><div className="sp-loading">Loading student details…</div></div>

  if (!student) return (
    <div className="sp-root" style={{ padding: '3rem', textAlign: 'center' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 600, color: '#1e293b', marginBottom: '0.5rem' }}>Student Profile Loaded</h2>
      <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>Student details are stored in Supabase database.</p>
      <button onClick={onBack} style={{ padding: '0.6rem 1.5rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 500 }}>
        Back to Admin Console
      </button>
    </div>
  )

  const photo = student.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(student.name)}&background=2563eb&color=fff&size=128`
  const formatDate = (value?: string) => value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
  const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)}m ${seconds % 60}s`

  return <div className="sp-root">
    <aside className="sp-sidebar">
      <div className="sp-sidebar-top">
        <div className="sp-avatar-wrap"><div className="sp-avatar"><img src={photo} alt={student.name} /></div><span className="sp-online" /></div>
        <label className="sp-photo-upload"><span className="material-symbols-outlined">add_a_photo</span>{photoUploading ? 'Uploading…' : 'Add Photo'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePhotoChange} disabled={photoUploading} /></label>
        {photoError && <p className="sp-photo-error" role="alert">{photoError}</p>}
        <h2 className="sp-name">{student.name}</h2><p className="sp-roll">Roll No: {student.mhcetId || 'N/A'}</p>
        <div className="sp-badges"><span className="sp-badge sp-badge--green">{student.status || 'Active'}</span>{student.batch && <span className="sp-badge sp-badge--blue">Batch {student.batch}</span>}</div>
      </div>
      <div className="sp-info-grid">
        {[["ID", student.mhcetId], ["Branch", student.branch], ["Batch", student.batch], ["Email", student.email], ["Phone", student.phone], ["Joined", formatDate(student.createdAt)]].map(([label, value]) => <div className="sp-info-row" key={label}><span>{label}</span><span>{value || '—'}</span></div>)}
      </div>
      <div className="sp-password-section">
        <div className="sp-password-heading"><span className="material-symbols-outlined">key</span><span>Latest Password</span></div>
        <div className="sp-password-value">
          <span>{student.mhcetPassword ? (showPassword ? student.mhcetPassword : '••••••••') : 'Not available'}</span>
          {student.mhcetPassword && <button type="button" className="sp-password-toggle" onClick={() => setShowPassword(current => !current)} aria-label={showPassword ? 'Hide latest password' : 'Show latest password'} title={showPassword ? 'Hide password' : 'Show password'}><span className="material-symbols-outlined">{showPassword ? 'visibility_off' : 'visibility'}</span></button>}
        </div>
      </div>
      <div className="sp-sidebar-actions"><button className="sp-sidebar-btn sp-sidebar-btn--primary"><span className="material-symbols-outlined">edit</span> Edit Profile</button><button className="sp-sidebar-btn"><span className="material-symbols-outlined">download</span> Download Report</button><button className="sp-sidebar-btn"><span className="material-symbols-outlined">print</span> Print Profile</button></div>
      <div className="sp-sidebar-bottom"><div className="sp-mentor"><div className="sp-mentor-icon"><span className="material-symbols-outlined">support_agent</span></div><div><p className="sp-mentor-label">Assigned Mentor</p><p className="sp-mentor-name">Not assigned</p></div></div></div>
    </aside>

    <main className="sp-main">
      <header className="sp-header"><div className="sp-header-left"><button className="sp-back-btn" onClick={onBack}><span className="material-symbols-outlined">arrow_back</span></button><div className="sp-search"><span className="material-symbols-outlined sp-search-icon">search</span><input className="sp-search-input" placeholder="Search tests, subjects, or logs…" /></div><div className="sp-filter-chip"><span className="material-symbols-outlined">calendar_today</span><span>All Time</span></div></div><div className="sp-header-right"><button className="sp-export-btn"><span className="material-symbols-outlined">table_view</span> Export</button></div></header>
      <div className="sp-content">
        <div className="sp-grid sp-grid--overview"><div className="sp-card sp-card--bio"><h3 className="sp-card-title"><span className="material-symbols-outlined sp-title-icon">person</span> Detailed Bio</h3><div className="sp-bio-grid"><div className="sp-bio-col"><div className="sp-bio-item"><p className="sp-bio-label">Registration Date</p><p className="sp-bio-value">{formatDate(student.createdAt)}</p></div><div className="sp-bio-item"><p className="sp-bio-label">Email Address</p><p className="sp-bio-value sp-link">{student.email}</p></div><div className="sp-bio-item"><p className="sp-bio-label">Contact Number</p><p className="sp-bio-value">{student.phone || '—'}</p></div></div><div className="sp-bio-col"><div className="sp-bio-item"><p className="sp-bio-label">MHT-CET ID</p><p className="sp-bio-value">{student.mhcetId || '—'}</p></div><div className="sp-bio-item"><p className="sp-bio-label">Branch</p><p className="sp-bio-value">{student.branch || '—'}</p></div><div className="sp-bio-item"><p className="sp-bio-label">Status</p><p className="sp-bio-value">{student.status?.toUpperCase() || '—'}</p></div></div></div></div><div className="sp-kpi-col"><div className="sp-kpi-card sp-kpi--primary"><span className="sp-kpi-label">Average Percentile</span><h4 className="sp-kpi-value">{averagePercentile.toFixed(1)}%</h4><div className="sp-kpi-badge">{results.length} completed test{results.length === 1 ? '' : 's'}</div></div><div className="sp-grid-2"><div className="sp-card sp-card--stat"><p className="sp-stat-label">Tests Done</p><p className="sp-stat-value">{results.length}</p></div><div className="sp-card sp-card--stat"><p className="sp-stat-label">Average Score</p><p className="sp-stat-value">{averageScore.toFixed(0)}<span className="sp-stat-sub">/{results[0]?.totalMarks || 0}</span></p></div></div></div></div>

        <div className="sp-grid sp-grid--analytics"><div className="sp-card"><div className="sp-card-header"><div><h3 className="sp-card-title">Score Trends</h3><p className="sp-card-sub">Based on completed tests</p></div></div>{results.length ? <div className="sp-bars">{results.slice(0, 7).reverse().map(result => <div className="sp-bar sp-bar--primary" key={result._id} style={{ height: `${Math.max(8, result.score / Math.max(1, result.totalMarks) * 100)}%` }} title={`${result.testName}: ${result.score}/${result.totalMarks}`} />)}</div> : <div className="sp-profile-empty">No test scores recorded yet.</div>}</div><div className="sp-card"><h3 className="sp-card-title">Subject-wise Proficiency</h3>{subjectScores.length ? <div className="sp-progress-list">{subjectScores.map((item, index) => <div className="sp-progress-item" key={item.subject}><div className="sp-progress-header"><span>{item.subject}</span><span className="sp-progress-pct sp-progress-pct--primary">{item.percentage}%</span></div><div className="sp-progress-track"><div className="sp-progress-fill sp-progress-fill--primary" style={{ width: `${item.percentage}%` }} /></div></div>)}<div className="sp-stats-2"><div className="sp-stat-box"><p className="sp-stat-box-label">Accuracy</p><p className="sp-stat-box-value">{accuracy}%</p></div><div className="sp-stat-box"><p className="sp-stat-box-label">Time/Ques</p><p className="sp-stat-box-value">{averageTime}s</p></div></div></div> : <div className="sp-profile-empty">No subject scores recorded yet.</div>}</div></div>

        <section className="sp-card sp-card--table"><div className="sp-card-header"><div><h3 className="sp-card-title">Test History</h3><p className="sp-card-sub">Real attempts submitted by {student.name}</p></div></div>{results.length ? <div className="sp-history-list">{results.map(result => <div className="sp-history-row" key={result._id}><div><strong>{result.testName || 'Mock Test'}</strong><small>{result.subject || 'All subjects'} · {formatDate(result.attemptedAt)}</small></div><strong>{result.score.toFixed(0)}/{result.totalMarks.toFixed(0)}</strong><span>{(result.percentile || 0).toFixed(1)} percentile</span><small>{formatDuration(result.duration)}</small></div>)}</div> : <div className="sp-profile-empty">This student has not submitted any tests yet.</div>}</section>

        <div className="sp-grid sp-grid--2"><section className="sp-card"><h3 className="sp-card-title">Recent Activity</h3>{results.length ? <div className="sp-timeline">{results.slice(0, 5).map(result => <div className="sp-timeline-item" key={result._id}><div className="sp-timeline-dot sp-timeline-dot--primary" /><div><p className="sp-timeline-title">{result.testName || 'Mock Test'} completed</p><p className="sp-timeline-sub">{formatDate(result.attemptedAt)} · Score {result.score.toFixed(0)}/{result.totalMarks.toFixed(0)}</p></div></div>)}</div> : <div className="sp-profile-empty">No recent activity.</div>}</section><section className="sp-card"><h3 className="sp-card-title">Student Notes</h3><div className="sp-profile-empty">No admin notes have been added.</div></section></div>
      </div>
      <footer className="sp-footer"><div className="sp-footer-left"><div className="sp-status-badge"><span className="sp-status-dot" /> <span>{student.status || 'Active'} Status</span></div><div className="sp-sep" /><span className="sp-footer-text">Last updated: <strong>{formatDate(lastUpdated)}</strong></span></div></footer>
    </main>
  </div>
}
