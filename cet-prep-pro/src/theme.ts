export const BRAND_COLORS = {
  get primary() { return getThemeColor('--color-primary', '#FF634A') },
  get primaryHover() { return getThemeColor('--color-primary-hover', '#C94332') },
  get textPrimary() { return getThemeColor('--color-text-primary', '#252525') },
  get textSecondary() { return getThemeColor('--color-text-secondary', '#666666') },
  get surfaceSecondary() { return getThemeColor('--color-surface-secondary', '#E7E7E7') },
  get border() { return getThemeColor('--color-border', '#D2D2D4') },
  get primaryRgb() { return getThemeColor('--color-primary-rgb', '255, 99, 74') },
} as const

export type Theme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'cetNovaTheme'
export const THEME_CHANGE_EVENT = 'cet:theme-change'

function getThemeColor(property: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(property).trim() || fallback
}

export function getSavedTheme(): Theme {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch (error) {
    console.warn('Could not read the saved theme preference.', error)
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  }
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.classList.toggle('light', theme === 'light')
  document.documentElement.style.colorScheme = theme

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (themeColor) themeColor.content = theme === 'dark' ? '#0B1120' : '#d21436'

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch (error) {
    console.warn('Could not save the theme preference.', error)
  }

  window.dispatchEvent(new CustomEvent<Theme>(THEME_CHANGE_EVENT, { detail: theme }))
}
