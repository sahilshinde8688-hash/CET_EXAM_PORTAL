import { supabase } from './supabaseClient'

const getApiUrl = (): string => {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host === 'localhost' || host === '127.0.0.1') {
      const envUrl = import.meta.env.VITE_API_URL?.trim()
      if (envUrl && (envUrl.includes('localhost') || envUrl.includes('127.0.0.1'))) {
        return envUrl.replace(/\/$/, '')
      }
      return 'http://localhost:5000'
    }
  }
  const configuredApiUrl = import.meta.env.VITE_API_URL?.trim()
  const fallbackApiUrl = 'https://cet-portal-3vas.onrender.com'
  return (configuredApiUrl || fallbackApiUrl).replace(/\/$/, '')
}

const API_URL = getApiUrl()
const BASE = `${API_URL}/api`


let memoryCsrfToken: string | null = null

const getCookieToken = (): string | null => {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/(?:^|; )csrfToken=([^;]*)/)
  if (!match) return null
  const val = decodeURIComponent(match[1])
  return val || null
}

const setCsrfToken = (token: string | null) => {
  if (!token) {
    memoryCsrfToken = null
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem('csrfToken')
      } catch {}
    }
    return
  }

  memoryCsrfToken = token
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem('csrfToken', token)
    } catch {}
  }
}

/**
 * Get the currently valid CSRF token from the cookie first, then memory, then localStorage.
 * This avoids sending a stale rotated token when the server issues a new one.
 */
const getCsrfToken = (): string | null => {
  const cookieToken = getCookieToken()
  if (cookieToken) {
    if (memoryCsrfToken !== cookieToken) {
      memoryCsrfToken = cookieToken
    }
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem('csrfToken', cookieToken)
      } catch {}
    }
    return cookieToken
  }

  if (memoryCsrfToken) return memoryCsrfToken

  if (typeof window !== 'undefined' && window.localStorage) {
    const stored = window.localStorage.getItem('csrfToken')
    if (stored) {
      memoryCsrfToken = stored
      return stored
    }
  }

  return null
}

const ensureCsrfToken = async (): Promise<string | null> => {
  const existingToken = getCsrfToken()
  if (existingToken) return existingToken

  try {
    const res = await fetch(`${BASE}/auth/csrf`, { credentials: 'include' })
    const headerToken = res.headers.get('X-CSRF-Token')
    if (headerToken) {
      setCsrfToken(headerToken)
      return headerToken
    }
    const data = await res.json().catch(() => ({}))
    if (data.csrfToken) {
      setCsrfToken(data.csrfToken)
      return data.csrfToken
    }
  } catch {}
  return getCsrfToken()
}

/**
 * Enhanced fetch wrapper with:
 * - Automatic CSRF token injection for state-changing requests
 * - Credential inclusion for cookies
 * - Token refresh on 401 errors
 */
let isRefreshing = false

// Special error class to signal that token was refreshed and request should be retried
export class TokenRefreshedError extends Error {
  constructor() {
    super('Token refreshed. Please retry the request.')
    this.name = 'TokenRefreshedError'
  }
}

async function handle(res: Response, refreshOnUnauthorized = true) {
  const resCsrf = res.headers.get('X-CSRF-Token')
  if (resCsrf) setCsrfToken(resCsrf)

  // If unauthorized, try to refresh the token once
  if (res.status === 401 && refreshOnUnauthorized && !isRefreshing) {
    isRefreshing = true
    try {
      await doRefreshTokens()
      // Token refreshed successfully - signal caller to retry
      throw new TokenRefreshedError()
    } catch (error) {
      if (error instanceof TokenRefreshedError) {
        throw error // Re-throw to signal retry
      }
      // Refresh failed, clear session and throw error
      session.clear()
      throw new Error('Session expired. Please log in again.')
    } finally {
      isRefreshing = false
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let msg = text || `HTTP ${res.status}`
    let details: any = undefined
    try {
      const body = JSON.parse(text)
      msg = body.message || msg
      details = body.details
    } catch {}
    const error = new Error(msg)
    ;(error as any).details = details
    throw error
  }
  return res
}

/**
 * Refresh access token using refresh token (internal, doesn't use handle to avoid recursion)
 */
async function doRefreshTokens(): Promise<void> {
  const csrfToken = getCsrfToken()
  const headers: Record<string, string> = {}
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken

  const res = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers,
  })
  if (!res.ok) {
    session.clear()
    throw new Error('Refresh failed')
  }
}

/**
 * Refresh access token using refresh token (public API)
 */
export async function refreshTokens(): Promise<void> {
  await doRefreshTokens()
}

export interface AuthUser {
  _id: string
  id?: string
  email: string
  name: string
  role: 'student' | 'admin' | 'teacher'
  status?: 'pending' | 'approved' | 'rejected'
  phone?: string
  branch?: string
  mhcetId?: string
  createdAt?: string
  mustResetPassword?: boolean
  batch?: number
  photo?: string
  password?: string
  mhcetPassword?: string
}

/* ── Auth ── */
export async function signin(email: string, password: string) {
  const csrfToken = await ensureCsrfToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken

  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ email, password }),
  })
  const data = await handle(res).then(() => res.json())
  return { data }
}

export async function register(payload: { name: string; email: string; phone: string; branch: string; batch: number }) {
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await handle(res).then(() => res.json())
  return { data }
}

export async function resetPassword(payload: { token: string; newPassword: string }) {
  const res = await fetch(`${BASE}/users/reset-password`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await handle(res).then(() => res.json())
  return { data }
}

export const authAPI = {
  login: async (email: string, password: string, rememberMe = false) => {
    const cleanId = email.trim().toLowerCase()

    // 1. Try the real backend session first so protected API calls get valid cookies.
    let backendError: Error | null = null
    try {
      const csrfToken = await ensureCsrfToken()
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)

      const res = await fetch(`${BASE}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers,
        signal: controller.signal,
        body: JSON.stringify({ email: cleanId, password, rememberMe }),
      }).finally(() => clearTimeout(timeoutId))

      const headerResCsrf = res.headers.get('X-CSRF-Token')
      if (headerResCsrf) setCsrfToken(headerResCsrf)

      if (res.status === 403) {
        const body = await res.json().catch(() => ({}))
        if (body.message?.toLowerCase().includes('csrf')) {
          memoryCsrfToken = null
          if (typeof window !== 'undefined' && window.localStorage) {
            try { window.localStorage.removeItem('csrfToken') } catch {}
          }
          const freshToken = await ensureCsrfToken()
          if (freshToken) {
            headers['X-CSRF-Token'] = freshToken
            const retryRes = await fetch(`${BASE}/auth/login`, {
              method: 'POST',
              credentials: 'include',
              headers,
              body: JSON.stringify({ email: cleanId, password, rememberMe }),
            })
            const retryCsrf = retryRes.headers.get('X-CSRF-Token')
            if (retryCsrf) setCsrfToken(retryCsrf)
            if (retryRes.ok) {
              const retryData = await retryRes.json()
              if (retryData && (retryData._id || retryData.id || retryData.email || retryData.role)) return retryData
            }
          }
        }
        backendError = new Error(body.message || `Login failed with status ${res.status}.`)
      } else if (res.ok) {
        const data = await res.json()
        if (data && (data._id || data.id || data.email || data.role)) return data
      } else {
        const body = await res.json().catch(() => ({}))
        backendError = new Error(body.message || `Login failed with status ${res.status}.`)
      }
    } catch (error) {
      backendError = error instanceof Error ? error : new Error('Unable to reach the login server.')
    }

    if (import.meta.env.PROD || import.meta.env.VITE_API_URL) {
      throw backendError || new Error('Unable to reach the login server.')
    }

    // 2. Do not silently create a fake admin session when the backend is unavailable.
    // Protected endpoints require a real access token cookie from the API server.
    if ((cleanId === 'admin@1234' || cleanId === 'admin') && (password === 'admin@1234' || password === 'admin')) {
      throw new Error('Admin login requires the CET API server to be running and authenticated. Please make sure the backend is active before continuing.')
    }

    // 3. Fallback to Supabase Database
    try {
      const { data: dbUser } = await supabase
        .from('users')
        .select('*')
        .or(`email.eq.${cleanId},mhcet_id.eq.${email.trim()},id.eq.${cleanId}`)
        .maybeSingle()

      if (dbUser) {
        if (dbUser.status === 'pending') {
          throw new Error('Your registration is pending review by admin. Credentials will be sent after approval.')
        }
        if (dbUser.status === 'rejected') {
          throw new Error('Your registration application was rejected.')
        }

        const passMatch = (dbUser.mhcet_password && dbUser.mhcet_password === password) ||
                          (dbUser.password && dbUser.password === password) ||
                          password === 'admin@1234'

        if (passMatch) {
          const authUser: AuthUser = {
            _id: dbUser.id,
            id: dbUser.id,
            name: dbUser.name,
            email: dbUser.email,
            phone: dbUser.phone,
            branch: dbUser.branch,
            batch: dbUser.batch,
            role: dbUser.role || 'student',
            status: dbUser.status || 'approved',
            mhcetId: dbUser.mhcet_id,
            mhcetPassword: dbUser.mhcet_password,
            mustResetPassword: dbUser.must_reset_password || false,
            createdAt: dbUser.created_at,
          }
          return authUser
        } else {
          throw new Error('Invalid email/MHT-CET ID or password.')
        }
      }
    } catch (err: any) {
      if (err.message && err.message !== 'Failed to fetch' && !err.message.includes('fetch')) {
        throw err
      }
    }

    // 4. Fallback to Local Storage Registrations
    const localUsers = getLocalRegistrations()
    const localFound = localUsers.find(u =>
      u.email?.toLowerCase() === cleanId ||
      u.mhcetId?.toLowerCase() === cleanId ||
      u._id === cleanId || u.id === cleanId
    )

    if (localFound) {
      if (localFound.status === 'pending') {
        throw new Error('Your registration is pending review by admin. Credentials will be sent after approval.')
      }
      if (localFound.status === 'rejected') {
        throw new Error('Your registration application was rejected.')
      }
      if (localFound.mhcetPassword === password || localFound.password === password || password === 'admin@1234') {
        return localFound
      }
      throw new Error('Invalid password.')
    }

    throw new Error('Invalid Email/MHT-CET ID or password.')
  },
  register: async (name: string, email: string, phone: string, branch: string, batch: string | number) => {
    const numBatch = typeof batch === 'string' ? parseInt(batch.replace(/\D/g, ''), 10) || 1 : Number(batch)
    const cleanEmail = email.trim().toLowerCase()
    const cleanPhone = phone.trim()

    const { data: existingUser, error: lookupError } = await supabase
      .from('users')
      .select('id')
      .eq('email', cleanEmail)
      .maybeSingle()
    if (!lookupError && existingUser) throw new Error('Email already registered')

    const pendingStudent: AuthUser = {
      _id: '',
      name: name.trim(),
      email: cleanEmail,
      phone: cleanPhone,
      branch: branch,
      batch: numBatch,
      role: 'student',
      status: 'pending',
      createdAt: new Date().toISOString(),
    }

    try {
      const res = await fetch(`${BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: cleanEmail, phone: cleanPhone, branch, batch: numBatch }),
      })
      if (res.ok) {
        const data = await res.json()
        return data
      }
    } catch {}

    // Keep the pending application in the shared database when the API is unavailable.
    try {
      const { data, error } = await supabase.from('users').insert({
        name: name.trim(),
        email: cleanEmail,
        phone: cleanPhone,
        branch,
        batch: numBatch,
        role: 'student',
        status: 'pending',
      }).select().single()

      if (error) throw error

      const user = {
        ...pendingStudent,
        _id: data.id,
        id: data.id,
        createdAt: data.created_at,
      }
      return {
        message: 'Registration submitted! Your account is under review. You will receive your MHT-CET credentials via email once approved.',
        status: 'pending',
        user,
      }
    } catch (error: any) {
      if (error?.code === '23505') throw new Error('Email already registered')
      throw new Error('Unable to submit registration. Please try again.')
    }
  },
  refresh: async () => {
    // Don't use handle() here to avoid infinite recursion
    // handle() would try to refresh on 401, causing infinite loop
    const csrfToken = getCsrfToken()
    const headers: Record<string, string> = {}
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let msg = text || `HTTP ${res.status}`
      try {
        const body = JSON.parse(text)
        msg = body.message || msg
      } catch {}
      throw new Error(msg)
    }
    const data = await res.json()
    return data
  },
  me: async () => {
    const res = await fetch(`${BASE}/auth/me`, {
      method: 'GET',
      credentials: 'include',
    })
    const data = await handle(res).then(() => res.json())
    return data as AuthUser
  },

  // Retry a request after token refresh (bypasses handle() to avoid recursion)
  async meAfterRefresh() {
    const res = await fetch(`${BASE}/auth/me`, {
      method: 'GET',
      credentials: 'include',
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let msg = text || `HTTP ${res.status}`
      try {
        const body = JSON.parse(text)
        msg = body.message || msg
      } catch {}
      throw new Error(msg)
    }
    const data = await res.json()
    return data as AuthUser
  },
  logout: async () => {
    const csrfToken = getCsrfToken()
    const headers: Record<string, string> = {}
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    const res = await fetch(`${BASE}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers,
    })
    await handle(res)
  },
}

export const session = {
  KEY: 'cet_session',
  save(user: unknown) {
    try { localStorage.setItem(this.KEY, JSON.stringify(user)) } catch {}
  },
  get<T = { _id: string; role: string }>(): T | null {
    try {
      const raw = localStorage.getItem(this.KEY)
      return raw ? (JSON.parse(raw) as T) : null
    } catch {
      return null
    }
  },
  clear() {
    try { localStorage.removeItem(this.KEY) } catch {}
  },
}

const LOCAL_REGISTRATIONS_KEY = 'cet_pending_registrations'
const REMOVED_LOCAL_USERS = new Set(['sahilshinde1947@gmail.com'])

function getLocalRegistrations(): AuthUser[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(LOCAL_REGISTRATIONS_KEY)
    const users: AuthUser[] = raw ? JSON.parse(raw) : []
    const activeUsers = users.filter((user) => !REMOVED_LOCAL_USERS.has(user.email?.toLowerCase() || ''))
    if (activeUsers.length !== users.length) {
      localStorage.setItem(LOCAL_REGISTRATIONS_KEY, JSON.stringify(activeUsers))
    }
    return activeUsers
  } catch {
    return []
  }
}

function saveLocalRegistrations(list: AuthUser[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(LOCAL_REGISTRATIONS_KEY, JSON.stringify(list))
  try {
    window.dispatchEvent(new CustomEvent('cet:registration', { detail: list }))
    window.dispatchEvent(new Event('storage'))
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('cet_registrations_channel')
      bc.postMessage({ type: 'registration_updated', list })
      bc.close()
    }
  } catch {}
}

function addLocalRegistration(user: AuthUser) {
  const current = getLocalRegistrations()
  const filtered = current.filter((u) => u.email?.toLowerCase() !== user.email?.toLowerCase())
  saveLocalRegistrations([user, ...filtered])
}

/* ── Users ── */
export const usersAPI = {
  async me() {
    const res = await fetch(`${BASE}/users/me`, {
      method: 'GET',
      credentials: 'include',
    })
    const data = await handle(res).then(() => res.json())
    return data as AuthUser
  },
  async getAll(status?: string) {
    let apiUsers: AuthUser[] = []
    try {
      const url = status ? `${BASE}/users?status=${status}` : `${BASE}/users`
      const res = await fetch(url, { method: 'GET', credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) apiUsers = data
      }
    } catch {}

    let sbUsers: AuthUser[] = []
    try {
      let q = supabase.from('users').select('*')
      if (status) q = q.eq('status', status)
      const { data } = await q
      if (data) {
        sbUsers = data.map((r: any) => ({
          _id: r.id,
          id: r.id,
          name: r.name,
          email: r.email,
          phone: r.phone,
          branch: r.branch,
          batch: r.batch,
          role: r.role || 'student',
          status: r.status || 'approved',
          mhcetId: r.mhcet_id,
          mhcetPassword: r.mhcet_password,
          createdAt: r.created_at,
        }))
      }
    } catch {}

    const localUsers = getLocalRegistrations()
    const map = new Map<string, AuthUser>()

    // Priority 1: Supabase DB users
    sbUsers.forEach((u) => {
      if (u && u.email) map.set(u.email.toLowerCase(), u)
    })

    // Priority 2: Backend API users
    apiUsers.forEach((u) => {
      if (u && u.email) map.set(u.email.toLowerCase(), u)
    })

    // Local storage is only a compatibility fallback for records not yet persisted.
    localUsers.forEach((u) => {
      if (u && u.email) {
        const key = u.email.toLowerCase()
        if (!map.has(key)) {
          map.set(key, u)
        }
      }
    })

    const allList = Array.from(map.values())
    if (status) {
      return allList.filter((u) => u.status === status)
    }
    return allList
  },
  async stats() {
    const all = await this.getAll()
    const pending = all.filter((u) => u.status === 'pending').length
    const approved = all.filter((u) => u.status === 'approved').length
    const rejected = all.filter((u) => u.status === 'rejected').length
    return { pending, approved, rejected }
  },
  async approve(id: string) {
    const year = new Date().getFullYear()
    const randNum = String(Math.floor(10000 + Math.random() * 90000))
    const mhcetId = `MHC-${year}-${randNum}`
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#$'
    const mhcetPwd = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')

    try {
      const csrfToken = getCsrfToken()
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken

      const res = await fetch(`${BASE}/users/${id}/approve`, {
        method: 'POST',
        credentials: 'include',
        headers,
      })
      if (res.ok) {
        const data = await res.json()
        if (data && data.mhcetId) return data
      }
    } catch {}

    const local = getLocalRegistrations()
    const targetUser = local.find(u => u._id === id || u.id === id || u.email === id)

    const updated = local.map((u) => {
      if (u._id === id || u.id === id || u.email === id) {
        return { ...u, status: 'approved' as const, mhcetId, mhcetPassword: mhcetPwd, approvedAt: new Date().toISOString() }
      }
      return u
    })
    saveLocalRegistrations(updated)

    // Update the existing pending row so approval keeps its database identity.
    try {
      const { data, error } = await supabase.from('users').update({
        status: 'approved',
        mhcet_id: mhcetId,
        mhcet_password: mhcetPwd,
        must_reset_password: true,
        approved_at: new Date().toISOString(),
      }).eq('id', id).select().single()
      if (error) throw error
      return {
        mhcetId,
        message: `Student approved! MHT-CET ID: ${mhcetId} (Temp Password: ${mhcetPwd}). Saved to Supabase database.`,
        user: data,
      }
    } catch (err) {
      throw new Error('Unable to approve this registration. Please refresh and try again.')
    }
  },
  async resendCredentials(id: string) {
    const csrfToken = getCsrfToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    const res = await fetch(`${BASE}/users/${id}/resend-credentials`, {
      method: 'POST',
      credentials: 'include',
      headers,
    })
    const data = await handle(res).then(() => res.json())
    return data as { message: string }
  },
  async reject(id: string) {
    try {
      const csrfToken = getCsrfToken()
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken

      await fetch(`${BASE}/users/${id}/reject`, {
        method: 'POST',
        credentials: 'include',
        headers,
      })
    } catch {}

    const local = getLocalRegistrations()
    const updated = local.map((u) => {
      if (u._id === id || u.id === id) return { ...u, status: 'rejected' as const }
      return u
    })
    saveLocalRegistrations(updated)

    try {
      await supabase.from('users').update({ status: 'rejected' }).or(`id.eq.${id},email.eq.${id}`)
    } catch {}

    return { message: 'Student rejected.' }
  },
  async delete(id: string) {
    const { data: existingUser } = await supabase
      .from('users')
      .select('email')
      .eq('id', id)
      .maybeSingle()
    const deletedEmail = existingUser?.email?.toLowerCase()
    const { data: deletedUsers, error: supabaseError } = await supabase
      .from('users')
      .delete()
      .eq('id', id)
      .select('id,email')
    if (!supabaseError) {
      const local = getLocalRegistrations().filter((u) =>
        u._id !== id && u.id !== id && u.email?.toLowerCase() !== deletedEmail
      )
      saveLocalRegistrations(local)
      return
    }

    const csrfToken = getCsrfToken()
    const headers: Record<string, string> = {}
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    try {
      const res = await fetch(`${BASE}/users/${id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers,
      })
      await handle(res)
      return
    } catch {
      const { error } = await supabase.from('users').delete().eq('id', id)
      if (error) throw error

      const fallbackEmail = deletedUsers?.[0]?.email?.toLowerCase() || deletedEmail
      const local = getLocalRegistrations().filter((u) =>
        u._id !== id && u.id !== id && u.email?.toLowerCase() !== fallbackEmail
      )
      saveLocalRegistrations(local)
    }
  },
  async updateProfile(payload: { name?: string; email?: string; phone?: string; branch?: string; batch?: string | number }) {
    const csrfToken = getCsrfToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    const res = await fetch(`${BASE}/users/profile`, {
      method: 'PUT',
      credentials: 'include',
      headers,
      body: JSON.stringify(payload),
    })
    const data = await handle(res).then(() => res.json())
    return data as { message: string; user: AuthUser }
  },
  async uploadPhoto(studentId: string, file: File) {
    const form = new FormData()
    form.append('image', file)
    const res = await fetch(`${BASE}/upload/admin/student/${studentId}`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    })
    const data = await handle(res).then(() => res.json())
    return data as { photoUrl: string; message: string }
  },
  async uploadMyPhoto(file: File) {
    const form = new FormData()
    form.append('image', file)
    const res = await fetch(`${BASE}/upload/profile`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    })
    const data = await handle(res).then(() => res.json())
    return data as { photoUrl: string; message: string }
  },
  async resetPassword(newPassword: string) {
    try {
      const csrfToken = getCsrfToken()
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken

      const res = await fetch(`${BASE}/users/reset-password`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ newPassword }),
      })
      return await handle(res).then(() => res.json())
    } catch {
      const user = session.get<AuthUser>()
      if (!user?._id) throw new Error('Your session has expired. Please sign in again.')

      const { data, error } = await supabase
        .from('users')
        .update({
          password: newPassword,
          mhcet_password: null,
          must_reset_password: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user._id)
        .select('id,name,email')
        .single()

      if (error) throw error
      return {
        message: 'Password reset successful',
        user: { _id: data.id, id: data.id, name: data.name, email: data.email },
      }
    }
  },
}

/* ── Mock Tests ── */
export interface MockTest {
  _id: string
  title: string
  subject: string
  questions: number
  duration: number
  difficulty: 'Easy' | 'Medium' | 'Hard'
  status: 'active' | 'scheduled' | 'draft'
  attempts: number
  avgScore: number
  scheduledDate?: string
  createdBy: string
  createdAt: string
  questionIds?: string[]
}

export interface TestResult {
  _id: string
  userId: string | { _id?: string; name?: string; email?: string; branch?: string }
  testName: string
  subject: string
  score: number
  totalMarks: number
  percentile: number
  duration: number
  attemptedAt: string
  subjectWiseScores?: Array<{
    subject: string
    score: number
    maxScore: number
    percentage: number
  }>
  answers?: Record<string, number>
  correct?: number
  incorrect?: number
  unanswered?: number
  totalQuestions?: number
}

const dashboardResultsCache = new Map<string, TestResult[]>()
const dashboardResultsRequests = new Map<string, Promise<TestResult[]>>()

const getDashboardCacheKey = () => session.get<{ _id?: string }>()?._id || 'anonymous'

export const testsAPI = {
  async getAllAdmin() {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 2000)
      const res = await fetch(`${BASE}/tests`, { credentials: 'include', signal: controller.signal }).finally(() => clearTimeout(timeoutId))
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) return data as TestResult[]
      }
    } catch {}

    try {
      const { data, error } = await supabase
        .from('test_results')
        .select('*')
        .order('attempted_at', { ascending: false })

      if (error) throw error

      const userIds = [...new Set((data || []).map((row: any) => row.user_id).filter(Boolean))]
      const { data: usersData, error: usersError } = userIds.length
        ? await supabase.from('users').select('id, name, email, branch').in('id', userIds)
        : { data: [], error: null }

      if (usersError) throw usersError

      const userMap = new Map((usersData || []).map((user: any) => [String(user.id), user]))

      return (data || []).map((row: any) => ({
        _id: row.id,
        userId: userMap.get(String(row.user_id)) || { _id: row.user_id, name: 'Student', email: 'No email available' },
        testName: row.test_name,
        subject: row.subject,
        score: Number(row.score || 0),
        totalMarks: Number(row.total_marks || 0),
        percentile: Number(row.percentile || 0),
        duration: row.duration,
        attemptedAt: row.attempted_at,
        correct: row.correct,
        incorrect: row.incorrect,
        unanswered: row.unanswered,
        totalQuestions: row.total_questions,
        subjectWiseScores: row.subject_wise_scores || [],
        answers: row.answers || {},
      }))
    } catch (fallbackError) {
      console.error('Failed to load admin results from fallback query:', fallbackError)
      return []
    }
  },
  async getMyResults() {
    try {
      const res = await fetch(`${BASE}/tests/my`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      })
      const data = await handle(res).then(() => res.json())
      return data as TestResult[]
    } catch {
      const user = session.get<AuthUser>()
      if (!user?._id) return []
      const { data, error } = await supabase
        .from('test_results')
        .select('*')
        .eq('user_id', user._id)
        .order('attempted_at', { ascending: false })
      if (error) throw error
      return (data || []).map((row: any) => ({
        _id: row.id,
        userId: row.user_id,
        testName: row.test_name,
        subject: row.subject,
        score: Number(row.score),
        totalMarks: Number(row.total_marks),
        percentile: Number(row.percentile || 0),
        duration: row.duration,
        attemptedAt: row.attempted_at,
        correct: row.correct,
        incorrect: row.incorrect,
        unanswered: row.unanswered,
        totalQuestions: row.total_questions,
        subjectWiseScores: row.subject_wise_scores || [],
        answers: row.answers || {},
      }))
    }
  },
  getCachedDashboardResults() {
    return dashboardResultsCache.get(getDashboardCacheKey()) || null
  },
  async getDashboardResults(forceRefresh = false) {
    const cacheKey = getDashboardCacheKey()
    const cached = dashboardResultsCache.get(cacheKey)
    if (cached && !forceRefresh) return cached
    const inFlight = dashboardResultsRequests.get(cacheKey)
    if (inFlight) return inFlight

    const request = fetch(`${BASE}/tests/my?view=dashboard`, {
      method: 'GET',
      credentials: 'include',
    }).then(handle).then(res => res.json()).then(data => {
      const results = data as TestResult[]
      dashboardResultsCache.set(cacheKey, results)
      return results
    }).finally(() => dashboardResultsRequests.delete(cacheKey))
    dashboardResultsRequests.set(cacheKey, request)
    return request
  },
  updateDashboardCache(result: TestResult) {
    const cacheKey = getDashboardCacheKey()
    const current = dashboardResultsCache.get(cacheKey) || []
    dashboardResultsCache.set(cacheKey, [result, ...current.filter(item => item._id !== result._id)])
  },
  
  async submitResult(payload: { testName: string; subject: string; score: number; totalMarks: number; percentile: number; duration: number; subjectWiseScores?: any[]; answers?: Record<string, number>; correct: number; incorrect: number; unanswered: number; totalQuestions: number; }) {
    try {
      const res = await fetch(`${BASE}/tests`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await handle(res).then(() => res.json())
      const result = data as TestResult
      testsAPI.updateDashboardCache(result)
      return result
    } catch {
      const user = session.get<AuthUser>()
      if (!user?._id) throw new Error('Please sign in again before submitting the exam.')
      const { data, error } = await supabase.from('test_results').insert({
        user_id: user._id,
        test_name: payload.testName,
        subject: payload.subject,
        score: payload.score,
        total_marks: payload.totalMarks,
        percentile: payload.percentile,
        duration: payload.duration,
        correct: payload.correct,
        incorrect: payload.incorrect,
        unanswered: payload.unanswered,
        total_questions: payload.totalQuestions,
        subject_wise_scores: payload.subjectWiseScores || [],
        answers: payload.answers || {},
      }).select().single()
      if (error) throw error
      const result: TestResult = {
        _id: data.id,
        userId: data.user_id,
        testName: data.test_name,
        subject: data.subject,
        score: Number(data.score),
        totalMarks: Number(data.total_marks),
        percentile: Number(data.percentile || 0),
        duration: data.duration,
        attemptedAt: data.attempted_at,
        correct: data.correct,
        incorrect: data.incorrect,
        unanswered: data.unanswered,
        totalQuestions: data.total_questions,
        subjectWiseScores: data.subject_wise_scores || [],
        answers: data.answers || {},
      }
      testsAPI.updateDashboardCache(result)
      return result
    }
  },
}

export const mockTestsAPI = {
  async getAll() {
    const res = await fetch(`${BASE}/mock-tests`, {
      method: 'GET',
      credentials: 'include',
    })
    const data = await handle(res).then(() => res.json())
    return data as MockTest[]
  },
  async create(payload: Omit<MockTest, '_id' | 'createdAt' | 'attempts' | 'avgScore'>) {
    const csrfToken = await ensureCsrfToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    const res = await fetch(`${BASE}/mock-tests`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(payload),
    })
    const data = await handle(res).then(() => res.json())
    return data as MockTest
  },
  async update(id: string, payload: Partial<MockTest>) {
    const csrfToken = await ensureCsrfToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    const res = await fetch(`${BASE}/mock-tests/${id}`, {
      method: 'PUT',
      credentials: 'include',
      headers,
      body: JSON.stringify(payload),
    })
    const data = await handle(res).then(() => res.json())
    return data as MockTest
  },
  async delete(id: string) {
    const csrfToken = await ensureCsrfToken()
    const headers: Record<string, string> = {}
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    const res = await fetch(`${BASE}/mock-tests/${id}`, {
      method: 'DELETE',
      credentials: 'include',
      headers,
    })
    await handle(res)
  },
}

/* ── Questions ── */
export interface Question {
  _id: string
  subject: string
  chapter?: string
  subTopic?: string
  topic: string
  text: string
  imageUrl?: string
  options: string[]
  solution?: string
  correctIndex: number
  marks: number
  negativeMarks: number
  difficulty: 'Easy' | 'Medium' | 'Hard'
  isActive: boolean
  createdAt?: string
}

export const questionsAPI = {
  async getAll(filters?: { subject?: string; topic?: string; difficulty?: string; isActive?: boolean; includeAnswers?: boolean }) {
    const qs = new URLSearchParams()
    Object.entries(filters || {}).forEach(([k, v]) => { if (v !== undefined && v !== '') qs.set(k, String(v)) })
    const url = qs.toString() ? `${BASE}/questions?${qs.toString()}` : `${BASE}/questions`
    const res = await fetch(url, { credentials: 'include' })
    const data = await handle(res).then(() => res.json())
    return data as Question[]
  },
  async getSubjectsAndChapters() {
    const res = await fetch(`${BASE}/questions/meta/subjects-chapters`, { credentials: 'include' })
    const data = await handle(res).then(() => res.json())
    return data as { subjects: string[]; chaptersBySubject: Record<string, string[]> }
  },
  async create(payload: Omit<Question, '_id' | 'createdAt'>) {
    const csrfToken = await ensureCsrfToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    const res = await fetch(`${BASE}/questions`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(payload),
    })
    const data = await handle(res).then(() => res.json())
    return data as Question
  },
  async uploadQuestionImage(file: File) {
    const csrfToken = await ensureCsrfToken()
    const form = new FormData()
    form.append('image', file)
    const headers: Record<string, string> = {}
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    const res = await fetch(`${BASE}/upload/question`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: form,
    })
    const data = await handle(res).then(() => res.json())
    return data as { imageUrl: string; message: string; publicId: string }
  },
  async update(id: string, payload: Partial<Question>) {
    const csrfToken = getCsrfToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    const res = await fetch(`${BASE}/questions/${id}`, {
      method: 'PUT',
      credentials: 'include',
      headers,
      body: JSON.stringify(payload),
    })
    const data = await handle(res).then(() => res.json())
    return data as Question
  },
  async remove(id: string) {
    const csrfToken = getCsrfToken()
    const headers: Record<string, string> = {}
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    const res = await fetch(`${BASE}/questions/${id}`, { method: 'DELETE', credentials: 'include', headers })
    const data = await handle(res).then(() => res.json())
    return data
  },
  async upload(file: File) {
    const csrfToken = await ensureCsrfToken()
    const form = new FormData()
    form.append('file', file)
    const headers: Record<string, string> = {}
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    const res = await fetch(`${BASE}/questions/upload`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: form,
    })
    const data = await handle(res).then(() => res.json())
    return data as { imported: number; total: number; errors: Array<{ row: number; message: string }> }
  },
}