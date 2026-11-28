import { useEffect, useState } from 'react'
import { getSavedTheme, setTheme, THEME_CHANGE_EVENT, type Theme } from '../theme'

interface ThemeToggleProps {
  className?: string
}

export default function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const [theme, setCurrentTheme] = useState<Theme>(getSavedTheme)
  const isDark = theme === 'dark'

  useEffect(() => {
    const handleThemeChange = (event: Event) => {
      setCurrentTheme((event as CustomEvent<Theme>).detail)
    }

    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange)
    return () => window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange)
  }, [])

  return (
    <button
      type="button"
      className={`theme-toggle ${className}`.trim()}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      aria-pressed={isDark}
      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      <span className="material-symbols-outlined" aria-hidden="true">
        {isDark ? 'light_mode' : 'dark_mode'}
      </span>
    </button>
  )
}
