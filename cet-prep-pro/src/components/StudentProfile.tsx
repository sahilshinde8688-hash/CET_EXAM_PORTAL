import { useState, useEffect } from 'react'
import { usersAPI, AuthUser } from '../lib/api'
import '../studentProfile.css'

interface Props {
  studentId: string
  onBack: () => void
}

export default function StudentProfile({ studentId, onBack }: Props) {
  const [student, setStudent] = useState<AuthUser | null>(null)

  useEffect(() => {
    const fetchStudent = async () => {
      const all = await usersAPI.getAll('approved')
      const found = all.find(s => s._id === studentId)
      setStudent(found || null)
    }
    fetchStudent()
  }, [studentId])

  if (!student) {
    return (
      <div className="sp-root">
        <div className="sp-loading">Loading student details…</div>
      </div>
    )
  }

  const branchLabels: Record<string, string> = { Byculla: 'Byculla', Worli: 'Worli', Prabhadevi: 'Prabhadevi' }
  
  const getBranchLabel = (branch?: string): string => {
    return branch ? (branchLabels[branch] || branch) : '—'
  }

  return (
    <div className="sp-root">
      {/* Fixed Left Sidebar */}
      <aside className="sp-sidebar">
        <div className="sp-sidebar-top">
          <div className="sp-avatar-wrap">
            <div className="sp-avatar">
              <img src={student.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(student.name)}&background=2563eb&color=fff&size=128`} alt={student.name} />
            </div>
            <span className="sp-online" />
          </div>
          <h2 className="sp-name">{student.name}</h2>
          <p className="sp-roll">Roll No: {student.mhcetId || 'N/A'}</p>
          <div className="sp-badges">
            <span className="sp-badge sp-badge--green">Active</span>
            {student.batch === 1 && <span className="sp-badge sp-badge--blue">Batch 1</span>}
            {student.batch === 2 && <span className="sp-badge sp-badge--purple">Batch 2</span>}
          </div>
        </div>

        <div className="sp-info-grid">
          <div className="sp-info-row"><span>ID</span><span>{student.mhcetId || '—'}</span></div>
                  <div className="sp-info-row"><span>Branch</span><span>{getBranchLabel(student.branch)}</span></div>
          <div className="sp-info-row"><span>Batch</span><span>{student.batch || '—'}</span></div>
          <div className="sp-info-row"><span>Email</span><span>{student.email}</span></div>
          <div className="sp-info-row"><span>Password</span><span>{student.mhcetPassword || '—'}</span></div>
          <div className="sp-info-row"><span>Phone</span><span>{student.phone || '—'}</span></div>
          <div className="sp-info-row"><span>Joined</span><span>{student.createdAt ? new Date(student.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</span></div>
        </div>

        <div className="sp-sidebar-actions">
          <button className="sp-sidebar-btn sp-sidebar-btn--primary"><span className="material-symbols-outlined">edit</span> Edit Profile</button>
          <button className="sp-sidebar-btn"><span className="material-symbols-outlined">download</span> Download Report</button>
          <button className="sp-sidebar-btn"><span className="material-symbols-outlined">print</span> Print Profile</button>
        </div>

        <div className="sp-sidebar-bottom">
          <div className="sp-mentor">
            <div className="sp-mentor-icon"><span className="material-symbols-outlined">support_agent</span></div>
            <div><p className="sp-mentor-label">Assigned Mentor</p><p className="sp-mentor-name">Admin X</p></div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="sp-main">
        {/* Header */}
        <header className="sp-header">
          <div className="sp-header-left">
            <button className="sp-back-btn" onClick={onBack}><span className="material-symbols-outlined">arrow_back</span></button>
            <div className="sp-search">
              <span className="material-symbols-outlined sp-search-icon">search</span>
              <input className="sp-search-input" placeholder="Search tests, subjects, or logs…" />
            </div>
            <div className="sp-filter-chip">
              <span className="material-symbols-outlined">calendar_today</span>
              <span>Last 30 Days</span>
              <span className="material-symbols-outlined">expand_more</span>
            </div>
          </div>
          <div className="sp-header-right">
            <div className="sp-filter-group">
              <button className="sp-filter-btn"><span className="material-symbols-outlined">filter_list</span></button>
              <button className="sp-filter-chip">Subjects</button>
              <button className="sp-filter-chip">Status</button>
            </div>
            <button className="sp-export-btn"><span className="material-symbols-outlined">table_view</span> Export</button>
          </div>
        </header>

        <div className="sp-content">
          {/* Overview: Bio + KPIs */}
          <div className="sp-grid sp-grid--overview">
            <div className="sp-card sp-card--bio">
              <h3 className="sp-card-title"><span className="material-symbols-outlined sp-title-icon">person</span> Detailed Bio</h3>
              <div className="sp-bio-grid">
                <div className="sp-bio-col">
                  <div className="sp-bio-item"><p className="sp-bio-label">Registration Date</p><p className="sp-bio-value">{student.createdAt ? new Date(student.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</p></div>
                  <div className="sp-bio-item"><p className="sp-bio-label">Email Address</p><p className="sp-bio-value sp-link">{student.email}</p></div>
                  <div className="sp-bio-item"><p className="sp-bio-label">Contact Number</p><p className="sp-bio-value">{student.phone || '—'}</p></div>
                  <div className="sp-bio-item"><p className="sp-bio-label">Branch</p><p className="sp-bio-value">{student.branch}</p></div>
                </div>
                <div className="sp-bio-col">
                  <div className="sp-bio-item"><p className="sp-bio-label">MHT-CET ID</p><p className="sp-bio-value">{student.mhcetId || '—'}</p></div>
                  <div className="sp-bio-item"><p className="sp-bio-label">Batch</p><p className="sp-bio-value">{student.batch ?? '—'}</p></div>
                  <div className="sp-bio-item"><p className="sp-bio-label">Status</p><p className="sp-bio-value">{student.status?.toUpperCase()}</p></div>
                  <div className="sp-bio-item"><p className="sp-bio-label">Role</p><p className="sp-bio-value">{student.role?.toUpperCase()}</p></div>
                </div>
              </div>
            </div>

            <div className="sp-kpi-col">
              <div className="sp-kpi-card sp-kpi--primary">
                <span className="material-symbols-outlined sp-kpi-icon">trending_up</span>
                <p className="sp-kpi-label">Average Percentile</p>
                <h4 className="sp-kpi-value">92%</h4>
                <div className="sp-kpi-badge"><span className="material-symbols-outlined">arrow_upward</span> 2.1% improvement</div>
              </div>
              <div className="sp-grid-2">
                <div className="sp-card sp-card--stat">
                  <p className="sp-stat-label">Tests Done</p>
                  <p className="sp-stat-value">24<span className="sp-stat-sub">/30</span></p>
                </div>
                <div className="sp-card sp-card--stat">
                  <p className="sp-stat-label">Global Rank</p>
                  <p className="sp-stat-value">#142</p>
                </div>
              </div>
            </div>
          </div>

          {/* Performance Analytics */}
          <div className="sp-grid sp-grid--analytics">
            <div className="sp-card">
              <div className="sp-card-header">
                <h3 className="sp-card-title">Score Trends</h3>
                <div className="sp-tabs">
                  <button className="sp-tab sp-tab--active">Monthly</button>
                  <button className="sp-tab">Weekly</button>
                </div>
              </div>
              <div className="sp-bars">
                {[40, 55, 45, 85, 70, 95, 80].map((h, i) => (
                  <div key={i} className={`sp-bar ${i === 3 ? 'sp-bar--primary' : ''}`} style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
            <div className="sp-card">
              <h3 className="sp-card-title">Subject-wise Proficiency</h3>
              <div className="sp-progress-list">
                <div className="sp-progress-item">
                  <div className="sp-progress-header"><span>Physics</span><span className="sp-progress-pct sp-progress-pct--primary">92%</span></div>
                  <div className="sp-progress-track"><div className="sp-progress-fill sp-progress-fill--primary" style={{ width: '92%' }} /></div>
                </div>
                <div className="sp-progress-item">
                  <div className="sp-progress-header"><span>Mathematics</span><span className="sp-progress-pct sp-progress-pct--secondary">98%</span></div>
                  <div className="sp-progress-track"><div className="sp-progress-fill sp-progress-fill--secondary" style={{ width: '98%' }} /></div>
                </div>
                <div className="sp-progress-item">
                  <div className="sp-progress-header"><span>Chemistry</span><span className="sp-progress-pct sp-progress-pct--tertiary">78%</span></div>
                  <div className="sp-progress-track"><div className="sp-progress-fill sp-progress-fill--tertiary" style={{ width: '78%' }} /></div>
                </div>
                <div className="sp-stats-2">
                  <div className="sp-stat-box"><p className="sp-stat-box-label">Accuracy</p><p className="sp-stat-box-value">94.5%</p></div>
                  <div className="sp-stat-box"><p className="sp-stat-box-label">Time/Ques</p><p className="sp-stat-box-value">42s</p></div>
                </div>
              </div>
            </div>
          </div>

          {/* Test History */}
          <div className="sp-card sp-card--table">
            <div className="sp-card-header">
              <h3 className="sp-card-title">Comprehensive Test History</h3>
              <div className="sp-table-actions">
                <select className="sp-select"><option>All Subjects</option><option>Physics</option><option>Maths</option></select>
                <button className="sp-link">View Full Archive</button>
              </div>
            </div>
            <table className="sp-table">
              <thead>
                <tr>
                  <th>Test Name / ID</th>
                  <th>Date</th>
                  <th>Score</th>
                  <th>Global Rank</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><p className="sp-td-bold">MHT-CET Full Mock #24</p><p className="sp-td-sub">ID: TEST-9942</p></td>
                  <td><p className="sp-td">Mar 12, 2024</p></td>
                  <td><p className="sp-td-bold">192/200</p><p className="sp-td-top">Top 1%</p></td>
                  <td><p className="sp-td-bold">#42</p></td>
                  <td><span className="sp-chip sp-chip--green">Passed</span></td>
                  <td className="text-right">
                    <div className="sp-action-group">
                      <button className="sp-icon-btn"><span className="material-symbols-outlined">visibility</span></button>
                      <button className="sp-icon-btn"><span className="material-symbols-outlined">download</span></button>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td><p className="sp-td-bold">Advanced Calculus Quiz</p><p className="sp-td-sub">ID: TEST-9812</p></td>
                  <td><p className="sp-td">Mar 08, 2024</p></td>
                  <td><p className="sp-td-bold">48/50</p><p className="sp-td-top">Top 5%</p></td>
                  <td><p className="sp-td-bold">#88</p></td>
                  <td><span className="sp-chip sp-chip--green">Passed</span></td>
                  <td className="text-right">
                    <div className="sp-action-group">
                      <button className="sp-icon-btn"><span className="material-symbols-outlined">visibility</span></button>
                      <button className="sp-icon-btn"><span className="material-symbols-outlined">download</span></button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Subject Cards */}
          <div className="sp-grid sp-grid--4">
            <div className="sp-card sp-card--subject">
              <div className="sp-subject-icon sp-subject-icon--blue"><span className="material-symbols-outlined">science</span></div>
              <h4 className="sp-subject-title">Physics</h4>
              <p className="sp-subject-sub">7/10 Modules Completed</p>
              <div className="sp-progress-track"><div className="sp-progress-fill sp-progress-fill--primary" style={{ width: '70%' }} /></div>
              <p className="sp-subject-note">Focus: Mechanics</p>
            </div>
            <div className="sp-card sp-card--subject">
              <div className="sp-subject-icon sp-subject-icon--purple"><span className="material-symbols-outlined">science</span></div>
              <h4 className="sp-subject-title">Chemistry</h4>
              <p className="sp-subject-sub">5/8 Modules Completed</p>
              <div className="sp-progress-track"><div className="sp-progress-fill" style={{ width: '62%', background: '#8B5CF6' }} /></div>
              <p className="sp-subject-note">Focus: Organic</p>
            </div>
            <div className="sp-card sp-card--subject">
              <div className="sp-subject-icon sp-subject-icon--indigo"><span className="material-symbols-outlined">calculate</span></div>
              <h4 className="sp-subject-title">Mathematics</h4>
              <p className="sp-subject-sub">9/10 Modules Completed</p>
              <div className="sp-progress-track"><div className="sp-progress-fill sp-progress-fill--secondary" style={{ width: '90%' }} /></div>
              <p className="sp-subject-note">Strong: Calculus</p>
            </div>
            <div className="sp-card sp-card--subject">
              <div className="sp-subject-icon sp-subject-icon--teal"><span className="material-symbols-outlined">biotech</span></div>
              <h4 className="sp-subject-title">Biology</h4>
              <p className="sp-subject-sub">4/7 Modules Completed</p>
              <div className="sp-progress-track"><div className="sp-progress-fill sp-progress-fill--tertiary" style={{ width: '57%' }} /></div>
              <p className="sp-subject-note">Focus: Genetics</p>
            </div>
          </div>

          {/* Recent Activity & Upcoming Schedule */}
          <div className="sp-grid sp-grid--2-1">
            <div className="sp-card">
              <h3 className="sp-card-title">Recent Activity</h3>
              <div className="sp-timeline">
                <div className="sp-timeline-item">
                  <div className="sp-timeline-dot sp-timeline-dot--primary" />
                  <div>
                    <p className="sp-timeline-title">Physics Mock Test #24</p>
                    <p className="sp-timeline-sub">Completed • 2 hours ago</p>
                  </div>
                </div>
                <div className="sp-timeline-item">
                  <div className="sp-timeline-dot sp-timeline-dot--secondary" />
                  <div>
                    <p className="sp-timeline-title">Downloaded Study Material</p>
                    <p className="sp-timeline-sub">Mathematics Unit 4 • 6 hours ago</p>
                  </div>
                </div>
                <div className="sp-timeline-item">
                  <div className="sp-timeline-dot sp-timeline-dot--tertiary" />
                  <div>
                    <p className="sp-timeline-title">Profile Verified</p>
                    <p className="sp-timeline-sub">Admin: Rajesh Kumar • Yesterday</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="sp-card">
              <h3 className="sp-card-title">Upcoming Schedule</h3>
              <div className="sp-schedule">
                <div className="sp-schedule-item">
                  <div className="sp-schedule-date"><p className="sp-schedule-month">MAR</p><p className="sp-schedule-day">24</p></div>
                  <div className="sp-schedule-body">
                    <p className="sp-schedule-title">Grand Mock Test #05</p>
                    <p className="sp-schedule-sub">09:00 AM - 12:00 PM</p>
                    <div className="sp-live-badge"><span className="sp-live-dot" />Starts in 12h 4m</div>
                  </div>
                </div>
                <div className="sp-schedule-item">
                  <div className="sp-schedule-date"><p className="sp-schedule-month">MAR</p><p className="sp-schedule-day">26</p></div>
                  <div className="sp-schedule-body">
                    <p className="sp-schedule-title">Counseling Session</p>
                    <p className="sp-schedule-sub">Online via MS Teams</p>
                    <div className="sp-chip sp-chip--secondary">2 Days Left</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Certificates & Badges */}
          <div className="sp-grid sp-grid--2">
            <div className="sp-card">
              <h3 className="sp-card-title">Earned Certificates</h3>
              <div className="sp-grid-2">
                <div className="sp-cert">
                  <div className="sp-cert-icon"><span className="material-symbols-outlined">workspace_premium</span></div>
                  <div><p className="sp-cert-title">Physics Mastery</p><p className="sp-cert-sub">Issued: Feb 2024</p></div>
                  <button className="sp-link">PDF</button>
                </div>
                <div className="sp-cert">
                  <div className="sp-cert-icon"><span className="material-symbols-outlined">workspace_premium</span></div>
                  <div><p className="sp-cert-title">Top Performer #24</p><p className="sp-cert-sub">Issued: Jan 2024</p></div>
                  <button className="sp-link">PDF</button>
                </div>
              </div>
            </div>
            <div className="sp-card">
              <h3 className="sp-card-title">Gamified Badges</h3>
              <div className="sp-badges-row">
                <div className="sp-badge-circle sp-badge-circle--gradient1"><span className="material-symbols-outlined">bolt</span><span className="sp-badge-tip">Fast Solver</span></div>
                <div className="sp-badge-circle sp-badge-circle--gradient2"><span className="material-symbols-outlined">military_tech</span><span className="sp-badge-tip">Top 1% Club</span></div>
                <div className="sp-badge-circle sp-badge-circle--gradient3"><span className="material-symbols-outlined">calendar_month</span><span className="sp-badge-tip">30 Day Streak</span></div>
                <div className="sp-badge-circle sp-badge-circle--locked"><span className="material-symbols-outlined">lock</span></div>
              </div>
            </div>
          </div>

          {/* Login Audit & Documents */}
          <div className="sp-grid sp-grid--2">
            <div className="sp-card">
              <h3 className="sp-card-title">Login Audit Logs</h3>
              <div className="sp-log-list">
                <div className="sp-log-item"><span className="material-symbols-outlined">desktop_windows</span><div><p className="sp-log-title">Windows Chrome • 192.168.1.4</p><p className="sp-log-sub">Mumbai, India</p></div><span className="sp-log-time">Mar 14, 10:42 AM</span></div>
                <div className="sp-log-item"><span className="material-symbols-outlined">smartphone</span><div><p className="sp-log-title">iPhone 15 • 49.36.12.11</p><p className="sp-log-sub">Pune, India</p></div><span className="sp-log-time">Mar 13, 08:15 PM</span></div>
              </div>
            </div>
            <div className="sp-card">
              <h3 className="sp-card-title">Document Management</h3>
              <div className="sp-grid-2">
                <div className="sp-upload-box"><span className="material-symbols-outlined">upload_file</span><p className="sp-upload-label">Upload Resume</p></div>
                <div className="sp-doc-box"><div className="sp-doc-icon"><span className="material-symbols-outlined">verified</span></div><div><p className="sp-doc-title">Aadhar Card</p><p className="sp-doc-sub">Verified</p></div></div>
              </div>
            </div>
          </div>

          {/* Admin Remarks + AI Insights */}
          <div className="sp-grid sp-grid--7-5">
            <div className="sp-card">
              <div className="sp-card-header">
                <h3 className="sp-card-title">Admin Remarks</h3>
                <button className="sp-link"><span className="material-symbols-outlined">save</span> Auto-saved</button>
              </div>
              <div className="sp-remark-box">Student is showing exceptional growth in Mathematical reasoning but needs to focus on Chemistry nomenclature. Advised her to attend the special doubt session on March 26th. - Prof. Verma, HOD Mech.</div>
            </div>
            <div className="sp-card sp-card--ai">
              <div className="sp-card-header">
                <div className="sp-ai-header"><div className="sp-ai-icon"><span className="material-symbols-outlined">psychology</span></div><h3 className="sp-card-title">AI Performance Insights</h3></div>
              </div>
              <div className="sp-ai-content">
                <div className="sp-ai-item"><p className="sp-ai-label">Observation</p><p className="sp-ai-text">Ananya tends to spend 40% more time on Physics questions than necessary. Recommend Speed-Mock drills.</p></div>
                <div className="sp-ai-item"><p className="sp-ai-label">Next Step Recommendation</p><p className="sp-ai-text">Assign "Advanced Fluid Dynamics" module. Predictive score suggests 99th percentile readiness.</p></div>
              </div>
            </div>
          </div>
        </div>

        {/* Sticky Footer */}
        <footer className="sp-footer">
          <div className="sp-footer-left">
            <div className="sp-status-badge"><span className="sp-status-dot" /> <span>Active Status</span></div>
            <div className="sp-sep" />
            <span className="sp-footer-text">Last updated: <strong>Today, 02:14 PM</strong></span>
          </div>
          <div className="sp-footer-actions">
            <button className="sp-footer-btn sp-footer-btn--danger"><span className="material-symbols-outlined">delete</span></button>
            <button className="sp-footer-btn">Reset Password</button>
            <button className="sp-footer-btn">Assign New Test</button>
            <button className="sp-footer-btn sp-footer-btn--primary"><span className="material-symbols-outlined">email</span> Email Performance Result</button>
          </div>
        </footer>
      </main>
    </div>
  )
}