import { session } from './lib/api'

export const ADMIN_STORAGE_KEY = 'cetprep-admin-auth'

export interface AdminAuthState {
  email: string
  lastLogin: string
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

export function isAdminCredentials(): boolean {
  const user = session.get()
  return user?.role === 'admin'
}
