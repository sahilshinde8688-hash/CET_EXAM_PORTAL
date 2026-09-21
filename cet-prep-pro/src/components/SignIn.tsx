import { useState } from 'react'
import { authAPI, usersAPI, session } from '../lib/api'

type Tab = 'login' | 'register'
type SubmitState = 'idle' | 'loading' | 'success' | 'error' | 'pending'

interface Props {
  onSuccess?: () => void
  onAdminLogin?: (email: string, password: string) => void
}

export default function SignIn({ onSuccess, onAdminLogin }: Props) {
  const [activeTab, setActiveTab]       = useState<Tab>('login')
  const [submitState, setSubmitState]   = useState<SubmitState>('idle')
  const [errorMsg, setErrorMsg]         = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [email, setEmail]               = useState('')
  const [password, setPassword]         = useState('')
  const [remember, setRemember]         = useState(false)
  const [name, setName]                 = useState('')
  const [regEmail, setRegEmail]         = useState('')
  const [regPhone, setRegPhone]         = useState('')
  const [branch, setBranch]             = useState('')
  const [batch, setBatch]               = useState('')
  const [mustResetPassword, setMustResetPassword] = useState(false)
  const [resetPassword, setResetPassword] = useState('')
  const [resetConfirm, setResetConfirm] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitState('loading')
    setErrorMsg('')

    try {
      if (mustResetPassword) {
        if (!resetPassword || resetPassword.length < 6)
          return setErrorMsg('Password must be at least 6 characters')
        if (resetPassword !== resetConfirm)
          return setErrorMsg('Passwords do not match')

        const existing = session.get()
        if (!existing) return setErrorMsg('Session expired. Please login again.')

        await usersAPI.resetPassword(resetPassword)
        const updated = await usersAPI.me()
        session.save(updated)
        setSubmitState('success')
        setTimeout(() => onSuccess?.(), 700)
        return
      }

      if (activeTab === 'login') {
        const user = await authAPI.login(email.trim().toLowerCase(), password, remember)
        session.save(user)

        if (user.mustResetPassword) {
          setMustResetPassword(true)
          setSubmitState('idle')
          return
        }

        setSubmitState('success')
        setTimeout(() => {
          if (user.role === 'admin') onAdminLogin?.(email, password)
          else onSuccess?.()
        }, 700)
      } else {
        await authAPI.register(name.trim(), regEmail.trim().toLowerCase(), regPhone.trim(), branch, batch)
        setSubmitState('pending')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong'
      setErrorMsg(msg)
      setSubmitState('error')
      setTimeout(() => setSubmitState('idle'), 4000)
    }
  }

  const switchTab = (tab: Tab) => {
    setActiveTab(tab)
    setSubmitState('idle')
    setShowPassword(false)
    setErrorMsg('')
    setMustResetPassword(false)
    setResetPassword('')
    setResetConfirm('')
  }

  return (
    <>
    <div className="page">
      <section className="left-panel">
        <div className="dot-pattern" />
        <div className="form-wrapper">

          <h1 className="brand-title">CET Prep Pro</h1>
          <p className="brand-subtitle">Elevate your future with precision learning.</p>

          <div className="tabs">
            <button className={`tab-btn${activeTab === 'login' ? ' active' : ''}`} onClick={() => switchTab('login')}>Sign In</button>
            <button className={`tab-btn${activeTab === 'register' ? ' active' : ''}`} onClick={() => switchTab('register')}>Create Account</button>
          </div>

          {/* ── LOGIN FORM ── */}
          {activeTab === 'login' && !mustResetPassword && (
            <form className="auth-form" onSubmit={handleSubmit}>
              <button type="button" className="google-btn">
                <svg viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </button>

              <div className="divider"><div className="divider-line" /><span className="divider-text">OR</span><div className="divider-line" /></div>

              <div className="input-group">
                <label className="input-label" htmlFor="email">Email / User ID</label>
                <input id="email" type="text" className="text-input" placeholder="name@university.edu or admin ID"
                  required value={email} onChange={e => setEmail(e.target.value)} />
              </div>

              <div className="input-group">
                <div className="input-row">
                  <label className="input-label" htmlFor="password">Password</label>
                  <a href="#" className="forgot-link">Forgot password?</a>
                </div>
                <div className="password-wrapper">
                  <input id="password" type={showPassword ? 'text' : 'password'} className="text-input"
                    placeholder="••••••••" required value={password} onChange={e => setPassword(e.target.value)} />
                  <button type="button" className="toggle-pass" onClick={() => setShowPassword(v => !v)}>
                    <span className="material-symbols-outlined">{showPassword ? 'visibility_off' : 'visibility'}</span>
                  </button>
                </div>
              </div>

              <div className="remember-row">
                <input id="remember" type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
                <label htmlFor="remember">Remember me for 30 days</label>
              </div>

              {submitState === 'error' && (
                <div className="signin-error-msg">
                  <span className="material-symbols-outlined">error</span>
                  {errorMsg}
                </div>
              )}

              <button type="submit" disabled={submitState === 'loading' || submitState === 'success'}
                className={`submit-btn${submitState === 'success' ? ' success' : ''}`}>
                {submitState === 'loading' && <div className="submit-btn-inner"><div className="spinner" />Authenticating…</div>}
                {submitState === 'success' && <div className="submit-btn-inner"><span className="material-symbols-outlined">check_circle</span>Welcome Back!</div>}
                {(submitState === 'idle' || submitState === 'error') && 'Sign In to Dashboard'}
              </button>
            </form>
          )}

          {/* ── RESET PASSWORD FORM ── */}
          {mustResetPassword && (
            <form className="auth-form" onSubmit={handleSubmit}>
              <div className="reset-banner">
                <span className="material-symbols-outlined">lock_reset</span>
                <div>
                  <h3 className="reset-title">First Login — Reset Password</h3>
                  <p className="reset-sub">You are using your provisional MHT-CET credentials. Please create a new password to continue.</p>
                </div>
              </div>

              <div className="input-group">
                <label className="input-label" htmlFor="reset-password">New Password</label>
                <div className="password-wrapper">
                  <input id="reset-password" type={showPassword ? 'text' : 'password'} className="text-input"
                    placeholder="Enter new password" required value={resetPassword} onChange={e => setResetPassword(e.target.value)} />
                  <button type="button" className="toggle-pass" onClick={() => setShowPassword(v => !v)}>
                    <span className="material-symbols-outlined">{showPassword ? 'visibility_off' : 'visibility'}</span>
                  </button>
                </div>
              </div>

              <div className="input-group">
                <label className="input-label" htmlFor="reset-confirm">Confirm New Password</label>
                <div className="password-wrapper">
                  <input id="reset-confirm" type={showPassword ? 'text' : 'password'} className="text-input"
                    placeholder="Re-enter new password" required value={resetConfirm} onChange={e => setResetConfirm(e.target.value)} />
                </div>
              </div>

              {submitState === 'error' && (
                <div className="signin-error-msg">
                  <span className="material-symbols-outlined">error</span>
                  {errorMsg}
                </div>
              )}

              <button type="submit" disabled={submitState === 'loading' || submitState === 'success'}
                className={`submit-btn${submitState === 'success' ? ' success' : ''}`}>
                {submitState === 'loading' && <div className="submit-btn-inner"><div className="spinner" />Updating Password…</div>}
                {submitState === 'success' && <div className="submit-btn-inner"><span className="material-symbols-outlined">check_circle</span>Password Updated!</div>}
                {(submitState === 'idle' || submitState === 'error') && 'Reset Password'}
              </button>
            </form>
          )}

          {/* ── REGISTER FORM ── */}
          {activeTab === 'register' && submitState !== 'pending' && !mustResetPassword && (
            <form className="auth-form" onSubmit={handleSubmit}>
              <button type="button" className="google-btn">
                <svg viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </button>

              <div className="divider"><div className="divider-line" /><span className="divider-text">OR</span><div className="divider-line" /></div>

              <div className="input-group">
                <label className="input-label" htmlFor="reg-name">Full Name</label>
                <input id="reg-name" type="text" className="text-input" placeholder="e.g. Rahul Sharma"
                  required value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div className="input-group">
                <label className="input-label" htmlFor="reg-email">Email Address</label>
                <input id="reg-email" type="email" className="text-input" placeholder="name@university.edu"
                  required value={regEmail} onChange={e => setRegEmail(e.target.value)} />
              </div>
              <div className="input-group">
                <label className="input-label" htmlFor="reg-phone">Phone Number</label>
                <input id="reg-phone" type="tel" className="text-input" placeholder="e.g. 9876543210"
                  required value={regPhone} onChange={e => setRegPhone(e.target.value)} />
              </div>
              <div className="input-group">
                <label className="input-label" htmlFor="branch">Choose Your Branch</label>
                <div className="select-wrapper">
                  <select id="branch" className="text-input select-input" required value={branch} onChange={e => setBranch(e.target.value)}>
                    <option value="" disabled>Select a branch</option>
                    <option value="Byculla">Byculla</option>
                    <option value="Worli">Worli</option>
                    <option value="Prabhadevi">Prabhadevi</option>
                  </select>
                  <span className="select-arrow material-symbols-outlined">expand_more</span>
                </div>
              </div>
              <div className="input-group">
                <label className="input-label" htmlFor="batch">Batch</label>
                <div className="select-wrapper">
                  <select id="batch" className="text-input select-input" required value={batch} onChange={e => setBatch(e.target.value)}>
                    <option value="" disabled>Select batch</option>
                    <option value="1">Batch 1</option>
                    <option value="2">Batch 2</option>
                  </select>
                  <span className="select-arrow material-symbols-outlined">expand_more</span>
                </div>
              </div>

              {submitState === 'error' && (
                <div className="signin-error-msg">
                  <span className="material-symbols-outlined">error</span>
                  {errorMsg}
                </div>
              )}

              <button type="submit" disabled={submitState === 'loading'} className="submit-btn">
                {submitState === 'loading' && <div className="submit-btn-inner"><div className="spinner" />Creating Account…</div>}
                {(submitState === 'idle' || submitState === 'error') && 'Create Student Account'}
              </button>
            </form>
          )}

          {/* ── PENDING SUCCESS MESSAGE ── */}
          {activeTab === 'register' && submitState === 'pending' && (
            <div className="pending-success-card">
              <div className="pending-icon-wrap">
                <span className="material-symbols-outlined pending-icon">schedule</span>
              </div>
              <h3 className="pending-title">Registration Submitted!</h3>
              <p className="pending-msg">
                Your account is currently <strong>under review</strong> by the admin team.
                Once approved, you'll receive your <strong>MHT-CET ID</strong> and
                <strong> password</strong> on your registered email address.
              </p>
              <div className="pending-email-chip">
                <span className="material-symbols-outlined">mail</span>
                <span>{regEmail}</span>
              </div>
              <button className="pending-back-btn" onClick={() => switchTab('login')}>
                Back to Sign In
              </button>
            </div>
          )}

          <p className="form-footer">
            {activeTab === 'login'
              ? <><span>Don't have an account? </span><button onClick={() => switchTab('register')}>Register for free</button></>
              : submitState !== 'pending' && !mustResetPassword
                ? <><span>Already have an account? </span><button onClick={() => switchTab('login')}>Sign in</button></>
                : null
            }
          </p>
        </div>
      </section>

      <section className="right-panel">
        <div className="blob blob-1" />
        <div className="blob blob-2" />
        <div className="glass-card">
          <div className="card-img-wrap">
            <img src="https://lh3.googleusercontent.com/aida-public/AB6AXuC4wtIQEFwNv0Zga43ltFQ4ziyogZnPPPFcrDHGr7tSjwgPumXKSO_ZQ02ZroEXxTL52kGTG_fzgOFywvZmrqmaOyug6QU2X6mJ3h7KOhqnEtp5JURLabLYdcSEkTupQhweDLa7ZhiM2WgcCVslWBq5pSrL3oTw8-eU-0sblkK-WbqOYsdbOjgPcSRYRkQzGGekAKLQ0dEieDTbECKMTGCoy4UNkIKR6pBuxIGtzHbb3B3g9lQ8rcgtjkwi7GeFMVIIMlVaRILEHfY" alt="Student illustration" />
          </div>
          <h2 className="card-title">Unlock Your Potential</h2>
          <p className="card-desc">Join 50,000+ students mastering the MHT-CET with real-time analytics and predictive mock tests.</p>
          <div className="stats-grid">
            <div className="stat-card">
              <span className="material-symbols-outlined stat-icon">insights</span>
              <p className="stat-number">98%</p>
              <p className="stat-label">Success Rate</p>
            </div>
            <div className="stat-card">
              <span className="material-symbols-outlined stat-icon">menu_book</span>
              <p className="stat-number">12k+</p>
              <p className="stat-label">Mock Questions</p>
            </div>
          </div>
        </div>
      </section>
    </div>
    </>
  )
}