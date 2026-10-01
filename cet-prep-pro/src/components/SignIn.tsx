import { useState } from 'react'
import { authAPI, usersAPI, session, type AuthUser } from '../lib/api'
import '../signin.css'

type Tab = 'login' | 'register'
type SubmitState = 'idle' | 'loading' | 'success' | 'error' | 'pending'

interface Props {
  onSuccess?: (user: AuthUser) => void
}

export default function SignIn({ onSuccess }: Props) {
  const [activeTab, setActiveTab]             = useState<Tab>('login')
  const [submitState, setSubmitState]         = useState<SubmitState>('idle')
  const [errorMsg, setErrorMsg]               = useState('')
  const [showPassword, setShowPassword]       = useState(false)
  const [email, setEmail]                     = useState('')
  const [password, setPassword]               = useState('')
  const [remember, setRemember]               = useState(false)
  const [showForgotModal, setShowForgotModal] = useState(false)

  // Registration state
  const [name, setName]                       = useState('')
  const [regEmail, setRegEmail]               = useState('')
  const [regPhone, setRegPhone]               = useState('')
  const [branch, setBranch]                   = useState('')
  const [batch, setBatch]                     = useState('')

  // Mandatory first-login password reset
  const [mustResetPassword, setMustResetPassword] = useState(false)
  const [resetPassword, setResetPassword]         = useState('')
  const [resetConfirm, setResetConfirm]           = useState('')

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
        setTimeout(() => onSuccess?.(updated), 700)
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
        setTimeout(() => onSuccess?.(user), 700)
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
    <div className="signin-page-root">
      {/* Background Matrix & Dynamic Lights */}
      <div className="signin-bg-grid" />
      <div className="signin-floating-orb orb-primary" />
      <div className="signin-floating-orb orb-secondary" />
      <div className="signin-floating-orb orb-tertiary" />

      {/* Main Glass Shell */}
      <main className="signin-glass-shell">
        
        {/* ── AUTHENTICATION PANEL ── */}
        <section className="signin-left-console">
          <div className="signin-account-prompt">
            <span>{activeTab === 'login' ? "Don't have an account?" : 'Already have an account?'}</span>
            <button
              type="button"
              onClick={() => switchTab(activeTab === 'login' ? 'register' : 'login')}
            >
              {activeTab === 'login' ? 'Sign Up' : 'Sign In'}
            </button>
          </div>
          <div className="signin-form-wrapper">

            {/* Brand Header */}
            <div className="signin-brand-lockup">
              <span className="material-symbols-outlined signin-brand-cap" aria-hidden="true">school</span>
              <h1 className="signin-brand-title">CET<span>Nova</span></h1>
              <span className="signin-brand-caption">CET EXAM PORTAL</span>
            </div>
            <h2 className="signin-card-heading">{mustResetPassword ? 'Set a New Password' : activeTab === 'login' ? 'Sign In' : 'Create Account'}</h2>
            <p className="signin-card-subtitle">
              {mustResetPassword ? 'Choose a new password to secure your account.' : activeTab === 'login' ? 'Welcome back! Continue your CET journey.' : 'Join CET Nova and start preparing for your exam.'}
            </p>

            {/* ── 1. LOGIN FORM ── */}
            {activeTab === 'login' && !mustResetPassword && (
              <form className="signin-form-fields" onSubmit={handleSubmit}>
                
                {/* Email / User ID Input */}
                <div className="signin-field-group">
                  <label className="signin-field-label" htmlFor="auth-email">
                    Email address or Student ID
                  </label>
                  <div className="signin-input-box">
                    <span className="material-symbols-outlined signin-input-leading-icon">mail</span>
                    <input
                      id="auth-email"
                      type="text"
                      className="signin-native-input"
                      placeholder="Email address"
                      required
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      autoComplete="username"
                    />
                  </div>
                </div>

                {/* Password Input */}
                <div className="signin-field-group">
                  <label className="signin-field-label signin-password-label" htmlFor="auth-password">Password</label>
                  <div className="signin-input-box has-trailing-btn">
                    <span className="material-symbols-outlined signin-input-leading-icon">lock</span>
                    <input
                      id="auth-password"
                      type={showPassword ? 'text' : 'password'}
                      className="signin-native-input"
                      placeholder="••••••••••••"
                      required
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="signin-trailing-action-btn"
                      onClick={() => setShowPassword(v => !v)}
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      <span className="material-symbols-outlined">
                        {showPassword ? 'visibility_off' : 'visibility'}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Options Row (Remember Me) */}
                <div className="signin-options-row">
                  <label className="signin-checkbox-label" onClick={() => setRemember(r => !r)}>
                    <div className={`signin-custom-checkbox${remember ? ' checked' : ''}`}>
                      {remember && <span className="material-symbols-outlined">check</span>}
                    </div>
                    <span>Remember me</span>
                  </label>
                  <button
                    type="button"
                    className="signin-forgot-btn"
                    onClick={() => setShowForgotModal(true)}
                  >
                    Forgot password?
                  </button>
                </div>

                {/* Error Banner */}
                {submitState === 'error' && (
                  <div className="signin-alert-banner">
                    <span className="material-symbols-outlined">error</span>
                    <span>{errorMsg}</span>
                  </div>
                )}

                {/* Submit Action */}
                <button
                  type="submit"
                  disabled={submitState === 'loading' || submitState === 'success'}
                  className={`signin-action-btn${submitState === 'success' ? ' success-state' : ''}`}
                >
                  {submitState === 'loading' && (
                    <>
                      <div className="signin-btn-spinner" />
                      <span>Authenticating…</span>
                    </>
                  )}
                  {submitState === 'success' && (
                    <>
                      <span className="material-symbols-outlined">check_circle</span>
                      <span>Access Granted! Redirecting…</span>
                    </>
                  )}
                  {(submitState === 'idle' || submitState === 'error') && (
                    <>
                      <span>Sign In</span>
                      <span className="material-symbols-outlined">arrow_forward</span>
                    </>
                  )}
                </button>

                <div className="signin-divider-wrap">
                  <div className="signin-divider-line" />
                  <span className="signin-divider-text">OR CONTINUE WITH</span>
                  <div className="signin-divider-line" />
                </div>

                <div className="signin-social-row">
                  <button type="button" className="signin-google-btn">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    <span>Continue with Google</span>
                  </button>
                  <button type="button" className="signin-google-btn signin-microsoft-btn">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path fill="#f25022" d="M1 1h10v10H1z"/><path fill="#7fba00" d="M13 1h10v10H13z"/>
                      <path fill="#00a4ef" d="M1 13h10v10H1z"/><path fill="#ffb900" d="M13 13h10v10H13z"/>
                    </svg>
                    <span>Continue with Microsoft</span>
                  </button>
                </div>

                <div className="signin-trust-row">
                  <div><span className="material-symbols-outlined">verified_user</span><p><strong>Secure Login</strong><small>Your data is safe</small></p></div>
                  <div><span className="material-symbols-outlined">bolt</span><p><strong>Fast Access</strong><small>Start learning instantly</small></p></div>
                  <div><span className="material-symbols-outlined">devices</span><p><strong>Access Anywhere</strong><small>On web & mobile</small></p></div>
                </div>
              </form>
            )}

            {/* ── 2. MANDATORY PASSWORD RESET FORM ── */}
            {mustResetPassword && (
              <form className="signin-form-fields" onSubmit={handleSubmit}>
                <div className="signin-reset-notice-card">
                  <span className="material-symbols-outlined">lock_reset</span>
                  <div>
                    <h4>Initial Setup Required</h4>
                    <p>You have logged in using temporary credentials. Please establish a secure personal password.</p>
                  </div>
                </div>

                <div className="signin-field-group">
                  <label className="signin-field-label" htmlFor="reset-pwd">New Password</label>
                  <div className="signin-input-box has-trailing-btn">
                    <span className="material-symbols-outlined signin-input-leading-icon">key</span>
                    <input
                      id="reset-pwd"
                      type={showPassword ? 'text' : 'password'}
                      className="signin-native-input"
                      placeholder="Minimum 6 characters"
                      required
                      value={resetPassword}
                      onChange={e => setResetPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="signin-trailing-action-btn"
                      onClick={() => setShowPassword(v => !v)}
                    >
                      <span className="material-symbols-outlined">{showPassword ? 'visibility_off' : 'visibility'}</span>
                    </button>
                  </div>
                </div>

                <div className="signin-field-group">
                  <label className="signin-field-label" htmlFor="reset-pwd-conf">Confirm New Password</label>
                  <div className="signin-input-box">
                    <span className="material-symbols-outlined signin-input-leading-icon">check</span>
                    <input
                      id="reset-pwd-conf"
                      type={showPassword ? 'text' : 'password'}
                      className="signin-native-input"
                      placeholder="Repeat password"
                      required
                      value={resetConfirm}
                      onChange={e => setResetConfirm(e.target.value)}
                    />
                  </div>
                </div>

                {submitState === 'error' && (
                  <div className="signin-alert-banner">
                    <span className="material-symbols-outlined">error</span>
                    <span>{errorMsg}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitState === 'loading' || submitState === 'success'}
                  className={`signin-action-btn${submitState === 'success' ? ' success-state' : ''}`}
                >
                  {submitState === 'loading' ? (
                    <>
                      <div className="signin-btn-spinner" />
                      <span>Updating Credentials…</span>
                    </>
                  ) : submitState === 'success' ? (
                    <>
                      <span className="material-symbols-outlined">check_circle</span>
                      <span>Password Saved!</span>
                    </>
                  ) : (
                    <>
                      <span>Save & Continue</span>
                      <span className="material-symbols-outlined">arrow_forward</span>
                    </>
                  )}
                </button>
              </form>
            )}

            {/* ── 3. REGISTRATION FORM ── */}
            {activeTab === 'register' && submitState !== 'pending' && !mustResetPassword && (
              <form className="signin-form-fields" onSubmit={handleSubmit}>
                {/* Full Name */}
                <div className="signin-field-group">
                  <label className="signin-field-label" htmlFor="reg-name">Full Student Name</label>
                  <div className="signin-input-box">
                    <span className="material-symbols-outlined signin-input-leading-icon">person</span>
                    <input
                      id="reg-name"
                      type="text"
                      className="signin-native-input"
                      placeholder="e.g. Rahul Sharma"
                      required
                      value={name}
                      onChange={e => setName(e.target.value)}
                    />
                  </div>
                </div>

                {/* Email */}
                <div className="signin-field-group">
                  <label className="signin-field-label" htmlFor="reg-email">Email Address</label>
                  <div className="signin-input-box">
                    <span className="material-symbols-outlined signin-input-leading-icon">mail</span>
                    <input
                      id="reg-email"
                      type="email"
                      className="signin-native-input"
                      placeholder="name@university.edu"
                      required
                      value={regEmail}
                      onChange={e => setRegEmail(e.target.value)}
                    />
                  </div>
                </div>

                {/* Phone */}
                <div className="signin-field-group">
                  <label className="signin-field-label" htmlFor="reg-phone">WhatsApp / Phone Number</label>
                  <div className="signin-input-box">
                    <span className="material-symbols-outlined signin-input-leading-icon">call</span>
                    <input
                      id="reg-phone"
                      type="tel"
                      className="signin-native-input"
                      placeholder="e.g. 9876543210"
                      required
                      value={regPhone}
                      onChange={e => setRegPhone(e.target.value)}
                    />
                  </div>
                </div>

                {/* Branch & Batch Row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 12 }}>
                  <div className="signin-field-group">
                    <label className="signin-field-label" htmlFor="reg-branch">Center Branch</label>
                    <div className="signin-input-box signin-select-wrap">
                      <span className="material-symbols-outlined signin-input-leading-icon">location_on</span>
                      <select
                        id="reg-branch"
                        className="signin-native-select"
                        required
                        value={branch}
                        onChange={e => setBranch(e.target.value)}
                      >
                        <option value="" disabled>Select Center</option>
                        <option value="Byculla">Byculla Campus</option>
                        <option value="Worli">Worli Hub</option>
                        <option value="Prabhadevi">Prabhadevi Branch</option>
                      </select>
                      <span className="material-symbols-outlined signin-select-chevron">expand_more</span>
                    </div>
                  </div>

                  <div className="signin-field-group">
                    <label className="signin-field-label" htmlFor="reg-batch">Batch</label>
                    <div className="signin-input-box signin-select-wrap">
                      <span className="material-symbols-outlined signin-input-leading-icon">groups</span>
                      <select
                        id="reg-batch"
                        className="signin-native-select"
                        required
                        value={batch}
                        onChange={e => setBatch(e.target.value)}
                      >
                        <option value="" disabled>Batch</option>
                        <option value="1">Batch 1 (Morning)</option>
                        <option value="2">Batch 2 (Evening)</option>
                      </select>
                      <span className="material-symbols-outlined signin-select-chevron">expand_more</span>
                    </div>
                  </div>
                </div>

                {submitState === 'error' && (
                  <div className="signin-alert-banner">
                    <span className="material-symbols-outlined">error</span>
                    <span>{errorMsg}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitState === 'loading'}
                  className="signin-action-btn"
                >
                  {submitState === 'loading' ? (
                    <>
                      <div className="signin-btn-spinner" />
                      <span>Submitting Registration…</span>
                    </>
                  ) : (
                    <>
                      <span>Apply for Student Access</span>
                      <span className="material-symbols-outlined">arrow_forward</span>
                    </>
                  )}
                </button>
              </form>
            )}

            {/* ── 4. PENDING REGISTRATION BANNER ── */}
            {activeTab === 'register' && submitState === 'pending' && (
              <div className="signin-pending-card">
                <div className="signin-pending-icon-circle">
                  <span className="material-symbols-outlined">verified_user</span>
                </div>
                <h3 className="signin-pending-title">Registration Transmitted!</h3>
                <p className="signin-pending-description">
                  Your admission request has been logged. Our administration desk verifies center enrollments within 2 to 4 business hours.
                  Your <strong>MHT-CET ID & password</strong> will be dispatched to:
                </p>
                <div className="signin-pending-email-badge">
                  <span className="material-symbols-outlined">outgoing_mail</span>
                  <span>{regEmail}</span>
                </div>
                <button
                  type="button"
                  className="signin-action-btn"
                  onClick={() => switchTab('login')}
                >
                  <span className="material-symbols-outlined">arrow_back</span>
                  <span>Return to Sign In Console</span>
                </button>
              </div>
            )}

            {/* Bottom Navigation Hint */}
              <div className="signin-footer-hint">
              {activeTab === 'login' ? (
                <>
                  <span>New to the CET Nova program? </span>
                  <button type="button" className="signin-footer-hint-btn" onClick={() => switchTab('register')}>
                    Create an account
                  </button>
                </>
              ) : submitState !== 'pending' && !mustResetPassword ? (
                <>
                  <span>Already enrolled with an ID? </span>
                  <button type="button" className="signin-footer-hint-btn" onClick={() => switchTab('login')}>
                    Sign in here
                  </button>
                </>
              ) : null}
            </div>

          </div>
        </section>

        {/* ── PREPARATION SHOWCASE ── */}
        <section className="signin-right-showcase">
          <div className="signin-showcase-grid-overlay" />
          <header className="signin-showcase-brand">
            <span className="material-symbols-outlined">school</span>
            <span>CET<span>Nova</span></span>
            <small>CET EXAM PORTAL</small>
            <nav aria-label="CET Nova sections">
              <a href="#practice">Practice</a><i />
              <a href="#analysis">Analyze</a><i />
              <a href="#improve">Improve</a>
            </nav>
          </header>

          <div className="signin-showcase-header">
            <h2 className="signin-showcase-heading">
              Your Path to a<br /><span className="gradient-text">Brighter Future</span>
            </h2>
            <p className="signin-showcase-description">
              Mock Tests · Previous Year Papers · Detailed Analysis<br />All in one place for your CET Preparation
            </p>
          </div>

          <div className="signin-showcase-footer">
            <div className="signin-feature-grid">
              <div className="signin-feature-card" id="practice">
                <span className="material-symbols-outlined">quiz</span>
                <div><strong>Topic-wise Tests</strong><small>Practice by subject & topic</small></div>
              </div>
              <div className="signin-feature-card" id="analysis">
                <span className="material-symbols-outlined">bar_chart</span>
                <div><strong>Detailed Analysis</strong><small>Track your performance</small></div>
              </div>
              <div className="signin-feature-card">
                <span className="material-symbols-outlined">description</span>
                <div><strong>Previous Year Papers</strong><small>Real exam experience</small></div>
              </div>
              <div className="signin-feature-card" id="improve">
                <span className="material-symbols-outlined">groups</span>
                <div><strong>Personalised Dashboard</strong><small>Plan and improve</small></div>
              </div>
            </div>
            <blockquote className="signin-quote">
              <span aria-hidden="true">“</span>
              <p>Consistent practice today,<br />a brighter tomorrow.</p>
              <cite>— CETNova</cite>
            </blockquote>
          </div>

        </section>
      </main>

      {/* ── FORGOT PASSWORD RECOVERY MODAL ── */}
      {showForgotModal && (
        <div className="signin-modal-backdrop" onClick={() => setShowForgotModal(false)}>
          <div className="signin-modal-card" onClick={e => e.stopPropagation()}>
            <div className="signin-modal-icon-wrap">
              <span className="material-symbols-outlined">help_center</span>
            </div>
            <h3 className="signin-modal-title">Recover CET Credentials</h3>
            <p className="signin-modal-desc">
              Your MHT-CET portal access is tied to your center branch registration.
            </p>
            <div className="signin-modal-steps-box">
              <div><strong>1. Check your email:</strong> Search your inbox for "CET Nova Credentials" with your initial admit letter.</div>
              <div><strong>2. Center Support:</strong> Visit or contact Byculla, Worli, or Prabhadevi desk with your provisional student roll number.</div>
              <div><strong>3. Password Reset:</strong> Once unlocked by center faculty, you'll be prompted to set a new password on your next login.</div>
            </div>
            <button
              type="button"
              className="signin-modal-close-btn"
              onClick={() => setShowForgotModal(false)}
            >
              Understood, return to login
            </button>
          </div>
        </div>
      )}
    </div>
  )
}