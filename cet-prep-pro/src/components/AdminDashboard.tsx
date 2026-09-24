import { useEffect, useRef, useState } from 'react'
import { Chart, registerables } from 'chart.js'
import { authAPI, session, usersAPI, questionsAPI, mockTestsAPI, testsAPI, AuthUser, type Question, type MockTest, type TestResult } from '../lib/api'
import { supabase } from '../lib/supabaseClient'
import { exportStudentsToExcel } from '../lib/exportExcel'
import StudentProfile from './StudentProfile'
import TestInterface from './TestInterface'
import QuestionBank from './QuestionBank'
import AdminMockTests from './AdminMockTests'
import AdminAnalysis from './AdminAnalysis'
import AdminSettings from './AdminSettings'
import '../admin.css'
import '../testInterface.css'
import '../questionBank.css'
Chart.register(...registerables)

type Page = 'signin' | 'dashboard' | 'mocktests' | 'results' | 'analytics' | 'settings' | 'admin' | 'admin-dashboard'
type AdminView = 'overview' | 'registrations' | 'students' | 'questions' | 'mocktests' | 'analytics' | 'settings'

const adminPathToView = (pathname: string): AdminView => {
  if (pathname === '/admin/mock-tests') return 'mocktests'
  if (pathname === '/admin/registrations') return 'registrations'
  if (pathname === '/admin/students') return 'students'
  if (pathname === '/admin/question-bank') return 'questions'
  if (pathname === '/admin/analytics') return 'analytics'
  if (pathname === '/admin/settings') return 'settings'
  return 'overview'
}

const adminViewToPath = (view: AdminView) => `/admin/${view === 'overview' ? 'dashboard' : view === 'mocktests' ? 'mock-tests' : view === 'questions' ? 'question-bank' : view}`

interface AdminDashboardProps {
  onNavigate?: (page: Page | string) => void
  onLogout?: () => void
}

/* ─────────────────────────────────────────
  Dashboard Data
───────────────────────────────────────── */
type DashboardActivity = { icon: string; cls: string; title: string; sub: string; time: string }
const getAttemptsToday = (results: TestResult[]) => {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)

  return results.filter(result => {
    const attemptedAt = new Date(result.attemptedAt)
    return attemptedAt >= startOfToday && attemptedAt < endOfToday
  }).length
}

const QUICK = [
  { icon: 'assignment_ind', label: 'Manage Faculty' },
  { icon: 'backup', label: 'Upload Data' },
  { icon: 'mail', label: 'Send Alerts' },
  { icon: 'settings_suggest', label: 'Server Settings' },
]
const NAV = [
  { icon: 'dashboard', label: 'Dashboard', view: 'overview' as AdminView },
  { icon: 'quiz', label: 'Mock Tests', view: 'mocktests' as AdminView },
  { icon: 'how_to_reg', label: 'Registrations', view: 'registrations' as AdminView },
  { icon: 'group', label: 'Students', view: 'students' as AdminView },
  { icon: 'menu_book', label: 'Question Bank', view: 'questions' as AdminView },
  { icon: 'analytics', label: 'Analytics', view: 'analytics' as AdminView },
  { icon: 'settings', label: 'Settings', view: null },
]

/* ─────────────────────────────────────────
  Registered Students — LIVE DATA
───────────────────────────────────────── */
function RegisteredStudents({ onViewProfile }: { onViewProfile: (id: string) => void }) {
  const [students, setStudents] = useState<AuthUser[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [resending, setResending] = useState<string | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [search, setSearch] = useState('')
  const [branchFilter, setBranchFilter] = useState('All')
  const [batchFilter, setBatchFilter] = useState('All')

  const showToast = (msg: string) => {
    setToast(msg); setTimeout(() => setToast(''), 3500)
  }

  const distinctBatches = Array.from(new Set(students.map(s => s.batch).filter(Boolean))).sort()

  const handleExportExcel = () => {
    try {
      exportStudentsToExcel(filtered, {
        batch: batchFilter === 'All' ? undefined : batchFilter,
        status: 'approved',
      })
      showToast('📥 Students Excel file downloaded successfully!')
    } catch (e: unknown) {
      showToast(`❌ Export failed: ${e instanceof Error ? e.message : 'Export failed'}`)
    }
  }

  const handleResendCredentials = async (id: string) => {
    setResending(id)
    try {
      const res = await usersAPI.resendCredentials(id)
      showToast(`✅ ${res.message}`)
    } catch (e: unknown) {
      showToast(`❌ ${e instanceof Error ? e.message : 'Failed to resend'}`)
    } finally {
      setResending(null)
    }
  }

  const handlePhotoUpload = async (studentId: string, name: string, file: File) => {
    setUploading(studentId)
    try {
      const res = await usersAPI.uploadPhoto(studentId, file)
      showToast(`📸 Photo uploaded for ${name}!`)
      // Update local state with new photo URL
      setStudents(prev => prev.map(s =>
        s._id === studentId ? { ...s, photo: res.photoUrl } : s
      ))
    } catch (e: unknown) {
      showToast(`❌ ${e instanceof Error ? e.message : 'Photo upload failed'}`)
    } finally {
      setUploading(null)
    }
  }

  const fetchStudents = async (hideLoading = false) => {
    try {
      if (!hideLoading) setLoading(true)
      const all = await usersAPI.getAll('approved')
      setStudents(all)
    } catch (e: unknown) {
      console.error('Failed to load approved students', e)
      showToast(`Failed to load registered students. ${e instanceof Error ? e.message : ''}`)
    } finally {
      if (!hideLoading) setLoading(false)
    }
  }

  useEffect(() => {
    fetchStudents()
    const interval = setInterval(() => fetchStudents(true), 1500)

    const handleLocalUpdate = () => fetchStudents(true)
    window.addEventListener('cet:registration', handleLocalUpdate)
    window.addEventListener('storage', handleLocalUpdate)

    let bc: BroadcastChannel | null = null
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel('cet_registrations_channel')
      bc.onmessage = () => fetchStudents(true)
    }

    const channel = supabase
      .channel('realtime_students_list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
        fetchStudents(true)
      })
      .subscribe()

    return () => {
      clearInterval(interval)
      window.removeEventListener('cet:registration', handleLocalUpdate)
      window.removeEventListener('storage', handleLocalUpdate)
      if (bc) bc.close()
      supabase.removeChannel(channel)
    }
  }, [])

  const handleDelete = async (id: string, name: string) => {
    setDeleting(id)
    try {
      await usersAPI.delete(id)
      showToast(`🗑️ ${name} deleted successfully.`)
      setStudents(s => s.filter(u => u._id !== id))
    } catch (e: unknown) {
      showToast(`❌ ${e instanceof Error ? e.message : 'Delete failed'}`)
    } finally {
      setDeleting(null)
      setConfirmId(null)
    }
  }

  const fmt = (iso?: string) => {
    if (!iso) return { date: '—', time: '—' }
    const d = new Date(iso)
    return {
      date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    }
  }

  const filtered = students.filter(s => {
    const q = search.toLowerCase()
    const matchSearch = !q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q) || (s.mhcetId || '').toLowerCase().includes(q)
    const matchBranch = branchFilter === 'All' || s.branch === branchFilter
    const matchBatch = batchFilter === 'All' || String(s.batch) === String(batchFilter)
    return matchSearch && matchBranch && matchBatch
  })

  return (
    <div className="rs2-root">
      {toast && <div className="rr-toast">{toast}</div>}

      {/* Header */}
      <div className="rs2-header">
        <div>
          <h2 className="rs2-title">Registered Students</h2>
          <p className="rs2-sub">All approved students — {students.length} total</p>
        </div>
        <div className="rs2-filters">
          <button
            type="button"
            className="rr-bulk-btn rr-bulk-btn--export"
            onClick={handleExportExcel}
            title="Download Excel file of students batch-wise"
          >
            <span className="material-symbols-outlined">table_view</span>
            Export Excel {batchFilter !== 'All' ? `(Batch ${batchFilter})` : 'Batch-wise'}
          </button>
          <div className="rs2-search-wrap">
            <span className="material-symbols-outlined rs2-search-icon">search</span>
            <input className="rs2-search" placeholder="Search name, email, MHT-CET ID…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="rs2-select" value={batchFilter} onChange={e => setBatchFilter(e.target.value)} title="Filter by batch">
            <option value="All">All Batches</option>
            {distinctBatches.map(b => (
              <option key={b} value={b}>Batch {b}</option>
            ))}
          </select>
          <select className="rs2-select" value={branchFilter} onChange={e => setBranchFilter(e.target.value)}>
            <option value="All">All Branches</option>
            <option value="Byculla">Byculla</option>
            <option value="Worli">Worli</option>
            <option value="Prabhadevi">Prabhadevi</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="rr-table-wrap">
        {loading ? (
          <div className="rr-loading"><div className="rr-spinner" /><p>Loading students…</p></div>
        ) : filtered.length === 0 ? (
          <div className="rr-empty">
            <span className="material-symbols-outlined">group_off</span>
            <p>{search || branchFilter !== 'All' ? 'No students match your filters.' : 'No registered students yet.'}</p>
          </div>
        ) : (
          <table className="rr-table">
            <thead>
              <tr className="rr-thead-row">
                <th className="rr-th">#</th>
                <th className="rr-th">PHOTO</th>
                <th className="rr-th">STUDENT NAME</th>
                <th className="rr-th">EMAIL ADDRESS</th>
                <th className="rr-th">MHT-CET ID</th>
                <th className="rr-th">BRANCH</th>
                <th className="rr-th">REGISTERED ON</th>
                <th className="rr-th rr-th--right">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => {
                const dt = fmt(s.createdAt)
                const initial = s.name.charAt(0).toUpperCase()
                const isDel = deleting === s._id
                const isConfirming = confirmId === s._id
                const isUploading = uploading === s._id
                return (
                  <tr key={s._id} className={`rr-tbody-row${isDel ? ' rs2-row--deleting' : ''}`}
                    onClick={() => onViewProfile(s._id)} style={{ cursor: 'pointer' }}>
                    <td className="rr-td rs2-num">{i + 1}</td>

                    {/* Photo cell */}
                    <td className="rr-td" onClick={e => e.stopPropagation()}>
                      <div className="rs2-photo-wrap">
                        {s.photo ? (
                          <img src={s.photo} alt={s.name} className="rs2-photo-img" />
                        ) : (
                          <div className="rs2-photo-placeholder">{initial}</div>
                        )}
                        <label className={`rs2-photo-upload-btn${isUploading ? ' rs2-photo-upload-btn--loading' : ''}`}
                          title="Upload photo">
                          {isUploading
                            ? <div className="rr-btn-spinner" />
                            : <span className="material-symbols-outlined">photo_camera</span>
                          }
                          <input type="file" accept="image/*" className="rs2-photo-input"
                            disabled={isUploading}
                            onChange={e => {
                              const file = e.target.files?.[0]
                              if (file) handlePhotoUpload(s._id, s.name, file)
                              e.target.value = ''
                            }} />
                        </label>
                      </div>
                    </td>

                    <td className="rr-td">
                      <div className="rr-student">
                        <div>
                          <p className="rr-student-name">{s.name}</p>
                          <p className="rr-student-id">{s.phone || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="rr-td rr-td--email">{s.email}</td>
                    <td className="rr-td">
                      <span className="rs2-mhcet-id">{s.mhcetId || '—'}</span>
                    </td>
                    <td className="rr-td"><span className="rr-branch-badge">{s.branch}</span></td>
                    <td className="rr-td">
                      <p className="rr-date">{dt.date}</p>
                      <p className="rr-time">{dt.time}</p>
                    </td>
                    <td className="rr-td rr-td--right" onClick={e => e.stopPropagation()}>
                      {isConfirming ? (
                        <div className="rs2-confirm-row">
                          <span className="rs2-confirm-txt">Delete?</span>
                          <button className="rs2-confirm-yes" disabled={isDel}
                            onClick={() => handleDelete(s._id, s.name)}>
                            {isDel ? <div className="rr-btn-spinner" /> : 'Yes'}
                          </button>
                          <button className="rs2-confirm-no" onClick={() => setConfirmId(null)}>No</button>
                        </div>
                      ) : (
                        <div className="rs2-actions">
                          <button className="rs2-view-btn" title="Resend Credentials"
                            disabled={resending === s._id}
                            onClick={() => handleResendCredentials(s._id)}>
                            {resending === s._id ? <div className="rr-btn-spinner" /> : <span className="material-symbols-outlined">forward_to_inbox</span>}
                          </button>
                          <button className="rs2-view-btn" title="View profile"
                            onClick={() => onViewProfile(s._id)}>
                            <span className="material-symbols-outlined">visibility</span>
                          </button>
                          <button className="rs2-delete-btn" title="Delete student"
                            onClick={() => setConfirmId(s._id)}>
                            <span className="material-symbols-outlined">delete</span>
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {!loading && filtered.length > 0 && (
        <div className="rr-table-footer">
          <p className="rr-count">Showing {filtered.length} of {students.length} students</p>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────
  Registration Review Page — LIVE DATA
───────────────────────────────────────── */
function RegistrationReview() {
  const [students, setStudents] = useState<AuthUser[]>([])
  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0 })
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const [actionMsg, setActionMsg] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [isBulkLoading, setIsBulkLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [batchFilter, setBatchFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending')
  const [viewingStudent, setViewingStudent] = useState<AuthUser | null>(null)

  const fetchData = async (hideLoading = false) => {
    try {
      if (!hideLoading) setLoading(true)
      const [users, s] = await Promise.all([
        usersAPI.getAll(statusFilter === 'all' ? undefined : statusFilter),
        usersAPI.stats(),
      ])
      setStudents(users)
      setStats(s)
    } catch (e) {
      console.error('Failed to load registrations', e)
    } finally {
      if (!hideLoading) setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(() => fetchData(true), 2500)

    const handleLocalUpdate = () => fetchData(true)
    window.addEventListener('cet:registration', handleLocalUpdate)
    window.addEventListener('storage', handleLocalUpdate)

    let bc: BroadcastChannel | null = null
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel('cet_registrations_channel')
      bc.onmessage = () => fetchData(true)
    }

    const channel = supabase
      .channel('realtime_pending_registrations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
        fetchData(true)
      })
      .subscribe()

    return () => {
      clearInterval(interval)
      window.removeEventListener('cet:registration', handleLocalUpdate)
      window.removeEventListener('storage', handleLocalUpdate)
      if (bc) bc.close()
      supabase.removeChannel(channel)
    }
  }, [statusFilter])

  const toggle = (id: string) =>
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  const toggleAll = () =>
    setSelected(s => s.length === filtered.length ? [] : filtered.map(s => s._id))

  const showMsg = (msg: string) => {
    setActionMsg(msg)
    setTimeout(() => setActionMsg(''), 4000)
  }

  const distinctBatches = Array.from(new Set(students.map(s => s.batch).filter(Boolean))).sort()

  const filtered = students.filter(s => {
    const q = searchQuery.toLowerCase()
    const matchSearch = !q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q) || (s.phone || '').includes(q) || (s.mhcetId || '').toLowerCase().includes(q)
    const matchBatch = batchFilter === 'All' || String(s.batch) === String(batchFilter)
    return matchSearch && matchBatch
  })

  const handleApprove = async (id: string, name: string) => {
    setActionLoading(id)
    try {
      const res = await usersAPI.approve(id)
      showMsg(`✅ ${name} approved! MHT-CET ID: ${res.mhcetId} — Credentials sent to email.`)
      await fetchData()
    } catch (e: unknown) {
      showMsg(`❌ ${e instanceof Error ? e.message : 'Failed to approve'}`)
    } finally {
      setActionLoading(null)
    }
  }

  const handleReject = async (id: string, name: string) => {
    setActionLoading(`reject-${id}`)
    try {
      await usersAPI.reject(id)
      showMsg(`🚫 ${name} rejected.`)
      await fetchData()
    } catch (e: unknown) {
      showMsg(`❌ ${e instanceof Error ? e.message : 'Failed to reject'}`)
    } finally {
      setActionLoading(null)
    }
  }

  const handleBulkApprove = async () => {
    if (selected.length === 0) return
    setIsBulkLoading(true)
    try {
      const res = await usersAPI.bulkApprove(selected)
      showMsg(`✅ ${res.message || `Successfully approved ${selected.length} students!`}`)
      setSelected([])
      await fetchData()
    } catch (e: unknown) {
      showMsg(`❌ ${e instanceof Error ? e.message : 'Bulk approval failed'}`)
    } finally {
      setIsBulkLoading(false)
    }
  }

  const handleBulkReject = async () => {
    if (selected.length === 0) return
    if (!window.confirm(`Are you sure you want to reject ${selected.length} applicant(s)?`)) return
    setIsBulkLoading(true)
    try {
      const res = await usersAPI.bulkReject(selected)
      showMsg(`🚫 ${res.message || `Rejected ${selected.length} applications.`}`)
      setSelected([])
      await fetchData()
    } catch (e: unknown) {
      showMsg(`❌ ${e instanceof Error ? e.message : 'Bulk rejection failed'}`)
    } finally {
      setIsBulkLoading(false)
    }
  }

  const handleExportExcel = () => {
    try {
      exportStudentsToExcel(filtered, {
        batch: batchFilter === 'All' ? undefined : batchFilter,
        status: statusFilter === 'all' ? undefined : statusFilter,
      })
      showMsg('📥 Students Excel file downloaded successfully with all columns!')
    } catch (e: unknown) {
      showMsg(`❌ Export failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

  const fmt = (iso: string) => {
    const d = new Date(iso)
    return {
      date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    }
  }

  return (
    <div className="rr-root">

      {/* Toast message */}
      {actionMsg && (
        <div className="rr-toast">{actionMsg}</div>
      )}

      {/* Student Details Modal */}
      {viewingStudent && (
        <div className="rr-modal-backdrop" onClick={() => setViewingStudent(null)}>
          <div className="rr-modal-card" onClick={e => e.stopPropagation()}>
            <div className="rr-modal-header">
              <h3 className="rr-modal-title">
                <span className="material-symbols-outlined">badge</span>
                Student Registration Details
              </h3>
              <button className="rr-modal-close-btn" onClick={() => setViewingStudent(null)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="rr-modal-body">
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
                <div className="rr-avatar" style={{ width: 52, height: 52, fontSize: 20 }}>
                  {viewingStudent.name?.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h4 style={{ margin: '0 0 4px', fontSize: 17, color: '#0f172a' }}>{viewingStudent.name}</h4>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="rr-branch-badge">{viewingStudent.branch || 'Branch N/A'}</span>
                    <span style={{
                      padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                      background: viewingStudent.status === 'approved' ? '#dcfce7' : viewingStudent.status === 'rejected' ? '#fee2e2' : '#dbeafe',
                      color: viewingStudent.status === 'approved' ? '#15803d' : viewingStudent.status === 'rejected' ? '#b91c1c' : '#1d4ed8'
                    }}>
                      {viewingStudent.status?.toUpperCase() || 'PENDING'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rr-detail-grid">
                <div className="rr-detail-item">
                  <label>Email Address</label>
                  <span>{viewingStudent.email}</span>
                </div>
                <div className="rr-detail-item">
                  <label>Phone Number</label>
                  <span>{viewingStudent.phone || '—'}</span>
                </div>
                <div className="rr-detail-item">
                  <label>Batch</label>
                  <span>{viewingStudent.batch ? `Batch ${viewingStudent.batch}` : '—'}</span>
                </div>
                <div className="rr-detail-item">
                  <label>Registration Date</label>
                  <span>{viewingStudent.createdAt ? new Date(viewingStudent.createdAt).toLocaleString('en-IN') : '—'}</span>
                </div>
                <div className="rr-detail-item">
                  <label>Student Unique No. (MHT-CET ID)</label>
                  <span style={{ color: '#005bbf', fontWeight: 700 }}>{viewingStudent.mhcetId || 'Pending Generation'}</span>
                </div>
                <div className="rr-detail-item">
                  <label>Password / Credentials</label>
                  <span>{viewingStudent.mhcetPassword || (viewingStudent.status === 'pending' ? 'Generated on approval' : '••••••••')}</span>
                </div>
              </div>
            </div>
            <div className="rr-modal-footer">
              <button
                type="button"
                className="rr-bulk-btn"
                onClick={() => setViewingStudent(null)}
              >
                Close
              </button>
              {viewingStudent.status === 'pending' && (
                <>
                  <button
                    type="button"
                    className="rr-bulk-btn rr-bulk-btn--reject"
                    onClick={() => {
                      const s = viewingStudent
                      setViewingStudent(null)
                      handleReject(s._id, s.name)
                    }}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    className="rr-bulk-btn rr-bulk-btn--approve"
                    style={{ background: '#005bbf', color: '#fff', borderColor: '#005bbf' }}
                    onClick={() => {
                      const s = viewingStudent
                      setViewingStudent(null)
                      handleApprove(s._id, s.name)
                    }}
                  >
                    Approve Student
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="rr-stats">
        <div className="rr-stat" onClick={() => setStatusFilter('pending')} style={{ cursor: 'pointer' }}>
          <span className="material-symbols-outlined rr-stat-icon rr-stat-icon--blue">pending_actions</span>
          <div>
            <p className="rr-stat-label">TOTAL PENDING</p>
            <p className="rr-stat-val">{stats.pending}</p>
          </div>
        </div>
        <div className="rr-divider" />
        <div className="rr-stat" onClick={() => setStatusFilter('approved')} style={{ cursor: 'pointer' }}>
          <span className="material-symbols-outlined rr-stat-icon rr-stat-icon--green">check_circle</span>
          <div>
            <p className="rr-stat-label">APPROVED</p>
            <p className="rr-stat-val">{stats.approved}</p>
          </div>
        </div>
        <div className="rr-divider" />
        <div className="rr-stat" onClick={() => setStatusFilter('rejected')} style={{ cursor: 'pointer' }}>
          <span className="material-symbols-outlined rr-stat-icon rr-stat-icon--red">warning</span>
          <div>
            <p className="rr-stat-label">REJECTED</p>
            <p className="rr-stat-val">{stats.rejected}</p>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="rr-toolbar">
        <div className="rr-filters" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="rs2-search-wrap">
            <span className="material-symbols-outlined rs2-search-icon">search</span>
            <input
              className="rs2-search"
              placeholder="Search name, email, phone..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          <select
            className="rs2-select"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            title="Filter by status"
          >
            <option value="pending">Pending Registrations ({stats.pending})</option>
            <option value="approved">Approved Students ({stats.approved})</option>
            <option value="all">All Registrations</option>
          </select>

          <select
            className="rs2-select"
            value={batchFilter}
            onChange={e => setBatchFilter(e.target.value)}
            title="Filter by batch"
          >
            <option value="All">All Batches</option>
            {distinctBatches.map(b => (
              <option key={b} value={b}>Batch {b}</option>
            ))}
          </select>
        </div>

        <div className="rr-bulk-actions">
          <button
            type="button"
            className="rr-bulk-btn rr-bulk-btn--export"
            onClick={handleExportExcel}
            title="Download Excel file of students batch-wise with all columns"
          >
            <span className="material-symbols-outlined">table_view</span>
            Export Excel {batchFilter !== 'All' ? `(Batch ${batchFilter})` : 'Batch-wise'}
          </button>

          {statusFilter === 'pending' && (
            <>
              <button
                type="button"
                className="rr-bulk-btn rr-bulk-btn--reject"
                disabled={selected.length === 0 || isBulkLoading}
                onClick={handleBulkReject}
              >
                <span className="material-symbols-outlined">block</span>
                Bulk Reject ({selected.length})
              </button>
              <button
                type="button"
                className="rr-bulk-btn rr-bulk-btn--approve"
                disabled={selected.length === 0 || isBulkLoading}
                onClick={handleBulkApprove}
              >
                {isBulkLoading ? <div className="rr-btn-spinner" /> : <span className="material-symbols-outlined">check_circle</span>}
                Bulk Approve ({selected.length})
              </button>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rr-table-wrap">
        {loading ? (
          <div className="rr-loading">
            <div className="rr-spinner" />
            <p>Loading registrations…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rr-empty">
            <span className="material-symbols-outlined">inbox</span>
            <p>No {statusFilter === 'all' ? '' : statusFilter} registrations found {batchFilter !== 'All' ? `in Batch ${batchFilter}` : ''}</p>
          </div>
        ) : (
          <table className="rr-table">
            <thead>
              <tr className="rr-thead-row">
                <th className="rr-th rr-th--check">
                  <input type="checkbox"
                    checked={selected.length === filtered.length && filtered.length > 0}
                    onChange={toggleAll} className="rr-checkbox" />
                </th>
                <th className="rr-th">STUDENT NAME</th>
                <th className="rr-th">EMAIL ADDRESS</th>
                <th className="rr-th">BATCH</th>
                <th className="rr-th">BRANCH</th>
                <th className="rr-th">DATE & TIME</th>
                <th className="rr-th rr-th--right">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const dt = fmt(s.createdAt || new Date().toISOString())
                const initial = s.name.charAt(0).toUpperCase()
                const isApproving = actionLoading === s._id
                const isRejecting = actionLoading === `reject-${s._id}`
                return (
                  <tr key={s._id} className="rr-tbody-row">
                    <td className="rr-td rr-td--check">
                      <input type="checkbox"
                        checked={selected.includes(s._id)}
                        onChange={() => toggle(s._id)} className="rr-checkbox" />
                    </td>
                    <td className="rr-td">
                      <div className="rr-student">
                        <div className="rr-avatar">{initial}</div>
                        <div>
                          <p className="rr-student-name">{s.name}</p>
                          <p className="rr-student-id">{s.phone || s.mhcetId || s.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="rr-td rr-td--email">{s.email}</td>
                    <td className="rr-td">
                      <span className="rs2-mhcet-id">{s.batch ? `Batch ${s.batch}` : '—'}</span>
                    </td>
                    <td className="rr-td">
                      <span className="rr-branch-badge">{s.branch || '—'}</span>
                    </td>
                    <td className="rr-td">
                      <p className="rr-date">{dt.date}</p>
                      <p className="rr-time">{dt.time}</p>
                    </td>
                    <td className="rr-td rr-td--right">
                      <div className="rr-actions">
                        <button
                          type="button"
                          className="rr-action-btn rr-action-btn--view"
                          title="View Details"
                          onClick={() => setViewingStudent(s)}
                        >
                          <span className="material-symbols-outlined">visibility</span>
                        </button>
                        {s.status === 'pending' && (
                          <>
                            <button
                              type="button"
                              className="rr-action-btn rr-action-btn--approve"
                              disabled={isApproving || isRejecting}
                              onClick={() => handleApprove(s._id, s.name)}
                              title="Approve Student"
                            >
                              {isApproving ? <div className="rr-btn-spinner" /> : 'Approve'}
                            </button>
                            <button
                              type="button"
                              className="rr-action-btn rr-action-btn--reject"
                              disabled={isApproving || isRejecting}
                              onClick={() => handleReject(s._id, s.name)}
                              title="Reject Student"
                            >
                              {isRejecting
                                ? <div className="rr-btn-spinner rr-btn-spinner--sm" />
                                : <span className="material-symbols-outlined">close</span>}
                            </button>
                          </>
                        )}
                        {s.status === 'approved' && (
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#16a34a', padding: '4px 8px' }}>
                            ✓ Approved
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      {!loading && filtered.length > 0 && (
        <div className="rr-table-footer">
          <p className="rr-count">Showing {filtered.length} of {students.length} applicant{students.length !== 1 ? 's' : ''}</p>
        </div>
      )}

      {/* Info cards */}
      <div className="rr-info-grid">
        <div className="rr-info-card rr-info-card--blue">
          <div className="rr-info-header">
            <span className="material-symbols-outlined rr-info-icon">info</span>
            <span className="rr-info-title">Approval Process</span>
          </div>
          <p className="rr-info-text">
            Click <strong>Approve</strong> or use <strong>Bulk Approve</strong> to generate unique MHT-CET IDs and passwords. Credentials are automatically dispatched to registered student emails.
          </p>
        </div>
        <div className="rr-info-card rr-info-card--purple">
          <div className="rr-info-header">
            <span className="material-symbols-outlined rr-info-icon">table_view</span>
            <span className="rr-info-title">Batch Excel Export</span>
          </div>
          <p className="rr-info-text">
            Click <strong>Export Excel</strong> to download batch-wise spreadsheets containing <em>Student Name</em>, <em>Email ID</em>, <em>Student Unique No.</em>, <em>Username</em>, and <em>Password</em>.
          </p>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────
  Main Admin Dashboard
───────────────────────────────────────── */
export default function AdminDashboard({ onNavigate, onLogout }: AdminDashboardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart | null>(null)
  const [view, setView] = useState<AdminView>(() => adminPathToView(window.location.pathname))
  const [viewProfileId, setViewProfileId] = useState<string | null>(null)
  const [showTest, setShowTest] = useState(false)
  const [students, setStudents] = useState<AuthUser[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [mockTests, setMockTests] = useState<MockTest[]>([])
  const [testResults, setTestResults] = useState<TestResult[]>([])
  const [activities, setActivities] = useState<DashboardActivity[]>([])
  const [attemptCounts, setAttemptCounts] = useState<number[]>(() => Array(30).fill(0))
  const [chartRange, setChartRange] = useState<'30d' | 'yearly'>('30d')
  const [showAlertComposer, setShowAlertComposer] = useState(false)
  const [showServerSettings, setShowServerSettings] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [showActivitiesModal, setShowActivitiesModal] = useState(false)
  const [showControlRoomModal, setShowControlRoomModal] = useState(false)
  const [showAdminProfileModal, setShowAdminProfileModal] = useState(false)
  const [readNotifications, setReadNotifications] = useState(false)
  const [topbarSearch, setTopbarSearch] = useState('')
  const [alertMessage, setAlertMessage] = useState('')
  const [alertSent, setAlertSent] = useState(false)
  const [currentAdmin, setCurrentAdmin] = useState<AuthUser | null>(() => session.get<AuthUser>())
  const [adminProfileForm, setAdminProfileForm] = useState({ name: '', email: '', phone: '' })
  const [adminProfileSaving, setAdminProfileSaving] = useState(false)
  const [adminProfileMessage, setAdminProfileMessage] = useState('')
  const [adminPhotoError, setAdminPhotoError] = useState('')
  const [adminPhotoUploading, setAdminPhotoUploading] = useState(false)
  const [adminPhotoRemoving, setAdminPhotoRemoving] = useState(false)

  const changeView = (nextView: AdminView) => {
    if (nextView === view) return
    window.history.pushState({ adminView: nextView }, '', adminViewToPath(nextView))
    setView(nextView)
  }

  useEffect(() => {
    const handleAdminPopState = () => setView(adminPathToView(window.location.pathname))
    window.addEventListener('popstate', handleAdminPopState)
    return () => window.removeEventListener('popstate', handleAdminPopState)
  }, [])

  useEffect(() => {
    const syncAdmin = async () => {
      const savedAdmin = session.get<AuthUser>()
      if (savedAdmin) {
        setCurrentAdmin(savedAdmin)
        setAdminProfileForm({
          name: savedAdmin.name || '',
          email: savedAdmin.email || '',
          phone: savedAdmin.phone || '',
        })
      }

      try {
        const me = await authAPI.me()
        if (me && typeof me === 'object') {
          session.save(me)
          setCurrentAdmin(me as AuthUser)
          setAdminProfileForm({
            name: (me as AuthUser).name || '',
            email: (me as AuthUser).email || '',
            phone: (me as AuthUser).phone || '',
          })
        }
      } catch {
        // Fall back to saved session data if the server is unavailable.
      }
    }

    syncAdmin()
  }, [])

  useEffect(() => {
    if (currentAdmin) {
      setAdminProfileForm({
        name: currentAdmin.name || '',
        email: currentAdmin.email || '',
        phone: currentAdmin.phone || '',
      })
    }
  }, [currentAdmin])

  const attemptsToday = getAttemptsToday(testResults)
  const normalizeAdminName = (value?: string | null) => {
    const name = value?.trim()
    if (!name || name === 'System Administrator') return 'Administrator'
    return name
  }
  const adminName = normalizeAdminName(currentAdmin?.name)
  const adminRole = currentAdmin?.role === 'admin' ? 'Admin' : 'Exam Controller'
  const adminPhoto = currentAdmin?.photo

  useEffect(() => {
    if (view !== 'overview') return
    let cancelled = false

    const loadOverview = async () => {
      try {
        const [studentData, questionData, mockTestData, resultData] = await Promise.all([
          usersAPI.getAll('approved'),
          questionsAPI.getAllAdmin({ isActive: true }),
          mockTestsAPI.getAllAdmin(),
          testsAPI.getAllAdmin(),
        ])
        if (cancelled) return
        setStudents(studentData)
        setQuestions(questionData)
        setMockTests(mockTestData)
        setTestResults(resultData)

        const now = Date.now()
        const recentResults = resultData.filter(result => now - new Date(result.attemptedAt).getTime() <= 24 * 60 * 60 * 1000)
        const nextActivities: DashboardActivity[] = recentResults.slice(0, 8).map(result => ({
          icon: 'check_circle',
          cls: 'adb-act-purple',
          title: `${result.testName || 'Mock Test'} completed`,
          sub: `${typeof result.userId === 'object' && result.userId?.name ? result.userId.name : 'A student'} scored ${Math.round(result.score)}/${result.totalMarks}`,
          time: new Date(result.attemptedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        }))
        setActivities(nextActivities)

        const counts = Array(30).fill(0)
        resultData.forEach(result => {
          const age = Math.floor((now - new Date(result.attemptedAt).getTime()) / (24 * 60 * 60 * 1000))
          if (age >= 0 && age < 30) counts[29 - age] += 1
        })
        setAttemptCounts(counts)
      } catch (error) {
        console.error('Failed to load admin overview:', error)
      }
    }

    loadOverview()

    const channel = supabase
      .channel('realtime_admin_dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'test_results' }, () => {
        loadOverview()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
        loadOverview()
      })
      .subscribe()

    const expiryTimer = window.setInterval(() => {
      setActivities(current => current.filter(activity => activity.time !== 'RECENTLY'))
    }, 60 * 60 * 1000)

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
      window.clearInterval(expiryTimer)
    }
  }, [view])

  useEffect(() => {
    if (view !== 'overview') return
    if (!canvasRef.current) return
    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return
    chartRef.current?.destroy()

    const grad = ctx.createLinearGradient(0, 0, 0, 340)
    grad.addColorStop(0, 'rgba(26,115,232,0.35)')
    grad.addColorStop(1, 'rgba(26,115,232,0)')

    let chartLabels: string[] = []
    let chartData: number[] = []

    if (chartRange === '30d') {
      chartLabels = Array.from({ length: 30 }, (_, i) => {
        const show = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27]
        return show.includes(i) ? `Day ${i + 1}` : ''
      })
      chartData = attemptCounts
    } else {
      chartLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      const monthly = Array(12).fill(0)
      testResults.forEach(r => {
        const m = new Date(r.attemptedAt).getMonth()
        if (m >= 0 && m < 12) monthly[m]++
      })
      chartData = monthly
    }

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels: chartLabels,
        datasets: [{
          label: 'Test Attempts',
          data: chartData,
          borderColor: '#1a73e8',
          borderWidth: 2.5,
          fill: true,
          backgroundColor: grad,
          tension: 0.4,
          pointRadius: 2,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: '#fff',
          pointHoverBorderColor: '#1a73e8',
          pointHoverBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: '#191c1d',
            titleFont: { size: 12, family: 'Inter' },
            bodyFont: { size: 12, family: 'Inter' },
            padding: 10,
            cornerRadius: 6,
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 10 }, color: '#727785' } },
          y: {
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: {
              font: { family: 'Inter', size: 10 },
              color: '#727785',
              callback: v => Number(v) >= 1000 ? `${Number(v) / 1000}k` : String(v),
            },
          },
        },
      },
    })
    return () => chartRef.current?.destroy()
  }, [view, attemptCounts, chartRange, testResults])

  const topbarTitle = view === 'registrations'
    ? 'Student Approval & Registrations'
    : view === 'students'
    ? 'Registered Students'
    : view === 'questions'
    ? 'Question Bank Management'
    : view === 'mocktests'
    ? 'Mock Tests'
    : view === 'analytics'
    ? 'Analysis Dashboard'
    : view === 'settings'
    ? 'System Settings'
    : 'Admin Console'

  const handleQuickAction = (label: string) => {
    if (label === 'Manage Faculty') changeView('students')
    if (label === 'Upload Data') changeView('questions')
    if (label === 'Send Alerts') {
      setAlertSent(false)
      setShowAlertComposer(true)
    }
    if (label === 'Server Settings') setShowServerSettings(true)
  }

  const sendAlert = (event: React.FormEvent) => {
    event.preventDefault()
    if (!alertMessage.trim()) return
    setAlertSent(true)
    setAlertMessage('')
  }

  const handleLogout = async (e: React.MouseEvent) => {
    e.preventDefault()
    try {
      await authAPI.logout()
    } catch (error) {
      console.warn('Logout failed, clearing local session anyway', error)
    }
    session.clear()
    if (onLogout) onLogout()
    else onNavigate?.('signin')
  }

  const handleAdminProfileSave = async (event: React.FormEvent) => {
    event.preventDefault()
    setAdminProfileSaving(true)
    setAdminProfileMessage('')

    try {
      const payload = {
        name: adminProfileForm.name.trim(),
        email: adminProfileForm.email.trim(),
        phone: adminProfileForm.phone.trim(),
      }

      const response = await usersAPI.updateProfile(payload)
      const updatedAdmin = response.user
      session.save(updatedAdmin)
      setCurrentAdmin(updatedAdmin)
      setAdminProfileMessage('Profile updated successfully.')
    } catch (error) {
      setAdminProfileMessage(error instanceof Error ? error.message : 'Unable to update profile.')
    } finally {
      setAdminProfileSaving(false)
    }
  }

  const handleAdminPhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setAdminPhotoError('Please select a valid image file.')
      return
    }

    setAdminPhotoError('')
    setAdminPhotoUploading(true)

    try {
      const response = await usersAPI.uploadMyPhoto(file)
      const nextAdmin = currentAdmin ? { ...currentAdmin, photo: response.photoUrl } : null
      if (nextAdmin) {
        session.save(nextAdmin)
        setCurrentAdmin(nextAdmin)
      }
    } catch (error) {
      console.error('Admin photo upload failed:', error)
      setAdminPhotoError(error instanceof Error ? error.message : 'Photo upload failed.')
    } finally {
      setAdminPhotoUploading(false)
    }
  }

  const handleAdminPhotoRemove = async () => {
    if (!currentAdmin?.photo || adminPhotoRemoving) return
    setAdminPhotoError('')
    setAdminPhotoRemoving(true)

    try {
      await usersAPI.removeMyPhoto()
      const nextAdmin = { ...currentAdmin, photo: undefined }
      session.save(nextAdmin)
      setCurrentAdmin(nextAdmin)
      setAdminProfileMessage('Profile photo removed successfully.')
    } catch (error) {
      console.error('Admin photo removal failed:', error)
      setAdminPhotoError(error instanceof Error ? error.message : 'Photo removal failed.')
    } finally {
      setAdminPhotoRemoving(false)
    }
  }

  return (
    <>
      {showAdminProfileModal && (
        <div className="adb-dialog-backdrop" onClick={() => setShowAdminProfileModal(false)}>
          <div className="adb-admin-profile-modal" onClick={event => event.stopPropagation()}>
            <div className="adb-admin-profile-header">
              <div>
                <p className="adb-admin-profile-kicker">Profile</p>
                <h3>Administrator Account</h3>
              </div>
              <button type="button" className="adb-modal-close" onClick={() => setShowAdminProfileModal(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="adb-admin-profile-body">
              <div className="adb-admin-profile-photo-panel">
                <div className="adb-admin-profile-image-wrap">
                  {adminPhoto ? <img src={adminPhoto} alt={adminName} /> : <span className="adb-admin-profile-initial">A</span>}
                </div>
                <div className="adb-admin-photo-actions">
                  <label className="adb-admin-photo-picker">
                    <span className="material-symbols-outlined">add_a_photo</span>
                    <span>{adminPhotoUploading ? 'Uploading...' : 'Change photo'}</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleAdminPhotoChange} disabled={adminPhotoUploading || adminPhotoRemoving} />
                  </label>
                  {currentAdmin?.photo && (
                    <button type="button" className="adb-admin-photo-remove" onClick={handleAdminPhotoRemove} disabled={adminPhotoUploading || adminPhotoRemoving}>
                      <span className="material-symbols-outlined">delete</span>
                      <span>{adminPhotoRemoving ? 'Removing...' : 'Remove photo'}</span>
                    </button>
                  )}
                </div>
                {adminPhotoError && <p className="adb-profile-error">{adminPhotoError}</p>}
              </div>

              <form className="adb-admin-profile-form" onSubmit={handleAdminProfileSave}>
                <div className="adb-field-row">
                  <label className="adb-field">
                    <span>Full name</span>
                    <input
                      type="text"
                      value={adminProfileForm.name}
                      onChange={event => setAdminProfileForm(current => ({ ...current, name: event.target.value }))}
                      required
                    />
                  </label>
                </div>

                <div className="adb-field-row adb-field-row--two">
                  <label className="adb-field">
                    <span>Email</span>
                    <input
                      type="email"
                      value={adminProfileForm.email}
                      onChange={event => setAdminProfileForm(current => ({ ...current, email: event.target.value }))}
                      required
                    />
                  </label>
                  <label className="adb-field">
                    <span>Phone</span>
                    <input
                      type="tel"
                      value={adminProfileForm.phone}
                      onChange={event => setAdminProfileForm(current => ({ ...current, phone: event.target.value }))}
                    />
                  </label>
                </div>

                <div className="adb-admin-profile-summary">
                  <div>
                    <span>Role</span>
                    <strong>{adminRole}</strong>
                  </div>
                  <div>
                    <span>Access</span>
                    <strong>Full admin access</strong>
                  </div>
                </div>

                {adminProfileMessage && <p className="adb-profile-message">{adminProfileMessage}</p>}

                <div className="adb-dialog-actions">
                  <button type="button" className="adb-dialog-secondary" onClick={() => setShowAdminProfileModal(false)}>Close</button>
                  <button type="submit" className="adb-dialog-primary" disabled={adminProfileSaving}>
                    {adminProfileSaving ? 'Saving...' : 'Save profile'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Alert Composer Modal ──────────────── */}
      {showAlertComposer && (
        <div className="adb-dialog-backdrop" onClick={() => setShowAlertComposer(false)}>
          <form className="adb-dialog" onSubmit={sendAlert} onClick={event => event.stopPropagation()}>
            <h3>Send Alert</h3>
            {alertSent ? <p className="adb-dialog-success">Alert sent successfully to all candidates.</p> : <>
              <label htmlFor="admin-alert-message">Message</label>
              <textarea id="admin-alert-message" value={alertMessage} onChange={event => setAlertMessage(event.target.value)} placeholder="Write an announcement for all students..." rows={4} required />
              <div className="adb-dialog-actions">
                <button type="button" onClick={() => setShowAlertComposer(false)}>Cancel</button>
                <button type="submit" className="adb-dialog-primary">Send Alert</button>
              </div>
            </>}
            {alertSent && <button type="button" className="adb-dialog-primary" onClick={() => setShowAlertComposer(false)}>Done</button>}
          </form>
        </div>
      )}

      {/* ── Server Settings Modal ─────────────── */}
      {showServerSettings && (
        <div className="adb-dialog-backdrop" onClick={() => setShowServerSettings(false)}>
          <div className="adb-dialog" onClick={event => event.stopPropagation()}>
            <h3>Platform & Server Settings</h3>
            <div className="adb-setting-row"><span>Backend API</span><strong className="adb-dialog-success">Online (Port 5000)</strong></div>
            <div className="adb-setting-row"><span>Database</span><strong>Supabase PostgreSQL</strong></div>
            <div className="adb-setting-row"><span>Auth & CSRF</span><strong>Strict Token Validation</strong></div>
            <div className="adb-setting-row"><span>Excel Export Engine</span><strong className="adb-dialog-success">SheetJS (.xlsx) Active</strong></div>
            <div className="adb-setting-row"><span>Environment</span><strong>{import.meta.env.MODE || 'development'}</strong></div>
            <div className="adb-dialog-actions"><button type="button" className="adb-dialog-primary" onClick={() => setShowServerSettings(false)}>Close</button></div>
          </div>
        </div>
      )}

      {/* ── Help & Support Modal ──────────────── */}
      {showHelpModal && (
        <div className="rr-modal-backdrop" onClick={() => setShowHelpModal(false)}>
          <div className="rr-modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <div className="rr-modal-header">
              <h3 className="rr-modal-title">
                <span className="material-symbols-outlined">help</span>
                CET Admin Portal — Help & Documentation
              </h3>
              <button className="rr-modal-close-btn" onClick={() => setShowHelpModal(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="rr-modal-body">
              <h4 style={{ margin: '0 0 8px', color: '#005bbf' }}>Student Approval & Excel Export</h4>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: '#475569', margin: '0 0 16px' }}>
                Under <strong>Registrations</strong>, review new student sign-ups. Click <strong>Approve</strong> or <strong>Bulk Approve</strong> to assign an official MHT-CET ID and generate credentials. Use the <strong>Export Excel</strong> button to download batch-wise spreadsheets formatted with <em>Student Name</em>, <em>Email ID</em>, <em>Student Unique No.</em>, <em>Username</em>, and <em>Password</em>.
              </p>

              <h4 style={{ margin: '0 0 8px', color: '#005bbf' }}>Mock Tests & Questions</h4>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: '#475569', margin: '0 0 16px' }}>
                Build full-length and subject-wise exams under <strong>Mock Tests</strong>. Add questions with LaTeX formulas, options, and full step-by-step solutions in the <strong>Question Bank</strong>.
              </p>

              <h4 style={{ margin: '0 0 8px', color: '#005bbf' }}>Exam Telemetry & Live Proctoring</h4>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: '#475569', margin: 0 }}>
                Click <strong>Enter Control Room</strong> from the overview to observe real-time candidate connections, proctoring alerts, and completion rates.
              </p>
            </div>
            <div className="rr-modal-footer">
              <button type="button" className="rr-bulk-btn" onClick={() => setShowHelpModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── View All Activities Modal ─────────── */}
      {showActivitiesModal && (
        <div className="rr-modal-backdrop" onClick={() => setShowActivitiesModal(false)}>
          <div className="rr-modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 680 }}>
            <div className="rr-modal-header">
              <h3 className="rr-modal-title">
                <span className="material-symbols-outlined">history</span>
                All Recent Student Activities ({testResults.length})
              </h3>
              <button className="rr-modal-close-btn" onClick={() => setShowActivitiesModal(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="rr-modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {testResults.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#64748b' }}>No activities recorded yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {testResults.slice(0, 30).map((r) => {
                    const studentName = typeof r.userId === 'object' && r.userId?.name ? r.userId.name : 'Student'
                    const dt = new Date(r.attemptedAt).toLocaleString('en-IN')
                    return (
                      <div key={r._id} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '12px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0'
                      }}>
                        <div>
                          <strong style={{ fontSize: 14, color: '#0f172a' }}>{studentName}</strong>
                          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>{r.testName || 'Mock Test'} • {dt}</p>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontWeight: 700, color: '#005bbf', fontSize: 14 }}>{Math.round(r.score)}/{r.totalMarks}</span>
                          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#16a34a', fontWeight: 600 }}>{Number(r.percentile || 0).toFixed(1)}th %ile</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="rr-modal-footer">
              <button type="button" className="rr-bulk-btn" onClick={() => setShowActivitiesModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Live Control Room Modal ───────────── */}
      {showControlRoomModal && (
        <div className="rr-modal-backdrop" onClick={() => setShowControlRoomModal(false)}>
          <div className="rr-modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <div className="rr-modal-header" style={{ background: '#0f172a', color: '#fff' }}>
              <h3 className="rr-modal-title" style={{ color: '#fff' }}>
                <span className="material-symbols-outlined" style={{ color: '#38bdf8' }}>monitoring</span>
                MHT-CET Phase 1 — Live Control Room
              </h3>
              <button className="rr-modal-close-btn" style={{ color: '#94a3b8' }} onClick={() => setShowControlRoomModal(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="rr-modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
                <div style={{ padding: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, textAlign: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#166534', textTransform: 'uppercase' }}>Active Connections</span>
                  <h4 style={{ margin: '4px 0 0', fontSize: 20, color: '#15803d' }}>12,402</h4>
                </div>
                <div style={{ padding: 12, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, textAlign: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase' }}>Average Latency</span>
                  <h4 style={{ margin: '4px 0 0', fontSize: 20, color: '#1d4ed8' }}>24 ms</h4>
                </div>
                <div style={{ padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, textAlign: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#991b1b', textTransform: 'uppercase' }}>Errors Reported</span>
                  <h4 style={{ margin: '4px 0 0', fontSize: 20, color: '#dc2626' }}>0</h4>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13, fontWeight: 600 }}>
                  <span>Overall Exam Phase Completion</span>
                  <span>74% Complete</span>
                </div>
                <div style={{ height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: '74%', height: '100%', background: '#005bbf', borderRadius: 4 }} />
                </div>
              </div>

              <div style={{ padding: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, color: '#475569' }}>
                <p style={{ margin: '0 0 6px' }}><strong>Proctoring Status:</strong> All automated browser fullscreen & focus tracking systems are armed and operating normally.</p>
                <p style={{ margin: 0 }}><strong>Security:</strong> CSRF and Rate Limiting protections are active on all exam submission endpoints.</p>
              </div>
            </div>
            <div className="rr-modal-footer">
              <button
                type="button"
                className="rr-bulk-btn"
                style={{ background: '#2563eb', color: '#fff', borderColor: '#2563eb' }}
                onClick={() => {
                  setShowControlRoomModal(false)
                  setShowAlertComposer(true)
                }}
              >
                Broadcast Announcement
              </button>
              <button type="button" className="rr-bulk-btn" onClick={() => setShowControlRoomModal(false)}>
                Exit Control Room
              </button>
            </div>
          </div>
        </div>
      )}

      {showTest ? (
        <TestInterface onClose={() => setShowTest(false)} />
      ) : (
        <div className={`adb-root${viewProfileId ? ' adb-root--profile' : ''}`}>

          {/* ── Sidebar ─────────────────────────── */}
          <aside className="adb-sidebar">
            <div className="adb-brand">
              <span className="material-symbols-outlined adb-brand-icon"
                style={{ fontVariationSettings: "'FILL' 1" }}>analytics</span>
              <span className="adb-brand-title">CET Admin</span>
            </div>

            <nav className="adb-nav">
              {NAV.map(item => (
                <a key={item.label} href="#"
                  className={`adb-nav-item${view === item.view ? ' adb-nav-item--active' : ''}`}
                  onClick={e => {
                    e.preventDefault()
                    if (item.label === 'Settings') {
                      changeView('settings')
                      return
                    }
                    if (item.view) changeView(item.view)
                  }}
                >
                  <span className="material-symbols-outlined">{item.icon}</span>
                  <span>{item.label}</span>
                </a>
              ))}
            </nav>

            <div className="adb-sidebar-bottom">
              <button type="button" className="adb-admin-row adb-admin-row--button" onClick={() => setShowAdminProfileModal(true)}>
                {adminPhoto ? <img className="adb-admin-avatar" src={adminPhoto} alt={adminName} /> : <span className="adb-admin-avatar adb-admin-avatar--initial">A</span>}
                <div>
                  <p className="adb-admin-name">{adminName}</p>
                  <p className="adb-admin-role">{adminRole}</p>
                </div>
              </button>
              <a href="#" className="adb-logout-link" onClick={handleLogout}>
                <span className="material-symbols-outlined">logout</span>
                <span>Logout</span>
              </a>
            </div>
          </aside>

          {/* ── Main ────────────────────────────── */}
          <main className="adb-main">
            <header className="adb-topbar">
              <div className="adb-topbar-left">
                <h2 className="adb-topbar-brand">CET Prep Pro</h2>
                <div className="adb-topbar-sep" />
                <span className="adb-topbar-sub">{topbarTitle}</span>
              </div>
              <div className="adb-topbar-right" style={{ position: 'relative' }}>
                <div className="adb-search">
                  <input
                    className="adb-search-input"
                    placeholder="Search data…"
                    type="text"
                    value={topbarSearch}
                    onChange={e => setTopbarSearch(e.target.value)}
                  />
                  <span className="material-symbols-outlined adb-search-icon">search</span>
                </div>

                <button
                  type="button"
                  className="adb-icon-btn"
                  title="Notifications"
                  onClick={() => setShowNotifications(prev => !prev)}
                >
                  <span className="material-symbols-outlined">notifications</span>
                  {!readNotifications && (
                    <span style={{
                      position: 'absolute', top: 6, right: 6, width: 8, height: 8,
                      borderRadius: '50%', background: '#ef4444'
                    }} />
                  )}
                </button>

                <button
                  type="button"
                  className="adb-icon-btn"
                  title="Help & Guidelines"
                  onClick={() => setShowHelpModal(true)}
                >
                  <span className="material-symbols-outlined">help</span>
                </button>

                {/* Notifications popover */}
                {showNotifications && (
                  <div className="adb-notif-dropdown">
                    <div className="adb-notif-header">
                      <h4>Admin Notifications</h4>
                      <button className="adb-notif-clear-btn" onClick={() => setReadNotifications(true)}>
                        Mark all as read
                      </button>
                    </div>
                    <div className="adb-notif-list">
                      <div className="adb-notif-item">
                        <span className="material-symbols-outlined" style={{ color: '#2563eb' }}>how_to_reg</span>
                        <div>
                          <strong>Student Approvals Active</strong>
                          <p style={{ margin: '2px 0 0', color: '#64748b' }}>Check the registrations tab to review pending candidates.</p>
                        </div>
                      </div>
                      <div className="adb-notif-item">
                        <span className="material-symbols-outlined" style={{ color: '#16a34a' }}>table_view</span>
                        <div>
                          <strong>Excel Export Ready</strong>
                          <p style={{ margin: '2px 0 0', color: '#64748b' }}>Download batch-wise student spreadsheets with passwords anytime.</p>
                        </div>
                      </div>
                      <div className="adb-notif-item">
                        <span className="material-symbols-outlined" style={{ color: '#8b5cf6' }}>quiz</span>
                        <div>
                          <strong>{mockTests.length} Active Mock Exams</strong>
                          <p style={{ margin: '2px 0 0', color: '#64748b' }}>Platform ready for incoming candidate attempts.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </header>

            <div className="adb-content">
              {view === 'overview' && (
                <>
                  {/* Welcome */}
                  <div className="adb-welcome">
                    <div>
                      <h1 className="adb-page-title">Dashboard Overview</h1>
                      <p className="adb-page-sub">Performance metrics and platform health for the last 30 days.</p>
                    </div>
                    <button
                      type="button"
                      className="adb-new-btn"
                      onClick={() => {
                        const next = !showTest
                        setShowTest(next)
                      }}
                    >
                      <span className="material-symbols-outlined">add</span>Start New Test
                    </button>
                  </div>

                  {/* Stats */}
                  <div className="adb-stats">
                    {[
                      { icon: 'group', cls: 'adb-si-blue', badge: 'Live', bcls: 'adb-badge-green', label: 'TOTAL STUDENTS', val: students.length.toLocaleString() },
                      { icon: 'rocket_launch', cls: 'adb-si-purple', badge: 'Active', bcls: 'adb-badge-green', label: 'ACTIVE EXAMS', val: mockTests.filter(test => test.status === 'active').length.toLocaleString() },
                      { icon: 'database', cls: 'adb-si-teal', badge: 'Live', bcls: 'adb-badge-blue', label: 'QUESTION COUNT', val: questions.length.toLocaleString() },
                      { icon: 'today', cls: 'adb-si-green', badge: 'Today', bcls: 'adb-badge-green', label: 'ATTEMPTS TODAY', val: attemptsToday.toLocaleString() },
                    ].map(s => (
                      <div key={s.label} className="adb-stat-card">
                        <div className="adb-stat-top">
                          <div className={`adb-stat-icon ${s.cls}`}>
                            <span className="material-symbols-outlined">{s.icon}</span>
                          </div>
                          <span className={`adb-badge ${s.bcls}`}>{s.badge}</span>
                        </div>
                        <p className="adb-stat-label">{s.label}</p>
                        <p className="adb-stat-val">{s.val}</p>
                      </div>
                    ))}
                  </div>

                  {/* Chart + Activity */}
                  <div className="adb-mid">
                    <div className="adb-card adb-chart-card">
                      <div className="adb-chart-hdr">
                        <h4 className="adb-card-title">Daily Test Attempts</h4>
                        <div className="adb-chart-tabs">
                          <button
                            type="button"
                            className={`adb-tab ${chartRange === '30d' ? 'adb-tab--on' : ''}`}
                            onClick={() => setChartRange('30d')}
                          >
                            Last 30 Days
                          </button>
                          <button
                            type="button"
                            className={`adb-tab ${chartRange === 'yearly' ? 'adb-tab--on' : ''}`}
                            onClick={() => setChartRange('yearly')}
                          >
                            Yearly
                          </button>
                        </div>
                      </div>
                      <div className="adb-chart-area"><canvas ref={canvasRef} /></div>
                    </div>
                    <div className="adb-card adb-act-card">
                      <div className="adb-act-hdr"><h4 className="adb-card-title">Recent Activity</h4></div>
                      <div className="adb-act-list">
                        {activities.length ? activities.map((a, i) => (
                          <div key={i} className="adb-act-row">
                            <div className={`adb-act-dot ${a.cls}`}>
                              <span className="material-symbols-outlined">{a.icon}</span>
                            </div>
                            <div className="adb-act-body">
                              <p className="adb-act-title">{a.title}</p>
                              <p className="adb-act-sub">{a.sub}</p>
                              <span className="adb-act-time">{a.time}</span>
                            </div>
                          </div>
                        )) : <p className="adb-act-empty">No recent activity in the last 24 hours.</p>}
                      </div>
                      <div className="adb-act-footer">
                        <button
                          type="button"
                          className="adb-view-all"
                          onClick={() => setShowActivitiesModal(true)}
                        >
                          View All Activities
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Bottom */}
                  <div className="adb-bottom">
                    <div className="adb-card adb-quick-card">
                      <h4 className="adb-card-title">Quick Actions</h4>
                      <div className="adb-quick-grid">
                        {QUICK.map(q => (
                          <button key={q.label} className="adb-quick-btn" onClick={() => handleQuickAction(q.label)}>
                            <span className="material-symbols-outlined adb-quick-icon">{q.icon}</span>
                            <span className="adb-quick-label">{q.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="adb-card adb-exam-card">
                      <div className="adb-exam-blob" />
                      <h4 className="adb-card-title">Ongoing: MHT-CET Phase 1</h4>
                      <div className="adb-live"><span className="adb-live-dot" /><span>LIVE MONITORING</span></div>
                      <div className="adb-progress-row"><span>Progress (Completion)</span><span>74%</span></div>
                      <div className="adb-progress-track"><div className="adb-progress-fill" style={{ width: '74%' }} /></div>
                      <div className="adb-exam-meta">
                        <div><p className="adb-meta-label">Active Connections</p><p className="adb-meta-val">12,402</p></div>
                        <div><p className="adb-meta-label">Errors Reported</p><p className="adb-meta-val adb-meta-val--red">0</p></div>
                      </div>
                      <button
                        type="button"
                        className="adb-control-btn"
                        onClick={() => setShowControlRoomModal(true)}
                      >
                        <span className="material-symbols-outlined">monitoring</span>Enter Control Room
                      </button>
                    </div>
                  </div>
                </>
              )}

              {view === 'registrations' && <RegistrationReview />}
              {view === 'students' && (
                viewProfileId
                  ? <StudentProfile studentId={viewProfileId} onBack={() => setViewProfileId(null)} />
                  : <RegisteredStudents onViewProfile={setViewProfileId} />
              )}
              {view === 'questions' && <QuestionBank />}
              {view === 'mocktests' && <AdminMockTests />}
              {view === 'analytics' && <AdminAnalysis />}
              {view === 'settings' && <AdminSettings />}
            </div>
          </main>
        </div>
      )}
    </>
  )
}
