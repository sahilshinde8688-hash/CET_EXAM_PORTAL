import { useEffect, useRef } from 'react'
import type { WarningType } from '../lib/useFullscreenGuard'

interface Props {
  warningType: WarningType
  fullscreenSupported: boolean
  onRequestFullscreen: () => Promise<void>
  onDismissFocusWarning: () => void
  onExitExam: () => void
  timerContinues?: boolean
}

export default function FullscreenWarningModal({
  warningType,
  fullscreenSupported,
  onRequestFullscreen,
  onDismissFocusWarning,
  onExitExam,
  timerContinues = false,
}: Props) {
  const btnRef = useRef<HTMLButtonElement>(null)

  // Focus the primary action button when modal opens for keyboard accessibility
  useEffect(() => {
    if (warningType) {
      const t = setTimeout(() => btnRef.current?.focus(), 80)
      return () => clearTimeout(t)
    }
  }, [warningType])

  // Prevent scroll on body when modal is open
  useEffect(() => {
    if (warningType) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [warningType])

  if (!warningType) return null

  const isFullscreenWarning = warningType === 'fullscreen'

  /* ── Backdrop ──────────────────────────────────────────────────────────── */
  const backdropStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 999999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: isFullscreenWarning
      ? 'rgba(var(--color-text-primary-rgb), 0.92)'
      : 'rgba(var(--color-text-primary-rgb), 0.70)',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
    animation: 'fsw-fadein 0.18s ease',
  }

  /* ── Card ──────────────────────────────────────────────────────────────── */
  const cardStyle: React.CSSProperties = {
    background: 'var(--color-surface)',
    borderRadius: '20px',
    padding: '44px 40px 36px',
    maxWidth: '460px',
    width: '90%',
    textAlign: 'center',
    boxShadow: '0 32px 64px rgba(0,0,0,0.35)',
    animation: 'fsw-slidein 0.22s cubic-bezier(0.34,1.56,0.64,1)',
    position: 'relative',
    overflow: 'hidden',
  }

  /* ── Accent strip at top ───────────────────────────────────────────────── */
  const stripStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: '5px',
    background: isFullscreenWarning
      ? 'linear-gradient(90deg, var(--color-error), var(--color-error))'
      : 'linear-gradient(90deg, var(--color-primary), var(--color-primary))',
    borderRadius: '20px 20px 0 0',
  }

  const iconBgStyle: React.CSSProperties = {
    width: '72px',
    height: '72px',
    borderRadius: '50%',
    background: isFullscreenWarning ? 'var(--color-surface-secondary)' : 'var(--color-surface-secondary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 20px',
  }

  const tagStyle: React.CSSProperties = {
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    marginBottom: '14px',
    background: isFullscreenWarning ? 'var(--color-surface-secondary)' : 'var(--color-surface-secondary)',
    color: isFullscreenWarning ? 'var(--color-error)' : 'var(--color-primary)',
    border: `1px solid ${isFullscreenWarning ? 'var(--color-surface-secondary)' : 'var(--color-surface-secondary)'}`,
  }

  const primaryBtnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    width: '100%',
    padding: '14px 24px',
    borderRadius: '12px',
    border: 'none',
    fontSize: '15px',
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
    background: isFullscreenWarning
      ? 'linear-gradient(135deg, var(--color-text-primary), var(--color-primary))'
      : 'linear-gradient(135deg, var(--color-primary), var(--color-primary))',
    color: 'var(--color-on-primary)',
    boxShadow: isFullscreenWarning
      ? '0 6px 20px rgba(var(--color-primary-rgb), 0.35)'
      : '0 6px 20px rgba(var(--color-primary-rgb), 0.35)',
    transition: 'transform 0.1s, box-shadow 0.1s',
  }

  const secondaryBtnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    width: '100%',
    padding: '11px 24px',
    borderRadius: '12px',
    border: '1.5px solid var(--color-border)',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    background: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
    marginTop: '10px',
  }

  return (
    <>
      {/* Inject keyframe animations */}
      <style>{`
        @keyframes fsw-fadein  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes fsw-slidein { from { transform: translateY(24px) scale(0.96); opacity: 0 } to { transform: translateY(0) scale(1); opacity: 1 } }
        @keyframes fsw-pulse   { 0%,100% { transform: scale(1) } 50% { transform: scale(1.08) } }
        .fsw-icon { animation: fsw-pulse 2.2s ease-in-out infinite }
        .fsw-primary-btn:hover { transform: translateY(-1px); filter: brightness(1.07) }
        .fsw-primary-btn:active { transform: scale(0.98) }
        .fsw-secondary-btn:hover { background: var(--color-surface-secondary) !important }
      `}</style>

      <div style={backdropStyle} role="dialog" aria-modal="true" aria-labelledby="fsw-title">
        <div style={cardStyle}>
          <div style={stripStyle} />

          {/* Icon */}
          <div style={iconBgStyle}>
            <span
              className="material-symbols-outlined fsw-icon"
              style={{
                fontSize: '36px',
                color: isFullscreenWarning ? 'var(--color-error)' : 'var(--color-primary)',
                fontVariationSettings: "'FILL' 1",
              }}
            >
              {isFullscreenWarning ? 'fullscreen_exit' : 'tab_unselected'}
            </span>
          </div>

          {/* Tag */}
          <div style={tagStyle}>
            {isFullscreenWarning ? '⚠ Exam Interrupted' : '⚠ Focus Lost'}
          </div>

          {/* Heading */}
          <h2
            id="fsw-title"
            style={{ margin: '0 0 10px', fontSize: '20px', fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1.3 }}
          >
            {isFullscreenWarning
              ? 'Please switch to full screen to continue the test.'
              : 'Please return to the examination window to continue.'}
          </h2>

          {/* Description */}
          <p style={{ margin: '0 0 28px', fontSize: '13.5px', color: 'var(--color-text-primary)', lineHeight: 1.65 }}>
            {timerContinues
              ? isFullscreenWarning
                ? 'Return to full-screen mode to continue. Your assigned-test countdown continues while this warning is displayed.'
                : 'You switched away from the examination window. Return to this tab; your assigned-test countdown continues.'
              : isFullscreenWarning
                ? 'Your exam has been paused. Full-screen mode is mandatory for examination integrity. Click the button below to restore full-screen and resume your test.'
                : 'Your exam has been paused because you switched away from the examination window. Return to this tab to continue.'}
          </p>

          {/* Primary action */}
          {isFullscreenWarning ? (
            fullscreenSupported ? (
              <button
                ref={btnRef}
                className="fsw-primary-btn"
                style={primaryBtnStyle}
                onClick={onRequestFullscreen}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px', fontVariationSettings: "'FILL' 0" }}>
                  fullscreen
                </span>
                Return to Full Screen
              </button>
            ) : (
              <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '16px', fontSize: '13px', color: 'var(--color-text-primary)', textAlign: 'left', lineHeight: 1.6 }}>
                <strong style={{ color: 'var(--color-text-primary)', display: 'block', marginBottom: '4px' }}>Full-screen not supported</strong>
                Your browser does not support the Fullscreen API. Please press <kbd style={{ background: 'var(--color-border)', padding: '1px 6px', borderRadius: '4px', fontFamily: 'monospace' }}>F11</kbd> to manually enter full-screen mode, then return to this tab.
              </div>
            )
          ) : (
            <button
              ref={btnRef}
              className="fsw-primary-btn"
              style={primaryBtnStyle}
              onClick={onDismissFocusWarning}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '20px', fontVariationSettings: "'FILL' 0" }}>
                arrow_forward
              </span>
              I'm Back — Resume Exam
            </button>
          )}

          {/* Timer status */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginTop: '20px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '15px', color: 'var(--color-text-primary)', fontVariationSettings: "'FILL' 0" }}>{timerContinues ? 'timer' : 'timer_off'}</span>
            <span style={{ fontSize: '12px', color: 'var(--color-text-primary)', fontWeight: 500 }}>{timerContinues ? 'Assignment countdown continues' : 'Exam timer is paused'}</span>
          </div>

          {/* Exam integrity notice */}
          {!timerContinues && <p style={{ margin: '16px 0 0', fontSize: '11px', color: 'var(--color-text-primary)', lineHeight: 1.5 }}>
            Your answers and progress are safe. This incident has been logged for exam integrity purposes.
          </p>}
        </div>
      </div>
    </>
  )
}
