import { useEffect, useRef, useState } from 'react'
import { Chart, registerables } from 'chart.js'
import { authAPI, session, usersAPI, AuthUser } from '../lib/api'
import StudentProfile from './StudentProfile'
import TestInterface from './TestInterface'
import QuestionBank from './QuestionBank'
import AdminMockTests from './AdminMockTests'
import '../testInterface.css'
import '../questionBank.css'
Chart.register(...registerables)

type Page = 'signin' | 'dashboard' | 'mocktests' | 'results' | 'analytics' | 'settings' | 'admin-dashboard'
type AdminView = 'overview' | 'registrations' | 'students' | 'questions' | 'mocktests'

interface AdminDashboardProps {
  onNavigate?: (page: Page) => void
}

/* ─────────────────────────────────────────
  Dashboard Data
───────────────────────────────────────── */
const ACTIVITY = [
  { icon: 'cloud_upload', cls: 'adb-act-blue',   title: 'New bulk upload by Admin X',  sub: 'Physics Question Bank (Set B)',       time: '2 MINUTES AGO' },
  { icon: 'check_circle', cls: 'adb-act-purple', title: 'MHT-CET Final Mock completed', sub: 'Attempted by 512 students',           time: '45 MINUTES AGO' },
  { icon: 'person_add',   cls: 'adb-act-orange', title: 'New Teacher registration',     sub: 'Dr. Amit Sharma joined Chemistry',    time: '3 HOURS AGO' },
  { icon: 'warning',      cls: 'adb-act-red',    title: 'System Maintenance Alert',     sub: 'Database cleanup scheduled for 2 AM', time: '5 HOURS AGO' },
  { icon: 'payments',     cls: 'adb-act-green',  title: 'Bulk License Renewal',         sub: 'Orchid High School – 250 seats',      time: '8 HOURS AGO' },
]
const QUICK = [
  { icon: 'assignment_ind',  label: 'Manage Faculty' },
  { icon: 'backup',          label: 'Upload Data' },
  { icon: 'mail',            label: 'Send Alerts' },
  { icon: 'settings_suggest',label: 'Server Settings' },
]
const NAV = [
  { icon: 'dashboard',      label: 'Dashboard',        view: 'overview'       as AdminView },
  { icon: 'quiz',           label: 'Mock Tests',        view: 'mocktests'      as AdminView },
  { icon: 'how_to_reg',     label: 'Registrations',     view: 'registrations'  as AdminView },
  { icon: 'group',          label: 'Students',          view: 'students'       as AdminView },
  { icon: 'menu_book',      label: 'Question Bank',     view: 'questions'      as AdminView },
  { icon: 'analytics',      label: 'Analytics',         view: null },
  { icon: 'settings',       label: 'Settings',          view: null },
]

/* ─────────────────────────────────────────
  Registered Students — LIVE DATA
───────────────────────────────────────── */
function RegisteredStudents({ onViewProfile }: { onViewProfile: (id: string) => void }) {
  const [students, setStudents]       = useState<AuthUser[]>([])
  const [loading, setLoading]         = useState(true)
  const [deleting, setDeleting]       = useState<string | null>(null)
  const [confirmId, setConfirmId]     = useState<string | null>(null)
  const [resending, setResending]     = useState<string | null>(null)
  const [uploading, setUploading]     = useState<string | null>(null)
  const [toast, setToast]             = useState('')
  const [search, setSearch]           = useState('')
  const [branchFilter, setBranchFilter] = useState('All')

  const showToast = (msg: string) => {
    setToast(msg); setTimeout(() => setToast(''), 3500)
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
    const interval = setInterval(() => fetchStudents(true), 5000)
    return () => clearInterval(interval)
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
    return matchSearch && matchBranch
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
          <div className="rs2-search-wrap">
            <span className="material-symbols-outlined rs2-search-icon">search</span>
            <input className="rs2-search" placeholder="Search name, email, MHT-CET ID…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
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
  const [students, setStudents]   = useState<AuthUser[]>([])
  const [stats, setStats]         = useState({ pending: 0, approved: 0, rejected: 0 })
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState<string[]>([])
  const [actionMsg, setActionMsg] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const fetchData = async (hideLoading = false) => {
    try {
      if (!hideLoading) setLoading(true)
      const [users, s] = await Promise.all([
        usersAPI.getAll('pending'),
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
    const interval = setInterval(() => fetchData(true), 5000)
    return () => clearInterval(interval)
  }, [])

  const toggle = (id: string) =>
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  const toggleAll = () =>
    setSelected(s => s.length === students.length ? [] : students.map(s => s._id))

  const showMsg = (msg: string) => {
    setActionMsg(msg)
    setTimeout(() => setActionMsg(''), 3500)
  }

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

      {/* Stats row */}
      <div className="rr-stats">
        <div className="rr-stat">
          <span className="material-symbols-outlined rr-stat-icon rr-stat-icon--blue">pending_actions</span>
          <div>
            <p className="rr-stat-label">TOTAL PENDING</p>
            <p className="rr-stat-val">{stats.pending}</p>
          </div>
        </div>
        <div className="rr-divider" />
        <div className="rr-stat">
          <span className="material-symbols-outlined rr-stat-icon rr-stat-icon--green">check_circle</span>
          <div>
            <p className="rr-stat-label">APPROVED</p>
            <p className="rr-stat-val">{stats.approved}</p>
          </div>
        </div>
        <div className="rr-divider" />
        <div className="rr-stat">
          <span className="material-symbols-outlined rr-stat-icon rr-stat-icon--red">warning</span>
          <div>
            <p className="rr-stat-label">REJECTED</p>
            <p className="rr-stat-val">{stats.rejected}</p>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="rr-toolbar">
        <div className="rr-filters">
          <div className="rr-filter-label-chip">
            <span className="material-symbols-outlined">schedule</span>
            Pending Registrations
          </div>
        </div>
        <div className="rr-bulk-actions">
          <button className="rr-bulk-btn rr-bulk-btn--reject" disabled={selected.length === 0}>
            <span className="material-symbols-outlined">block</span>
            Bulk Reject ({selected.length})
          </button>
          <button className="rr-bulk-btn rr-bulk-btn--approve" disabled={selected.length === 0}>
            <span className="material-symbols-outlined">check_circle</span>
            Bulk Approve ({selected.length})
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rr-table-wrap">
        {loading ? (
          <div className="rr-loading">
            <div className="rr-spinner" />
            <p>Loading registrations…</p>
          </div>
        ) : students.length === 0 ? (
          <div className="rr-empty">
            <span className="material-symbols-outlined">inbox</span>
            <p>No pending registrations</p>
          </div>
        ) : (
          <table className="rr-table">
            <thead>
              <tr className="rr-thead-row">
                <th className="rr-th rr-th--check">
                  <input type="checkbox"
                    checked={selected.length === students.length && students.length > 0}
                    onChange={toggleAll} className="rr-checkbox" />
                </th>
                <th className="rr-th">STUDENT NAME</th>
                <th className="rr-th">EMAIL ADDRESS</th>
                <th className="rr-th">DATE & TIME</th>
                <th className="rr-th">BRANCH</th>
                <th className="rr-th rr-th--right">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => {
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
                          <p className="rr-student-id">{s.phone || s.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="rr-td rr-td--email">{s.email}</td>
                    <td className="rr-td">
                      <p className="rr-date">{dt.date}</p>
                      <p className="rr-time">{dt.time}</p>
                    </td>
                    <td className="rr-td">
                      <span className="rr-branch-badge">{s.branch}</span>
                    </td>
                    <td className="rr-td rr-td--right">
                      <div className="rr-actions">
                        <button className="rr-action-btn rr-action-btn--view" title="View">
                          <span className="material-symbols-outlined">visibility</span>
                        </button>
                        <button
                          className="rr-action-btn rr-action-btn--approve"
                          disabled={isApproving || isRejecting}
                          onClick={() => handleApprove(s._id, s.name)}
                        >
                          {isApproving ? <div className="rr-btn-spinner" /> : 'Approve'}
                        </button>
                        <button
                          className="rr-action-btn rr-action-btn--reject"
                          disabled={isApproving || isRejecting}
                          onClick={() => handleReject(s._id, s.name)}
                          title="Reject"
                        >
                          {isRejecting
                            ? <div className="rr-btn-spinner rr-btn-spinner--sm" />
                            : <span className="material-symbols-outlined">close</span>}
                        </button>
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
      {!loading && students.length > 0 && (
        <div className="rr-table-footer">
          <p className="rr-count">Showing {students.length} pending applicant{students.length !== 1 ? 's' : ''}</p>
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
            Click <strong>Approve</strong> to generate a unique MHT-CET ID and password. Credentials are automatically sent to the student's registered email address.
          </p>
        </div>
        <div className="rr-info-card rr-info-card--purple">
          <div className="rr-info-header">
            <span className="material-symbols-outlined rr-info-icon">auto_awesome</span>
            <span className="rr-info-title">Email Notification</span>
          </div>
          <p className="rr-info-text">
            On approval, the Python email service sends a <strong className="rr-uploaded-badge">formatted HTML email</strong> with login credentials to the student instantly.
          </p>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────
  Main Admin Dashboard
───────────────────────────────────────── */
export default function AdminDashboard({ onNavigate }: AdminDashboardProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const chartRef   = useRef<Chart | null>(null)
  const [view, setView] = useState<AdminView>('overview')
  const [viewProfileId, setViewProfileId] = useState<string | null>(null)
  const [showTest, setShowTest] = useState(false)

  useEffect(() => {
    if (view !== 'overview') return
    if (!canvasRef.current) return
    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return
    chartRef.current?.destroy()

    const grad = ctx.createLinearGradient(0, 0, 0, 340)
    grad.addColorStop(0, 'rgba(26,115,232,0.35)')
    grad.addColorStop(1, 'rgba(26,115,232,0)')

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels: Array.from({ length: 30 }, (_, i) => {
          const show = [0,3,6,9,12,15,18,21,24,27]
          return show.includes(i) ? `Day ${i + 1}` : ''
        }),
        datasets: [{
          label: 'Test Attempts',
          data: [1200,1900,3000,5000,4200,3100,4800,5200,6100,7000,
                 6800,7200,8100,7900,8500,9200,9800,10200,11000,10800,
                 11500,12000,13100,12800,13500,14200,15000,14800,15500,16200],
          borderColor: '#1a73e8',
          borderWidth: 2.5,
          fill: true,
          backgroundColor: grad,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 5,
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
              callback: v => Number(v) >= 1000 ? `${Number(v)/1000}k` : String(v),
            },
          },
        },
      },
    })
    return () => chartRef.current?.destroy()
  }, [view])

  const topbarTitle = view === 'registrations' ? 'Registration Review' : 'Admin Console'

  return (
    <>
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
              onClick={e => { e.preventDefault(); if (item.view) setView(item.view) }}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              <span>{item.label}</span>
            </a>
          ))}
        </nav>

        <div className="adb-sidebar-bottom">
          <div className="adb-admin-row">
            <img className="adb-admin-avatar"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuDWpayorudDpV1PjBCVsrLYUz1_tl6nSQvGAZ8XASMWIW6RVYVgBkWsHzHE9qtkE1B055qgcgwyYHZYHYXQYQDXBBlvXnZpQA67ft2ftscqBUExT7zmtmtKw8Sd3gsu8T0xpM69hVIwoRXpBSsBmPtVLQOO_UC2KNSavm28KJyv9lHaWPS-CfwzW6mlU2ihGpurQh7NbKA6chXikCijY-TtmEiXmj5tr-Zn034nC1B4OPPLHSowXaj5f2cItjlmFEIdu2SMscAZKVo"
              alt="Admin X" />
            <div>
              <p className="adb-admin-name">Admin X</p>
              <p className="adb-admin-role">Exam Controller</p>
            </div>
          </div>
          <a href="#" className="adb-logout-link"
            onClick={async e => {
              e.preventDefault()
              try {
                await authAPI.logout()
              } catch (error) {
                console.warn('Logout failed, clearing local session anyway', error)
              }
              session.clear()
              onNavigate?.('signin')
            }}>
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
          <div className="adb-topbar-right">
            <div className="adb-search">
              <input className="adb-search-input" placeholder="Search data…" type="text" />
              <span className="material-symbols-outlined adb-search-icon">search</span>
            </div>
            <button className="adb-icon-btn"><span className="material-symbols-outlined">notifications</span></button>
            <button className="adb-icon-btn"><span className="material-symbols-outlined">help</span></button>
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
                    console.log('Start New Test clicked', { showTest: next })
                    setShowTest(next)
                  }}
                >
                  <span className="material-symbols-outlined">add</span>Start New Test
                </button>
              </div>

              {/* Stats */}
              <div className="adb-stats">
                {[
                  { icon: 'group',         cls: 'adb-si-blue',   badge: '+12%',     bcls: 'adb-badge-green', label: 'TOTAL STUDENTS',  val: '42,892' },
                  { icon: 'rocket_launch', cls: 'adb-si-purple', badge: 'Active',   bcls: 'adb-badge-green', label: 'ACTIVE EXAMS',    val: '156' },
                  { icon: 'database',      cls: 'adb-si-teal',   badge: '8.4k New', bcls: 'adb-badge-blue',  label: 'QUESTION COUNT',  val: '128,402' },
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
                      <button className="adb-tab adb-tab--on">Last 30 Days</button>
                      <button className="adb-tab">Yearly</button>
                    </div>
                  </div>
                  <div className="adb-chart-area"><canvas ref={canvasRef} /></div>
                </div>
                <div className="adb-card adb-act-card">
                  <div className="adb-act-hdr"><h4 className="adb-card-title">Recent Activity</h4></div>
                  <div className="adb-act-list">
                    {ACTIVITY.map((a, i) => (
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
                    ))}
                  </div>
                  <div className="adb-act-footer">
                    <button className="adb-view-all">View All Activities</button>
                  </div>
                </div>
              </div>

              {/* Bottom */}
              <div className="adb-bottom">
                <div className="adb-card adb-quick-card">
                  <h4 className="adb-card-title">Quick Actions</h4>
                  <div className="adb-quick-grid">
                    {QUICK.map(q => (
                      <button key={q.label} className="adb-quick-btn">
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
                  <button className="adb-control-btn">
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
        </div>
      </main>
    </div>
      )}
    </>
  )
}
