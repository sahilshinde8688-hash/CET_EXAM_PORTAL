import { useEffect, useMemo, useState } from 'react'
import {
  clearAdminCredentials,
  DEFAULT_ADMIN_CREDENTIALS,
  getStoredAdminCredentials,
  saveAdminCredentials,
} from '../adminAuth'

interface AdminPanelProps {
  onLogout?: () => void
}

export default function AdminPanel({ onLogout }: AdminPanelProps) {
  const stored = useMemo(() => getStoredAdminCredentials(), [])
  const [email, setEmail] = useState(stored?.email ?? DEFAULT_ADMIN_CREDENTIALS.email)
  const [password, setPassword] = useState(stored?.password ?? DEFAULT_ADMIN_CREDENTIALS.password)
  const [status, setStatus] = useState('Ready to manage the portal')

  useEffect(() => {
    if (stored) {
      setStatus(`Last login: ${stored.lastLogin}`)
    }
  }, [stored])

  const handleSave = () => {
    saveAdminCredentials({
      email,
      password,
      lastLogin: new Date().toLocaleString(),
    })
    setStatus('Admin credentials saved locally')
  }

  const handleReset = () => {
    setEmail(DEFAULT_ADMIN_CREDENTIALS.email)
    setPassword(DEFAULT_ADMIN_CREDENTIALS.password)
    clearAdminCredentials()
    setStatus('Default credentials restored')
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a, #1d4ed8)', color: 'white', padding: 24 }}>
      <div style={{ maxWidth: 840, margin: '0 auto', background: 'rgba(15,23,42,0.78)', borderRadius: 24, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.24)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div>
            <p style={{ margin: 0, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '0.24em', fontSize: 12 }}>Admin Panel</p>
            <h1 style={{ margin: '6px 0 0', fontSize: 28 }}>CET Prep Pro Control Center</h1>
          </div>
          <button onClick={onLogout} style={{ padding: '10px 14px', borderRadius: 999, border: 'none', background: '#ef4444', color: 'white', cursor: 'pointer' }}>
            Logout
          </button>
        </div>

        <p style={{ marginBottom: 20, color: '#dbeafe' }}>{status}</p>

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div style={{ background: 'rgba(255,255,255,0.08)', padding: 16, borderRadius: 16 }}>
            <h3 style={{ marginTop: 0 }}>Login Settings</h3>
            <label style={{ display: 'block', marginBottom: 8 }}>Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 10, border: '1px solid #64748b', marginBottom: 10 }} />
            <label style={{ display: 'block', marginBottom: 8 }}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 10, border: '1px solid #64748b' }} />
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button onClick={handleSave} style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: 'none', background: '#22c55e', color: 'white', cursor: 'pointer' }}>Save</button>
              <button onClick={handleReset} style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1px solid #f8fafc', background: 'transparent', color: 'white', cursor: 'pointer' }}>Reset</button>
            </div>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.08)', padding: 16, borderRadius: 16 }}>
            <h3 style={{ marginTop: 0 }}>Portal Snapshot</h3>
            <ul style={{ paddingLeft: 18, lineHeight: 1.7 }}>
              <li>Students: 1,248</li>
              <li>Mock tests: 42</li>
              <li>Reports generated: 3,560</li>
              <li>Support requests: 17</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
