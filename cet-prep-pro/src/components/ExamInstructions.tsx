import { useState } from 'react'

async function enterFullscreen(): Promise<void> {
  const el = document.documentElement
  try {
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
}

export default function ExamInstructions({ onStart, onCancel }: ExamInstructionsProps) {
  const [agreed, setAgreed] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden', background: '#f8f9fa', fontFamily: "'Public Sans', sans-serif", color: '#191c1d' }}>

      {/* ── Header ───────────────────────────────────────── */}
      <header style={{ flexShrink: 0, height: '56px', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
        <span style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>CET Exam Session</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            onClick={onCancel}
            style={{ background: 'transparent', border: 'none', color: '#cbd5e1', fontSize: '14px', fontWeight: 500, cursor: 'pointer', padding: '6px 12px', borderRadius: '6px', transition: 'background 0.2s' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            Cancel
          </button>
          <div style={{ width: '1px', height: '20px', background: '#475569' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '18px', fontVariationSettings: "'FILL' 0, 'wght' 400" }}>timer</span>
            <span style={{ fontFamily: 'monospace', fontSize: '14px', color: '#e2e8f0' }}>00:00:00</span>
          </div>
        </div>
      </header>

      {/* ── Scrollable Body ───────────────────────────────── */}
      <main style={{ flex: 1, overflowY: 'auto', padding: '0' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto', padding: '32px 24px 40px' }}>

          {/* Page Title */}
          <div style={{ marginBottom: '24px' }}>
            <h1 style={{ fontSize: '28px', fontWeight: 700, color: '#0f172a', margin: '0 0 6px' }}>General Instructions</h1>
            <p style={{ fontSize: '14px', color: '#64748b', margin: 0 }}>Please read the following rules carefully before beginning your examination.</p>
          </div>

          {/* Warning Banner */}
          <div style={{ display: 'flex', gap: '14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '12px', padding: '16px', marginBottom: '24px' }}>
            <span className="material-symbols-outlined" style={{ color: '#dc2626', flexShrink: 0, fontSize: '22px', fontVariationSettings: "'FILL' 1" }}>warning</span>
            <div>
              <p style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 700, color: '#991b1b' }}>Full-Screen Mode Requirement</p>
              <p style={{ margin: 0, fontSize: '13px', color: '#b91c1c', lineHeight: '1.6' }}>
                This examination requires you to be in full-screen mode at all times. Switching tabs, minimizing the window, or exiting full-screen will result in an automatic submission and potential disqualification.
              </p>
            </div>
          </div>

          {/* Exam Rules Card */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <span className="material-symbols-outlined" style={{ color: '#2563eb', fontSize: '22px' }}>gavel</span>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Exam Rules</h2>
            </div>
            <div className="exam-rules-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              {[
                'The clock will be set at the server. The countdown timer in the top right corner will display the remaining time available for you to complete the examination.',
                'You are strictly prohibited from using calculators, mobile phones, or any other electronic devices during the test.',
                'Ensure you have a stable internet connection. In case of disruption, do not refresh; wait for the system to attempt reconnection.',
                'Any suspicious activity or multiple face detections will be flagged by the AI proctoring system.',
              ].map((rule, i) => (
                <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#2563eb', flexShrink: 0, marginTop: '6px' }} />
                  <p style={{ margin: 0, fontSize: '13px', color: '#475569', lineHeight: '1.65' }}>{rule}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Navigation Guide Card */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <span className="material-symbols-outlined" style={{ color: '#2563eb', fontSize: '22px' }}>explore</span>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Navigating the Portal</h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { num: '1', bg: '#16a34a', label: 'Indicates questions you have answered and saved.' },
                { num: '2', bg: '#dc2626', label: 'Indicates questions you have viewed but not yet answered.' },
                { num: '3', bg: '#d97706', label: 'Indicates questions marked for later review. These will NOT be evaluated if left unanswered.' },
              ].map(({ num, bg, label }) => (
                <div key={num} style={{ display: 'flex', alignItems: 'center', gap: '14px', background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: '10px', padding: '12px 14px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: bg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '14px', flexShrink: 0 }}>{num}</div>
                  <span style={{ fontSize: '13px', color: '#334155' }}>{label}</span>
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
              <p style={{ margin: 0, color: '#fff', fontSize: '12px', fontWeight: 500 }}>Standardized Digital Testing Environment – CET 2024</p>
            </div>
          </div>

          {/* Declaration Checkbox */}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', background: agreed ? 'rgba(37,99,235,0.06)' : '#f0f4ff', border: `1.5px solid ${agreed ? '#2563eb' : '#bfdbfe'}`, borderRadius: '12px', padding: '16px', cursor: 'pointer', transition: 'all 0.2s' }}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={e => setAgreed(e.target.checked)}
              style={{ width: '18px', height: '18px', accentColor: '#2563eb', cursor: 'pointer', marginTop: '2px', flexShrink: 0 }}
            />
            <div>
              <p style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>Declaration of Candidate</p>
              <p style={{ margin: 0, fontSize: '13px', color: '#475569', lineHeight: '1.65' }}>
                I have read and understood all the instructions mentioned above. I agree that I will not use any unfair means during the examination and will adhere to the full-screen requirement as specified. I understand that any violation may lead to the cancellation of my test.
              </p>
            </div>
          </label>

        </div>
      </main>

      {/* ── Footer ───────────────────────────────────────── */}
      <footer style={{ flexShrink: 0, background: '#fff', borderTop: '1px solid #e2e8f0', boxShadow: '0 -2px 8px rgba(0,0,0,0.05)' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
          {/* Left: Candidate info + fullscreen notice */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div>
              <p style={{ margin: 0, fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Candidate ID</p>
              <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#334155' }}>CET-2024-9921</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '13px', color: '#16a34a', fontVariationSettings: "'FILL' 1" }}>fullscreen</span>
              <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: 600 }}>Full-screen will be requested on start</span>
            </div>
          </div>

          {/* Right: Start Test button */}
          <button
            disabled={!agreed}
            onClick={async () => {
              await enterFullscreen()
              onStart()
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '13px 28px', borderRadius: '10px', border: 'none',
              fontSize: '15px', fontWeight: 700,
              cursor: agreed ? 'pointer' : 'not-allowed',
              background: agreed ? 'linear-gradient(135deg, #1d4ed8, #2563eb)' : '#e2e8f0',
              color: agreed ? '#fff' : '#94a3b8',
              boxShadow: agreed ? '0 4px 16px rgba(37,99,235,0.35)' : 'none',
              transition: 'all 0.2s',
              flexShrink: 0,
            }}
          >
            Start Test
            <span className="material-symbols-outlined" style={{ fontSize: '18px', fontVariationSettings: "'FILL' 0" }}>arrow_forward</span>
          </button>
        </div>
      </footer>
    </div>
  )
}

