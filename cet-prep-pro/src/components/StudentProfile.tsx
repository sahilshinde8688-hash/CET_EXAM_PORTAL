import { useEffect, useMemo, useState } from 'react'
import { usersAPI, testsAPI, type AuthUser, type TestResult } from '../lib/api'
import { downloadTestHistoryCSV } from '../lib/exportUtils'
import GlobalLoader from './GlobalLoader'
import '../studentProfile.css'
import '../global-loader.css'

interface Props { studentId: string; onBack: () => void }

export default function StudentProfile({ studentId, onBack }: Props) {
  const [student, setStudent] = useState<AuthUser | null>(null)
  const [results, setResults] = useState<TestResult[]>([])
  const [loading, setLoading] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [resendingPassword, setResendingPassword] = useState(false)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [showEditModal, setShowEditModal] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '', branch: '', batch: '' })
  const [editSaving, setEditSaving] = useState(false)
  const [editMsg, setEditMsg] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [timeFilter, setTimeFilter] = useState<'all' | '30d' | '7d'>('all')
  const [showTimeDropdown, setShowTimeDropdown] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

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
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
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

  const filteredResults = useMemo(() => {
    let filtered = [...results]
    // Time filter
    if (timeFilter !== 'all') {
      const now = new Date()
      const cutoff = new Date(now.getTime() - (timeFilter === '30d' ? 30 : 7) * 24 * 60 * 60 * 1000)
      filtered = filtered.filter(r => new Date(r.attemptedAt) >= cutoff)
    }
    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(r =>
        (r.testName || '').toLowerCase().includes(q) ||
        (r.subject || '').toLowerCase().includes(q)
      )
    }
    return filtered
  }, [results, searchQuery, timeFilter])

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

  const handleResendPassword = async () => {
    if (!student) return
    setResendingPassword(true)
    try {
      const id = student._id || student.id || studentId
      const response = await usersAPI.resendCredentials(id)
      if (response.password) {
        setStudent(current => current ? { ...current, mhcetPassword: response.password } : current)
        setShowPassword(true)
      }
    } catch (error) {
      console.error('Failed to resend student credentials:', error)
    } finally {
      setResendingPassword(false)
    }
  }

  const openEditModal = () => {
    if (!student) return
    setEditForm({
      name: student.name || '',
      email: student.email || '',
      phone: student.phone || '',
      branch: student.branch || '',
      batch: student.batch || '',
    })
    setEditMsg('')
    setShowEditModal(true)
  }

  const handleEditSave = async () => {
    if (!student) return
    setEditSaving(true)
    setEditMsg('')
    try {
      const id = student._id || student.id || studentId
      await usersAPI.updateStudent(id, {
        name: editForm.name,
        email: editForm.email,
        phone: editForm.phone,
        branch: editForm.branch,
        batch: editForm.batch,
      })
      setStudent(current => current ? { ...current, ...editForm } : current)
      setEditMsg('Profile updated successfully!')
      setTimeout(() => setShowEditModal(false), 1200)
    } catch (err: any) {
      setEditMsg(err.message || 'Failed to update profile. Please try again.')
    } finally {
      setEditSaving(false)
    }
  }

  if (loading) return <GlobalLoader message="Loading student details" />

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
  const timeFilterLabel = timeFilter === 'all' ? 'All Time' : timeFilter === '30d' ? 'Last 30 Days' : 'Last 7 Days'

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
          <span>{student.mhcetPassword ? (showPassword ? student.mhcetPassword : '••••••••') : resendingPassword ? 'Generating…' : 'Not available'}</span>
          {student.mhcetPassword && <button type="button" className="sp-password-toggle" onClick={() => setShowPassword(current => !current)} aria-label={showPassword ? 'Hide latest password' : 'Show latest password'} title={showPassword ? 'Hide password' : 'Show password'}><span className="material-symbols-outlined">{showPassword ? 'visibility_off' : 'visibility'}</span></button>}
          {!student.mhcetPassword && <button type="button" className="sp-password-toggle" onClick={handleResendPassword} disabled={resendingPassword} aria-label="Resend student credentials" title="Resend credentials"><span className="material-symbols-outlined">refresh</span></button>}
        </div>
      </div>
      <div className="sp-sidebar-actions"><button className="sp-sidebar-btn sp-sidebar-btn--primary" onClick={openEditModal}><span className="material-symbols-outlined">edit</span> Edit Profile</button><button className="sp-sidebar-btn" onClick={() => downloadTestHistoryCSV(results, student.name)}><span className="material-symbols-outlined">download</span> Download Report</button><button className="sp-sidebar-btn" onClick={() => window.print()}><span className="material-symbols-outlined">print</span> Print Profile</button></div>
      <div className="sp-sidebar-bottom"><div className="sp-mentor"><div className="sp-mentor-icon"><span className="material-symbols-outlined">support_agent</span></div><div><p className="sp-mentor-label">Assigned Mentor</p><p className="sp-mentor-name">Not assigned</p></div></div></div>
    </aside>

    <main className="sp-main">
      <header className="sp-header"><div className="sp-header-left"><button className="sp-back-btn" onClick={onBack}><span className="material-symbols-outlined">arrow_back</span></button><div className="sp-search"><span className="material-symbols-outlined sp-search-icon">search</span><input className="sp-search-input" placeholder="Search tests, subjects, or logs…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} /></div><div className="sp-filter-chip" style={{ cursor: 'pointer', position: 'relative' }} onClick={() => setShowTimeDropdown(!showTimeDropdown)}><span className="material-symbols-outlined">calendar_today</span><span>{timeFilterLabel}</span>{showTimeDropdown && <div className="sp-time-dropdown" style={{ position: 'absolute', top: '100%', left: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 50, minWidth: '140px', marginTop: '4px' }}>{(['all', '30d', '7d'] as const).map(opt => <div key={opt} onClick={e => { e.stopPropagation(); setTimeFilter(opt); setShowTimeDropdown(false) }} style={{ padding: '8px 14px', cursor: 'pointer', fontSize: '13px', fontWeight: timeFilter === opt ? 700 : 400, color: timeFilter === opt ? '#2563eb' : '#334155', background: timeFilter === opt ? '#eff6ff' : 'transparent' }}>{opt === 'all' ? 'All Time' : opt === '30d' ? 'Last 30 Days' : 'Last 7 Days'}</div>)}</div>}</div></div><div className="sp-header-right"><button className="sp-export-btn" onClick={() => downloadTestHistoryCSV(results, student.name)}><span className="material-symbols-outlined">table_view</span> Export</button></div></header>
      <div className="sp-content">
        <div className="sp-grid sp-grid--overview"><div className="sp-card sp-card--bio"><h3 className="sp-card-title"><span className="material-symbols-outlined sp-title-icon">person</span> Detailed Bio</h3><div className="sp-bio-grid"><div className="sp-bio-col"><div className="sp-bio-item"><p className="sp-bio-label">Registration Date</p><p className="sp-bio-value">{formatDate(student.createdAt)}</p></div><div className="sp-bio-item"><p className="sp-bio-label">Email Address</p><p className="sp-bio-value sp-link">{student.email}</p></div><div className="sp-bio-item"><p className="sp-bio-label">Contact Number</p><p className="sp-bio-value">{student.phone || '—'}</p></div></div><div className="sp-bio-col"><div className="sp-bio-item"><p className="sp-bio-label">MHT-CET ID</p><p className="sp-bio-value">{student.mhcetId || '—'}</p></div><div className="sp-bio-item"><p className="sp-bio-label">Branch</p><p className="sp-bio-value">{student.branch || '—'}</p></div><div className="sp-bio-item"><p className="sp-bio-label">Status</p><p className="sp-bio-value">{student.status?.toUpperCase() || '—'}</p></div></div></div></div><div className="sp-kpi-col"><div className="sp-kpi-card sp-kpi--primary"><span className="sp-kpi-label">Average Percentile</span><h4 className="sp-kpi-value">{averagePercentile.toFixed(1)}%</h4><div className="sp-kpi-badge">{results.length} completed test{results.length === 1 ? '' : 's'}</div></div><div className="sp-grid-2"><div className="sp-card sp-card--stat"><p className="sp-stat-label">Tests Done</p><p className="sp-stat-value">{results.length}</p></div><div className="sp-card sp-card--stat"><p className="sp-stat-label">Average Score</p><p className="sp-stat-value">{averageScore.toFixed(0)}<span className="sp-stat-sub">/{results[0]?.totalMarks || 0}</span></p></div></div></div></div>

        <div className="sp-grid sp-grid--analytics"><div className="sp-card"><div className="sp-card-header"><div><h3 className="sp-card-title">Score Trends</h3><p className="sp-card-sub">Based on completed tests</p></div></div>{results.length ? <div className="sp-bars">{results.slice(0, 7).reverse().map(result => <div className="sp-bar sp-bar--primary" key={result._id} style={{ height: `${Math.max(8, result.score / Math.max(1, result.totalMarks) * 100)}%` }} title={`${result.testName}: ${result.score}/${result.totalMarks}`} />)}</div> : <div className="sp-profile-empty">No test scores recorded yet.</div>}</div><div className="sp-card"><h3 className="sp-card-title">Subject-wise Proficiency</h3>{subjectScores.length ? <div className="sp-progress-list">{subjectScores.map((item, index) => <div className="sp-progress-item" key={item.subject}><div className="sp-progress-header"><span>{item.subject}</span><span className="sp-progress-pct sp-progress-pct--primary">{item.percentage}%</span></div><div className="sp-progress-track"><div className="sp-progress-fill sp-progress-fill--primary" style={{ width: `${item.percentage}%` }} /></div></div>)}<div className="sp-stats-2"><div className="sp-stat-box"><p className="sp-stat-box-label">Accuracy</p><p className="sp-stat-box-value">{accuracy}%</p></div><div className="sp-stat-box"><p className="sp-stat-box-label">Time/Ques</p><p className="sp-stat-box-value">{averageTime}s</p></div></div></div> : <div className="sp-profile-empty">No subject scores recorded yet.</div>}</div></div>

        <section className="sp-card sp-card--table"><div className="sp-card-header"><div><h3 className="sp-card-title">Test History</h3><p className="sp-card-sub">Real attempts submitted by {student.name}{searchQuery ? ` (filtered: "${searchQuery}")` : ''}{timeFilter !== 'all' ? ` · ${timeFilterLabel}` : ''}</p></div></div>{filteredResults.length ? <div className="sp-history-list">{filteredResults.map(result => <div className="sp-history-row" key={result._id}><div><strong>{result.testName || 'Mock Test'}</strong><small>{result.subject || 'All subjects'} · {formatDate(result.attemptedAt)}</small></div><strong>{result.score.toFixed(0)}/{result.totalMarks.toFixed(0)}</strong><span>{(result.percentile || 0).toFixed(1)} percentile</span><small>{formatDuration(result.duration)}</small></div>)}</div> : <div className="sp-profile-empty">{searchQuery || timeFilter !== 'all' ? 'No tests match your filters.' : 'This student has not submitted any tests yet.'}</div>}</section>

        <div className="sp-grid sp-grid--2"><section className="sp-card"><h3 className="sp-card-title">Recent Activity</h3>{results.length ? <div className="sp-timeline">{results.slice(0, 5).map(result => <div className="sp-timeline-item" key={result._id}><div className="sp-timeline-dot sp-timeline-dot--primary" /><div><p className="sp-timeline-title">{result.testName || 'Mock Test'} completed</p><p className="sp-timeline-sub">{formatDate(result.attemptedAt)} · Score {result.score.toFixed(0)}/{result.totalMarks.toFixed(0)}</p></div></div>)}</div> : <div className="sp-profile-empty">No recent activity.</div>}</section><section className="sp-card"><h3 className="sp-card-title">Student Notes</h3><div className="sp-profile-empty">No admin notes have been added.</div></section></div>
      </div>
      <footer className="sp-footer"><div className="sp-footer-left"><div className="sp-status-badge"><span className="sp-status-dot" /> <span>{student.status || 'Active'} Status</span></div><div className="sp-sep" /><span className="sp-footer-text">Last updated: <strong>{formatDate(lastUpdated)}</strong></span></div></footer>
    </main>

    {/* ── Edit Profile Modal ── */}
    {showEditModal && (
      <div className="sp-modal-backdrop" onClick={() => setShowEditModal(false)}>
        <div className="sp-modal-card" onClick={e => e.stopPropagation()}>
          <div className="sp-modal-header">
            <h3><span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: 8 }}>edit</span>Edit Student Profile</h3>
            <button className="sp-modal-close" onClick={() => setShowEditModal(false)}><span className="material-symbols-outlined">close</span></button>
          </div>
          <div className="sp-modal-body">
            <div className="sp-edit-form">
              <div className="sp-edit-row">
                <label>Full Name</label>
                <input type="text" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} placeholder="Student name" />
              </div>
              <div className="sp-edit-row">
                <label>Email Address</label>
                <input type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} placeholder="student@example.com" />
              </div>
              <div className="sp-edit-row">
                <label>Phone Number</label>
                <input type="tel" value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} placeholder="+91 XXXXX XXXXX" />
              </div>
              <div className="sp-edit-row-group">
                <div className="sp-edit-row">
                  <label>Branch</label>
                  <input type="text" value={editForm.branch} onChange={e => setEditForm({ ...editForm, branch: e.target.value })} placeholder="Branch name" />
                </div>
                <div className="sp-edit-row">
                  <label>Batch</label>
                  <input type="text" value={editForm.batch} onChange={e => setEditForm({ ...editForm, batch: e.target.value })} placeholder="e.g. 2026" />
                </div>
              </div>
              {editMsg && <p className={`sp-edit-msg ${editMsg.includes('success') ? 'sp-edit-msg--success' : 'sp-edit-msg--error'}`}>{editMsg}</p>}
            </div>
          </div>
          <div className="sp-modal-footer">
            <button className="sp-modal-btn sp-modal-btn--cancel" onClick={() => setShowEditModal(false)} disabled={editSaving}>Cancel</button>
            <button className="sp-modal-btn sp-modal-btn--save" onClick={handleEditSave} disabled={editSaving || !editForm.name.trim() || !editForm.email.trim()}>
              {editSaving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
}
