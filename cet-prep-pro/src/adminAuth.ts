export const ADMIN_STORAGE_KEY = 'cetprep-admin-auth'

export interface AdminAuthState {
  email: string
  password: string
  lastLogin: string
}

export const DEFAULT_ADMIN_CREDENTIALS = {
  email: 'admin@1234',
  password: 'admin@1234',
}

export function getStoredAdminCredentials(): AdminAuthState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(ADMIN_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as AdminAuthState
  } catch {
    return null
  }
}

export function saveAdminCredentials(credentials: AdminAuthState) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(credentials))
}

export function clearAdminCredentials() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(ADMIN_STORAGE_KEY)
}

export function isAdminCredentials(email: string, password: string) {
  const stored = getStoredAdminCredentials()
  const normalizedEmail = email.trim().toLowerCase()

  if (stored) {
    return stored.email.toLowerCase() === normalizedEmail && stored.password === password
  }

  return (
    normalizedEmail === DEFAULT_ADMIN_CREDENTIALS.email.toLowerCase() &&
    password === DEFAULT_ADMIN_CREDENTIALS.password
  )
}
