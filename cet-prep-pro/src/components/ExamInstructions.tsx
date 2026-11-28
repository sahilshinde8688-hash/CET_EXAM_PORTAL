import { useState } from 'react'

async function enterFullscreen(): Promise<void> {
  const el = document.documentElement
  try {
    if (document.fullscreenElement) return
    if (el.requestFullscreen) await el.requestFullscreen()
    else if ((el as any).webkitRequestFullscreen) await (el as any).webkitRequestFullscreen()
    else if ((el as any).mozRequestFullScreen) await (el as any).mozRequestFullScreen()
    else if ((el as any).msRequestFullscreen) await (el as any).msRequestFullscreen()
  } catch {
    // User denied or browser blocked — still proceed to exam
  }
}

interface ExamInstructionsProps {
  onStart: () => void
  onCancel: () => void
  assignedTest?: boolean
  assignmentName?: string
  assignmentSubject?: string
  durationMinutes?: number
  totalMarks?: number
  starting?: boolean
  startError?: string | null
}

export default function ExamInstructions({ onStart, onCancel, assignedTest = false, assignmentName, assignmentSubject, durationMinutes, totalMarks, starting = false, startError }: ExamInstructionsProps) {
  const [agreed, setAgreed] = useState(false)
  const rules = assignedTest
    ? [
        'The countdown starts when your assigned attempt begins and cannot exceed the assignment expiry time.',
        'Your answers are saved automatically. Keep a stable internet connection while taking the test.',
        'Use the question palette to review your progress and follow the navigation rules set for this assignment.',
        'The examination opens in full-screen mode. Leaving full-screen or switching tabs may show a warning; the assignment countdown continues.',
        'Once submitted or expired, an attempt cannot be changed or submitted again.',
      ]
    : [
        'The clock will be set at the server. The countdown timer in the top right corner will display the remaining time available for you to complete the examination.',
        'You are strictly prohibited from using calculators, mobile phones, or any other electronic devices during the test.',
        'Ensure you have a stable internet connection. In case of disruption, do not refresh; wait for the system to attempt reconnection.',
        'Any suspicious activity or multiple face detections will be flagged by the AI proctoring system.',
      ]
  const navigationStatuses = assignedTest
    ? [
        { num: '1', bg: 'var(--color-success)', color: 'var(--color-on-primary)', label: 'Answered and saved.' },
        { num: '2', bg: 'var(--color-error-surface)', color: 'var(--color-text-primary)', label: 'Viewed but not answered.' },
        { num: '3', bg: 'var(--color-warning)', color: 'var(--color-text-primary)', label: 'Marked for review.' },
        { num: '4', bg: '#7C3AED', color: 'var(--color-on-primary)', label: 'Answered and marked for review.' },
        { num: '5', bg: 'var(--color-surface-secondary)', color: 'var(--color-text-primary)', label: 'Not yet visited.' },
      ]
    : [
        { num: '1', bg: 'var(--color-success)', color: 'var(--color-on-primary)', label: 'Indicates questions you have answered and saved.' },
        { num: '2', bg: 'var(--color-error)', color: 'var(--color-on-primary)', label: 'Indicates questions you have viewed but not yet answered.' },
        { num: '3', bg: 'var(--color-primary)', color: 'var(--color-on-primary)', label: 'Indicates questions marked for later review. These will NOT be evaluated if left unanswered.' },
      ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden', background: 'var(--color-background)', fontFamily: "'Public Sans', sans-serif", color: 'var(--color-text-primary)' }}>

      {/* ── Header ───────────────────────────────────────── */}
      <header className="exam-instructions-header" style={{ flexShrink: 0, height: '56px', background: 'var(--color-surface)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', borderBottom: '1px solid var(--color-border)', boxShadow: '0 2px 8px rgba(37, 37, 37, 0.06)' }}>
        <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-text-primary)' }}>{assignmentName || 'CET Exam Session'}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            onClick={onCancel}
            style={{ background: 'transparent', border: 'none', color: 'var(--color-text-primary)', fontSize: '14px', fontWeight: 500, cursor: 'pointer', padding: '6px 12px', borderRadius: '6px', transition: 'background 0.2s' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-background)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            Cancel
          </button>
          <div style={{ width: '1px', height: '20px', background: 'var(--color-border)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-text-primary)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '18px', fontVariationSettings: "'FILL' 0, 'wght' 400" }}>timer</span>
            <span style={{ fontFamily: 'monospace', fontSize: '14px', fontWeight: 700, color: 'var(--color-primary-hover)' }}>00:00:00</span>
          </div>
        </div>
      </header>

      {/* ── Scrollable Body ───────────────────────────────── */}
      <main style={{ flex: 1, overflowY: 'auto', padding: '0' }}>
        <div className="exam-instructions-body-inner" style={{ maxWidth: '760px', margin: '0 auto', padding: '32px 24px 40px' }}>

          {/* Page Title */}
          <div style={{ marginBottom: '24px' }}>
            <h1 style={{ fontSize: '28px', fontWeight: 700, color: 'var(--color-text-primary)', margin: '0 0 6px' }}>General Instructions</h1>
            <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', margin: 0 }}>Please read the following rules carefully before beginning your examination.</p>
            {assignedTest && <p style={{ fontSize: '14px', color: 'var(--color-text-primary)', fontWeight: 600, margin: '12px 0 0' }}>
              {[assignmentSubject, durationMinutes ? `${durationMinutes} minutes` : null, totalMarks != null ? `${totalMarks} total marks` : null].filter(Boolean).join(' · ')}
            </p>}
          </div>
          {startError && <p role="alert" style={{ background: assignedTest ? 'var(--color-error-surface)' : 'var(--color-surface-secondary)', border: `1px solid ${assignedTest ? 'var(--color-error-border)' : 'var(--color-surface-secondary)'}`, borderRadius: '10px', color: 'var(--color-error)', fontSize: '13px', lineHeight: 1.5, margin: '0 0 20px', padding: '12px 14px' }}>{startError}</p>}

          {/* Warning Banner */}
          <div style={{ display: 'flex', gap: '14px', background: assignedTest ? 'var(--color-error-surface)' : 'var(--color-surface-secondary)', border: `1px solid ${assignedTest ? 'var(--color-error-border)' : 'var(--color-surface-secondary)'}`, borderRadius: '12px', padding: '16px', marginBottom: '24px' }}>
            <span className="material-symbols-outlined" style={{ color: 'var(--color-error)', flexShrink: 0, fontSize: '22px', fontVariationSettings: "'FILL' 1" }}>warning</span>
            <div>
              <p style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 700, color: 'var(--color-error)' }}>Full-Screen Mode Requirement</p>
              <p style={{ margin: 0, fontSize: '13px', color: assignedTest ? 'var(--color-text-secondary)' : 'var(--color-error)', lineHeight: '1.6' }}>
                {assignedTest
                  ? 'Stay in full-screen mode while taking this test. Your questions will load and the assignment timer will start only after you click Start Test.'
                  : 'This examination requires you to be in full-screen mode at all times. Switching tabs, minimizing the window, or exiting full-screen will result in an automatic submission and potential disqualification.'}
              </p>
            </div>
          </div>

          {/* Exam Rules Card */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '14px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '22px' }}>gavel</span>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--color-text-primary)' }}>Exam Rules</h2>
            </div>
            <div className="exam-rules-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              {rules.map((rule, i) => (
                <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--color-primary)', flexShrink: 0, marginTop: '6px' }} />
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: '1.65' }}>{rule}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Navigation Guide Card */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '14px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '22px' }}>explore</span>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--color-text-primary)' }}>Navigating the Portal</h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {navigationStatuses.map(({ num, bg, color, label }) => (
                <div key={num} style={{ display: 'flex', alignItems: 'center', gap: '14px', background: 'var(--color-surface)', border: `1px solid ${assignedTest ? 'var(--color-border)' : 'var(--color-border-highlight)'}`, borderRadius: '10px', padding: '12px 14px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: bg, color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '14px', flexShrink: 0 }}>{num}</div>
                  <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Exam Room Image */}
          <div style={{ position: 'relative', width: '100%', height: '180px', borderRadius: '14px', overflow: 'hidden', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
            <img
              alt="Examination environment"
              style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'grayscale(60%) brightness(0.85)' }}
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuB_q6iEWQVBFJNuogQSu6iVWtwkyy9ubcjstHmdzvtsAGYlN3ZQLp2XD5dC8yFpGRh5eH2idRAHdfGcTFqovF8M15nmI2HPwTXGI5DPQDViabZcAhkuQTbm0nKv7eL0G_xAi6uCJkUyl6v-qo2sRWXNi2lLFsn-c4Q_f5YvWXVwkb73kLGUVa6_ZVGSX67qJ8KGcXyVKJbXEjEvyyQJfmO1hkbH0zjM3XVtqJR9pUvYb9Hfaqqf3EvIL9iIDfji4MxIdCvLacnHcmc"
            />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 60%)', display: 'flex', alignItems: 'flex-end', padding: '14px 16px' }}>
              <p style={{ margin: 0, color: 'var(--color-on-primary)', fontSize: '12px', fontWeight: 500 }}>
                {assignedTest ? 'Standardized Digital Testing Environment' : 'Standardized Digital Testing Environment – CET 2024'}
              </p>
            </div>
          </div>

          {/* Declaration Checkbox */}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', background: agreed ? 'rgba(var(--color-primary-rgb), 0.06)' : 'var(--color-surface)', border: `1.5px solid ${agreed ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius: '12px', padding: '16px', cursor: 'pointer', transition: 'all 0.2s' }}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={e => setAgreed(e.target.checked)}
              style={{ width: '18px', height: '18px', accentColor: 'var(--color-primary)', cursor: 'pointer', marginTop: '2px', flexShrink: 0 }}
            />
            <div>
              <p style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 700, color: 'var(--color-text-primary)' }}>Declaration of Candidate</p>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: '1.65' }}>
                {assignedTest
                  ? 'I have read and understood the instructions above. I agree to follow the assignment rules and understand that my answers are saved against this attempt.'
                  : 'I have read and understood all the instructions mentioned above. I agree that I will not use any unfair means during the examination and will adhere to the full-screen requirement as specified. I understand that any violation may lead to the cancellation of my test.'}
              </p>
            </div>
          </label>

        </div>
      </main>

      {/* ── Footer ───────────────────────────────────────── */}
      <footer style={{ flexShrink: 0, background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)', boxShadow: '0 -2px 8px rgba(0,0,0,0.05)' }}>
        <div className="exam-instructions-footer-inner" style={{ maxWidth: '760px', margin: '0 auto', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
          {/* Left: Candidate info + fullscreen notice */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {!assignedTest && <div>
              <p style={{ margin: 0, fontSize: '11px', fontWeight: 600, color: 'var(--color-text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Candidate ID</p>
              <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--color-text-primary)' }}>CET-2024-9921</p>
            </div>}
            {!assignedTest && <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '13px', color: 'var(--color-success)', fontVariationSettings: "'FILL' 1" }}>fullscreen</span>
              <span style={{ fontSize: '11px', color: 'var(--color-success)', fontWeight: 600 }}>Full-screen will be requested on start</span>
            </div>}
            {assignedTest && <span style={{ fontSize: '13px', color: 'var(--color-text-primary)', fontWeight: 600 }}>{durationMinutes} minute assignment · Timer starts after confirmation</span>}
          </div>

          {/* Right: Start Test button */}
          <button
            className="exam-instructions-start-btn"
            disabled={!agreed || starting}
            onClick={async () => {
              if (starting) return
              await enterFullscreen()
              onStart()
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '13px 28px', borderRadius: '10px', border: 'none',
              fontSize: '15px', fontWeight: 700,
              cursor: agreed && !starting ? 'pointer' : 'not-allowed',
              background: agreed && !starting ? 'var(--color-primary)' : 'var(--color-surface-secondary)',
              color: agreed && !starting ? 'var(--color-on-primary)' : 'var(--color-text-primary)',
              boxShadow: agreed && !starting ? '0 4px 16px rgba(var(--color-primary-rgb), 0.25)' : 'none',
              transition: 'all 0.2s',
              flexShrink: 0,
            }}
          >
            {starting ? 'Loading questions…' : 'Start Test'}
            <span className="material-symbols-outlined" style={{ fontSize: '18px', fontVariationSettings: "'FILL' 0", ...(starting ? { animation: 'inline-loading-spin 0.8s linear infinite' } : {}) }}>{starting ? 'progress_activity' : 'arrow_forward'}</span>
          </button>
        </div>
      </footer>
    </div>
  )
}
