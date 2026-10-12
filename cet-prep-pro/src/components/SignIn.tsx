import { useState } from 'react'
import { Lottie } from 'lottie-react'
import { authAPI, usersAPI, session, type AuthUser } from '../lib/api'
import '../signin.css'

type Tab = 'login' | 'register'
type SubmitState = 'idle' | 'loading' | 'success' | 'error' | 'pending'

interface Props {
  onSuccess?: (user: AuthUser) => void
  sessionExpired?: boolean
  sessionExpiredMessage?: string
  sessionCheckError?: string | null
  onRetrySession?: () => void
}

export default function SignIn({
  onSuccess,
  sessionExpired = false,
  sessionExpiredMessage = 'Your session expired because you were inactive. Please sign in again.',
  sessionCheckError,
  onRetrySession,
}: Props) {
  const [activeTab, setActiveTab]             = useState<Tab>('login')
  const [submitState, setSubmitState]         = useState<SubmitState>('idle')
  const [errorMsg, setErrorMsg]               = useState('')
  const [showPassword, setShowPassword]       = useState(false)
  const [email, setEmail]                     = useState('')
  const [password, setPassword]               = useState('')
  const [remember, setRemember]               = useState(false)
  const [showForgotModal, setShowForgotModal] = useState(false)
  const [setupToken, setSetupToken] = useState(() => new URLSearchParams(window.location.search).get('setup_token') || '')
  const [setupComplete, setSetupComplete] = useState(false)

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
    if (submitState === 'loading') return
    setSubmitState('loading')
    setErrorMsg('')

    try {
      if (setupToken) {
        if (resetPassword.length < 8) {
          setErrorMsg('Choose a password with at least 8 characters.')
          setSubmitState('error')
          return
        }
        if (resetPassword !== resetConfirm) {
          setErrorMsg('Passwords do not match')
          setSubmitState('error')
          return
        }
        await authAPI.setupPassword(setupToken, resetPassword)
        window.history.replaceState({}, '', window.location.pathname)
        setSetupToken('')
        setSetupComplete(true)
        setResetPassword('')
        setResetConfirm('')
        setSubmitState('idle')
        return
      }

      if (mustResetPassword) {
        if (!resetPassword || resetPassword.length < 6) {
          setErrorMsg('Password must be at least 6 characters')
          setSubmitState('error')
          return
        }
        if (resetPassword !== resetConfirm) {
          setErrorMsg('Passwords do not match')
          setSubmitState('error')
          return
        }

        const existing = session.get()
        if (!existing) {
          setErrorMsg('Session expired. Please login again.')
          setSubmitState('error')
          return
        }

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
      {/* ── Background Ambient Blobs & Subtle Waves ── */}
      <div className="signin-bg-decorations" aria-hidden="true">
        <div className="signin-blob-left" />
        <div className="signin-blob-center" />
        <div className="signin-blob-right" />
        <svg className="signin-bg-wave-svg" viewBox="0 0 1440 320" fill="none" preserveAspectRatio="none">
          <path
            d="M0,192L48,197.3C96,203,192,213,288,192C384,171,480,117,576,122.7C672,128,768,192,864,208C960,224,1056,192,1152,176C1248,160,1344,160,1392,160L1440,160L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
            fill="#EAF2FC"
            fillOpacity="0.7"
          />
          <path
            d="M0,256L60,240C120,224,240,192,360,197.3C480,203,600,245,720,256C840,267,960,245,1080,224C1200,203,1320,181,1380,170.7L1440,160L1440,320L1380,320C1320,320,1200,320,1080,320C960,320,840,320,720,320C600,320,480,320,360,320C240,320,120,320,60,320L0,320Z"
            fill="#F0F6FD"
            fillOpacity="0.85"
          />
        </svg>
      </div>

      {/* ── Sign-in Header ── */}
      <header className="signin-top-nav">
        <div className="signin-nav-container">
          <button
            type="button"
            className="signin-nav-brand"
            onClick={() => switchTab('login')}
            aria-label="CETNova home"
          >
            <div className="signin-nav-logo-wrap">
              <img className="signin-brand-logo" src="/logo.png" alt="" />
            </div>
            <span className="signin-brand-subtag">CET EXAM PORTAL</span>
          </button>

          {!setupToken && <div className="signin-nav-auth" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              className="btn-phone-qr"
              onClick={() => window.dispatchEvent(new CustomEvent('cet:open-qr'))}
              title="Open CET NOVA on your mobile phone"
            >
              <span className="material-symbols-outlined">qr_code_2</span>
              <span>Open on Phone</span>
            </button>
            <span className="signin-nav-prompt-text">
              {activeTab === 'login' ? "Don't have an account?" : "Already enrolled?"}
            </span>
            <button
              type="button"
              className="signin-nav-signup-btn"
              onClick={() => switchTab(activeTab === 'login' ? 'register' : 'login')}
            >
              {activeTab === 'login' ? 'Sign Up' : 'Sign In'}
            </button>
          </div>}
        </div>
      </header>

      {/* ── Main Two-Column Layout ── */}
      <main className="signin-main-layout">

        {/* ── LEFT HERO SECTION ── */}
        <section className="signin-left-hero">
          {/* Gold Badge */}
          <div className="hero-badge">
            <span className="material-symbols-outlined hero-badge-icon">school</span>
            <span>YOUR CET JOURNEY STARTS HERE</span>
          </div>

          {/* Heading with golden accent swoosh */}
          <h1 className="hero-heading">
            Prepare with<br />
            <span className="hero-purpose-text">
              purpose.
              <svg className="hero-swoosh" viewBox="0 0 200 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 11C45 3 145 3 196 9C145 15 55 14 4 11Z" fill="#D99A16"/>
              </svg>
            </span>
          </h1>

          <p className="hero-description">
            Practice focused questions, track your progress, and build confidence for exam day.
          </p>

          {/* Body Content: 3 Feature Rows + Integrated Floating Illustration */}
          <div className="hero-body-content">
            <div className="hero-features-list">
              <div className="hero-feature-card">
                <div className="feature-icon-box box-blue">
                  <span className="material-symbols-outlined">menu_book</span>
                </div>
                <div className="feature-info">
                  <h3 className="feature-title">Focused Practice</h3>
                  <p className="feature-subtitle">Topic-wise and full mock tests</p>
                </div>
              </div>

              <div className="hero-feature-card">
                <div className="feature-icon-box box-amber">
                  <span className="material-symbols-outlined">bar_chart</span>
                </div>
                <div className="feature-info">
                  <h3 className="feature-title">Track Progress</h3>
                  <p className="feature-subtitle">Detailed analysis and performance insights</p>
                </div>
              </div>

              <div className="hero-feature-card">
                <div className="feature-icon-box box-cyan">
                  <span className="material-symbols-outlined">trending_up</span>
                </div>
                <div className="feature-info">
                  <h3 className="feature-title">Improve with Analytics</h3>
                  <p className="feature-subtitle">Identify strengths and work on weaknesses</p>
                </div>
              </div>
            </div>

            <div className="hero-illustration-wrap">
              <div className="illustration-organic-backdrop" aria-hidden="true">
                <svg viewBox="0 0 540 500" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M460 260C500 370 420 470 300 485C180 500 80 430 45 320C10 210 70 120 180 80C290 40 420 150 460 260Z" fill="url(#hero-wave-grad-1)" />
                  <path d="M420 220C450 320 370 430 260 450C150 470 80 380 55 280C30 180 100 100 200 70C300 40 390 120 420 220Z" fill="url(#hero-wave-grad-2)" opacity="0.65" />
                  <defs>
                    <linearGradient id="hero-wave-grad-1" x1="40" y1="70" x2="480" y2="490" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#DBEAFE" stopOpacity="0.85" />
                      <stop stopColor="#EFF6FF" stopOpacity="0.45" />
                    </linearGradient>
                    <linearGradient id="hero-wave-grad-2" x1="60" y1="80" x2="440" y2="460" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#BFDBFE" stopOpacity="0.6" />
                      <stop stopColor="#E0F2FE" stopOpacity="0.3" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <Lottie
                className="hero-lottie-anim"
                src="/education.json"
                loop
                autoplay
                aria-hidden="true"
                rendererSettings={{ preserveAspectRatio: 'xMidYMid meet' }}
              />
            </div>
          </div>
        </section>

        {/* ── RIGHT LOGIN / AUTH CARD ── */}
        <section className="signin-right-console">
          <div className="signin-auth-card">

            {/* Card Centered Brand Logo */}
            <div className="auth-card-logo-wrap">
              <img
                src="/logo.png"
                alt="CET NOVA SINCE 2026"
                className="auth-card-logo"
              />
            </div>

            <h2 className="auth-card-title">
              {setupToken
                ? 'Set Up Your Account'
                : mustResetPassword
                ? 'Set New Password'
                : activeTab === 'login'
                  ? 'Sign In'
                  : 'Create Account'}
            </h2>
            <p className="auth-card-subtitle">
              {setupToken
                ? 'Choose a secure password to activate your CETNova student account.'
                : mustResetPassword
                ? 'Choose a new password to secure your account.'
                : activeTab === 'login'
                  ? 'Welcome back! Continue your CET journey.'
                  : 'Join CET Nova and start preparing for your exam.'}
            </p>

            {sessionCheckError && (
              <div className="signin-connection-warning" role="alert">
                <span className="material-symbols-outlined">wifi_off</span>
                <span>{sessionCheckError}</span>
                {onRetrySession && (
                  <button type="button" onClick={onRetrySession}>
                    Retry
                  </button>
                )}
              </div>
            )}

            {/* Session Expired Banner */}
            {sessionExpired && (
              <div className="signin-session-expired" role="alert">
                <span className="material-symbols-outlined">schedule</span>
                <span>{sessionExpiredMessage}</span>
              </div>
            )}

            {/* Error Banner */}
            {submitState === 'error' && errorMsg && (
              <div className="signin-alert-banner" role="alert">
                <span className="material-symbols-outlined">error</span>
                <span>{errorMsg}</span>
              </div>
            )}

            {setupComplete && (
              <div className="signin-alert-banner" role="status">
                <span className="material-symbols-outlined">check_circle</span>
                <span>Your password is set. Sign in with your username and new password.</span>
              </div>
            )}

            {setupToken && (
              <form className="signin-form-fields" onSubmit={handleSubmit}>
                <div className="form-field-group">
                  <label className="form-field-label" htmlFor="setup-pwd">New Password</label>
                  <input
                    id="setup-pwd"
                    type="password"
                    className="form-text-input"
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    value={resetPassword}
                    onChange={event => setResetPassword(event.target.value)}
                    disabled={submitState === 'loading'}
                  />
                </div>
                <div className="form-field-group">
                  <label className="form-field-label" htmlFor="setup-pwd-confirm">Confirm New Password</label>
                  <input
                    id="setup-pwd-confirm"
                    type="password"
                    className="form-text-input"
                    placeholder="Repeat your new password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    value={resetConfirm}
                    onChange={event => setResetConfirm(event.target.value)}
                    disabled={submitState === 'loading'}
                  />
                </div>
                <button type="submit" className="form-submit-btn" disabled={submitState === 'loading'}>
                  {submitState === 'loading' ? 'Setting password…' : 'Activate account'}
                </button>
              </form>
            )}

            {/* ── 1. SIGN IN FORM ── */}
            {activeTab === 'login' && !mustResetPassword && !setupToken && (
              <form className="signin-form-fields" onSubmit={handleSubmit}>
                {/* Email Field */}
                <div className="form-field-group">
                  <label className="visually-hidden" htmlFor="auth-email">
                    Email address or Student ID
                  </label>
                  <div className="form-input-container">
                    <span className="material-symbols-outlined input-leading-icon">mail</span>
                    <input
                      id="auth-email"
                      type="text"
                      className="form-text-input"
                      placeholder="Email address or Student ID"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      autoComplete="username"
                      required
                      disabled={submitState === 'loading'}
                    />
                  </div>
                </div>

                {/* Password Field */}
                <div className="form-field-group">
                  <label className="visually-hidden" htmlFor="auth-password">
                    Password
                  </label>
                  <div className="form-input-container">
                    <span className="material-symbols-outlined input-leading-icon">lock</span>
                    <input
                      id="auth-password"
                      type={showPassword ? 'text' : 'password'}
                      className="form-text-input"
                      placeholder="••••••••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                      disabled={submitState === 'loading'}
                    />
                    <button
                      type="button"
                      className="input-trailing-action"
                      onClick={() => setShowPassword(v => !v)}
                      title={showPassword ? 'Hide password' : 'Show password'}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      <span className="material-symbols-outlined">
                        {showPassword ? 'visibility_off' : 'visibility'}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Meta Options: Remember Me & Forgot Password */}
                <div className="form-meta-row">
                  <label className="form-remember-label">
                    <input
                      type="checkbox"
                      className="form-remember-checkbox"
                      checked={remember}
                      onChange={e => setRemember(e.target.checked)}
                      disabled={submitState === 'loading'}
                    />
                    <span>Remember me</span>
                  </label>
                  <button
                    type="button"
                    className="form-forgot-link"
                    onClick={() => setShowForgotModal(true)}
                  >
                    Forgot password?
                  </button>
                </div>

                {/* Primary Button */}
                <button
                  type="submit"
                  disabled={submitState === 'loading' || submitState === 'success'}
                  className={`form-submit-btn${submitState === 'success' ? ' is-success' : ''}`}
                >
                  {submitState === 'loading' && (
                    <>
                      <span className="btn-spinner" aria-hidden="true" />
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
                      <span className="material-symbols-outlined btn-arrow">arrow_forward</span>
                    </>
                  )}
                </button>

              </form>
            )}

            {/* ── 2. MANDATORY FIRST LOGIN PASSWORD RESET ── */}
            {mustResetPassword && (
              <form className="signin-form-fields" onSubmit={handleSubmit}>
                <div className="signin-reset-notice-card">
                  <span className="material-symbols-outlined" style={{ fontSize: 24 }}>lock_reset</span>
                  <div>
                    <h4>Initial Setup Required</h4>
                    <p>You have signed in using temporary credentials. Please set your secure personal password.</p>
                  </div>
                </div>

                <div className="form-field-group">
                  <label className="form-field-label" htmlFor="reset-pwd">New Password</label>
                  <div className="form-input-container">
                    <span className="material-symbols-outlined input-leading-icon">key</span>
                    <input
                      id="reset-pwd"
                      type={showPassword ? 'text' : 'password'}
                      className="form-text-input"
                      placeholder="Minimum 6 characters"
                      required
                      value={resetPassword}
                      onChange={e => setResetPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="input-trailing-action"
                      onClick={() => setShowPassword(v => !v)}
                    >
                      <span className="material-symbols-outlined">
                        {showPassword ? 'visibility_off' : 'visibility'}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="form-field-group">
                  <label className="form-field-label" htmlFor="reset-pwd-conf">Confirm New Password</label>
                  <div className="form-input-container">
                    <span className="material-symbols-outlined input-leading-icon">check</span>
                    <input
                      id="reset-pwd-conf"
                      type={showPassword ? 'text' : 'password'}
                      className="form-text-input"
                      placeholder="Repeat new password"
                      required
                      value={resetConfirm}
                      onChange={e => setResetConfirm(e.target.value)}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitState === 'loading' || submitState === 'success'}
                  className={`form-submit-btn${submitState === 'success' ? ' is-success' : ''}`}
                >
                  {submitState === 'loading' ? (
                    <>
                      <span className="btn-spinner" aria-hidden="true" />
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
                      <span className="material-symbols-outlined btn-arrow">arrow_forward</span>
                    </>
                  )}
                </button>
              </form>
            )}

            {/* ── 3. REGISTRATION FORM ── */}
            {activeTab === 'register' && submitState !== 'pending' && !mustResetPassword && !setupToken && (
              <form className="signin-form-fields" onSubmit={handleSubmit}>
                {/* Full Student Name */}
                <div className="form-field-group">
                  <label className="visually-hidden" htmlFor="reg-name">Full Student Name</label>
                  <div className="form-input-container">
                    <span className="material-symbols-outlined input-leading-icon">person</span>
                    <input
                      id="reg-name"
                      type="text"
                      className="form-text-input"
                      placeholder="Full Student Name"
                      required
                      value={name}
                      onChange={e => setName(e.target.value)}
                    />
                  </div>
                </div>

                {/* Email Address */}
                <div className="form-field-group">
                  <label className="visually-hidden" htmlFor="reg-email">Email Address</label>
                  <div className="form-input-container">
                    <span className="material-symbols-outlined input-leading-icon">mail</span>
                    <input
                      id="reg-email"
                      type="email"
                      className="form-text-input"
                      placeholder="Email Address"
                      required
                      value={regEmail}
                      onChange={e => setRegEmail(e.target.value)}
                    />
                  </div>
                </div>

                {/* WhatsApp Phone */}
                <div className="form-field-group">
                  <label className="visually-hidden" htmlFor="reg-phone">Phone Number</label>
                  <div className="form-input-container">
                    <span className="material-symbols-outlined input-leading-icon">call</span>
                    <input
                      id="reg-phone"
                      type="tel"
                      className="form-text-input"
                      placeholder="WhatsApp / Phone Number"
                      required
                      value={regPhone}
                      onChange={e => setRegPhone(e.target.value)}
                    />
                  </div>
                </div>

                {/* Center Branch & Batch */}
                <div className="signin-grid-branch-batch">
                  <div className="form-field-group">
                    <div className="form-input-container form-select-wrap">
                      <span className="material-symbols-outlined input-leading-icon">location_on</span>
                      <select
                        id="reg-branch"
                        className="form-native-select"
                        required
                        value={branch}
                        onChange={e => setBranch(e.target.value)}
                      >
                        <option value="" disabled>Center Branch</option>
                        <option value="Byculla">Byculla Campus</option>
                        <option value="Worli">Worli Hub</option>
                        <option value="Prabhadevi">Prabhadevi Branch</option>
                      </select>
                      <span className="material-symbols-outlined form-select-chevron">expand_more</span>
                    </div>
                  </div>

                  <div className="form-field-group">
                    <div className="form-input-container form-select-wrap">
                      <span className="material-symbols-outlined input-leading-icon">groups</span>
                      <select
                        id="reg-batch"
                        className="form-native-select"
                        required
                        value={batch}
                        onChange={e => setBatch(e.target.value)}
                      >
                        <option value="" disabled>Batch</option>
                        <option value="1">Batch 1 (M)</option>
                        <option value="2">Batch 2 (E)</option>
                      </select>
                      <span className="material-symbols-outlined form-select-chevron">expand_more</span>
                    </div>
                  </div>
                </div>

                {/* Submit Action */}
                <button
                  type="submit"
                  disabled={submitState === 'loading'}
                  className="form-submit-btn"
                >
                  {submitState === 'loading' ? (
                    <>
                      <span className="btn-spinner" aria-hidden="true" />
                      <span>Submitting Registration…</span>
                    </>
                  ) : (
                    <>
                      <span>Apply for Student Access</span>
                      <span className="material-symbols-outlined btn-arrow">arrow_forward</span>
                    </>
                  )}
                </button>
              </form>
            )}

            {/* ── 4. PENDING REGISTRATION CONFIRMATION ── */}
            {activeTab === 'register' && submitState === 'pending' && (
              <div className="signin-pending-card">
                <div className="signin-pending-icon-circle">
                  <span className="material-symbols-outlined">verified_user</span>
                </div>
                <h3 className="signin-pending-title">Registration Transmitted!</h3>
                <p className="signin-pending-description">
                  Your admission request has been logged. Our administration verifies center enrollments within 2 to 4 business hours.
                  Your credentials will be dispatched to:
                </p>
                <div className="signin-pending-email-badge">
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#1677FF' }}>outgoing_mail</span>
                  <span>{regEmail}</span>
                </div>
                <button
                  type="button"
                  className="form-submit-btn"
                  onClick={() => switchTab('login')}
                >
                  <span className="material-symbols-outlined">arrow_back</span>
                  <span>Return to Sign In Console</span>
                </button>
              </div>
            )}

            {/* Bottom Card Footer Hint */}
            <div className="card-footer-switch">
              {activeTab === 'login' ? (
                <>
                  <span>New to the CET Nova program?</span>
                  <button
                    type="button"
                    className="card-footer-switch-btn"
                    onClick={() => switchTab('register')}
                  >
                    Create an account
                  </button>
                </>
              ) : submitState !== 'pending' && !mustResetPassword ? (
                <>
                  <span>Already enrolled with an ID?</span>
                  <button
                    type="button"
                    className="card-footer-switch-btn"
                    onClick={() => switchTab('login')}
                  >
                    Sign in here
                  </button>
                </>
              ) : null}
            </div>

          </div>
        </section>
      </main>

      {/* ── Forgot Password Modal ── */}
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
              <div><strong>1. Check your email:</strong> Search your inbox for &quot;CET Nova Credentials&quot; with your initial admit letter.</div>
              <div><strong>2. Center Support:</strong> Visit or contact Byculla, Worli, or Prabhadevi desk with your provisional student roll number.</div>
              <div><strong>3. Password Reset:</strong> Once unlocked by center faculty, you will be prompted to set a new password on your next login.</div>
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