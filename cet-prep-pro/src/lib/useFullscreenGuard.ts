import { useState, useEffect, useCallback, useRef } from 'react'

export type WarningType = 'fullscreen' | 'focus' | null

interface FullscreenGuard {
  /** Is the browser currently in fullscreen? */
  isFullscreen: boolean
  /** Does this browser support the Fullscreen API? */
  fullscreenSupported: boolean
  /** Which warning (if any) should be shown */
  warningType: WarningType
  /** Should the exam timer be paused? */
  timerPaused: boolean
  /** Request fullscreen (must be called from a user gesture handler) */
  requestFullscreen: () => Promise<void>
  /** Dismiss the focus-loss warning (fullscreen warning cannot be dismissed without re-entering) */
  dismissFocusWarning: () => void
}

const isFullscreenSupported = (): boolean =>
  typeof document !== 'undefined' &&
  (document.fullscreenEnabled ||
    (document as any).webkitFullscreenEnabled ||
    (document as any).mozFullScreenEnabled ||
    (document as any).msFullscreenEnabled)

const getFullscreenElement = (): Element | null =>
  document.fullscreenElement ||
  (document as any).webkitFullscreenElement ||
  (document as any).mozFullScreenElement ||
  (document as any).msFullscreenElement ||
  null

export function useFullscreenGuard(active: boolean): FullscreenGuard {
  const supported = isFullscreenSupported()

  const [isFullscreen, setIsFullscreen] = useState(() => !!getFullscreenElement())
  const [warningType, setWarningType] = useState<WarningType>(null)

  // Track whether the warning is from fullscreen (blocks exam) or focus (softer)
  // Focus warnings auto-dismiss when the tab is active again.
  const focusWarningDismissedRef = useRef(false)

  /* ── Fullscreen change listener ─────────────────────────────────────── */
  useEffect(() => {
    if (!active || !supported) return

    const checkFullscreen = () => {
      const inFS = !!getFullscreenElement()
      setIsFullscreen(inFS)
      if (!inFS) {
        setWarningType('fullscreen')
      } else {
        setWarningType(prev => (prev === 'fullscreen' ? null : prev))
      }
    }

    // Run check on mount after a short delay (300ms) to let transition finish
    const timeoutId = setTimeout(checkFullscreen, 300)

    const handleChange = () => {
      const inFS = !!getFullscreenElement()
      setIsFullscreen(inFS)
      if (!inFS) {
        // Exited fullscreen — show blocking modal
        setWarningType('fullscreen')
      } else {
        // Re-entered fullscreen — clear any fullscreen warning
        setWarningType(prev => (prev === 'fullscreen' ? null : prev))
      }
    }

    document.addEventListener('fullscreenchange', handleChange)
    document.addEventListener('webkitfullscreenchange', handleChange)
    document.addEventListener('mozfullscreenchange', handleChange)
    document.addEventListener('MSFullscreenChange', handleChange)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('fullscreenchange', handleChange)
      document.removeEventListener('webkitfullscreenchange', handleChange)
      document.removeEventListener('mozfullscreenchange', handleChange)
      document.removeEventListener('MSFullscreenChange', handleChange)
    }
  }, [active, supported])

  /* ── Visibility / focus-loss listener ──────────────────────────────── */
  useEffect(() => {
    if (!active) return

    const handleVisibility = () => {
      if (document.hidden) {
        focusWarningDismissedRef.current = false
        // Only add a focus warning if there's no fullscreen warning already showing
        setWarningType(prev => (prev === 'fullscreen' ? prev : 'focus'))
      } else {
        // Returned to tab — auto-dismiss focus warning
        setWarningType(prev => (prev === 'focus' ? null : prev))
      }
    }

    const handleWindowBlur = () => {
      if (!document.hidden) {
        // Window lost focus but tab is still active (e.g. alt-tab)
        setWarningType(prev => (prev === 'fullscreen' ? prev : 'focus'))
      }
    }

    const handleWindowFocus = () => {
      setWarningType(prev => (prev === 'focus' ? null : prev))
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('blur', handleWindowBlur)
    window.addEventListener('focus', handleWindowFocus)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('blur', handleWindowBlur)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [active])

  /* ── requestFullscreen helper ───────────────────────────────────────── */
  const requestFullscreen = useCallback(async (): Promise<void> => {
    const el = document.documentElement
    try {
      if (el.requestFullscreen) {
        await el.requestFullscreen()
      } else if ((el as any).webkitRequestFullscreen) {
        await (el as any).webkitRequestFullscreen()
      } else if ((el as any).mozRequestFullScreen) {
        await (el as any).mozRequestFullScreen()
      } else if ((el as any).msRequestFullscreen) {
        await (el as any).msRequestFullscreen()
      }
    } catch {
      // User denied or browser prevented — keep warning visible
    }
  }, [])

  /* ── dismissFocusWarning (can be explicitly closed) ─────────────────── */
  const dismissFocusWarning = useCallback(() => {
    setWarningType(prev => (prev === 'focus' ? null : prev))
  }, [])

  const timerPaused = warningType !== null

  return {
    isFullscreen,
    fullscreenSupported: supported,
    warningType,
    timerPaused,
    requestFullscreen,
    dismissFocusWarning,
  }
}
