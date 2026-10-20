export const getApiUrl = (): string => {
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    return window.location.origin
  }

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
  const fallbackApiUrl = 'https://cet-portal-api.onrender.com'
  return (configuredApiUrl || fallbackApiUrl).replace(/\/$/, '')
}

const API_URL = getApiUrl()
const BASE = `${API_URL}/api`


let memoryCsrfToken: string | null = null
const CSRF_REFRESH_AGE_MS = 90 * 60 * 1000

const isCsrfTokenFresh = (token: string): boolean => {
  const issuedAt = Number(token.split('.')[0])
  return Number.isFinite(issuedAt) && Date.now() - issuedAt < CSRF_REFRESH_AGE_MS
}

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
  if (cookieToken && isCsrfTokenFresh(cookieToken)) {
    memoryCsrfToken = cookieToken
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem('csrfToken', cookieToken)
      } catch {}
    }
    return cookieToken
  }

  if (memoryCsrfToken && isCsrfTokenFresh(memoryCsrfToken)) return memoryCsrfToken

  if (typeof window !== 'undefined' && window.localStorage) {
    const stored = window.localStorage.getItem('csrfToken')
    if (stored && isCsrfTokenFresh(stored)) {
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

export class SessionExpiredError extends Error {
  readonly code = 'SESSION_EXPIRED'

  constructor(message = 'Your session expired because you were inactive. Please sign in again.') {
    super(message)
    this.name = 'SessionExpiredError'
  }
}

export class ApiResponseError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null = null) {
    super(message)
    this.name = 'ApiResponseError'
  }
}

const nativeFetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis)
const apiOrigin = new URL(BASE).origin
const apiPath = new URL(BASE).pathname
let refreshPromise: Promise<void> | null = null
let sessionCheckPromise: Promise<AuthenticatedSession> | null = null

const expireClientSession = (message?: string) => {
  const hadSession = Boolean(session.get())
  session.clear()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('auth:expired', { detail: { hadSession, message } }))
  }
}

const fetch: typeof globalThis.fetch = async (input, init) => {
  const requestUrl = new URL(input instanceof Request ? input.url : String(input), BASE)
  const requestPath = requestUrl.pathname
  const bypassRefresh = requestUrl.origin !== apiOrigin || [
    `${apiPath}/auth/login`,
    `${apiPath}/auth/register`,
    `${apiPath}/auth/csrf`,
    `${apiPath}/auth/refresh`,
    `${apiPath}/auth/logout`,
  ].includes(requestPath)
  const requestInit: RequestInit = { ...init, credentials: 'include' }
  const method = (requestInit.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()

  if (!bypassRefresh && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const headers = new Headers(requestInit.headers || (input instanceof Request ? input.headers : undefined))
    if (!headers.has('X-CSRF-Token')) {
      const csrfToken = await ensureCsrfToken()
      if (csrfToken) headers.set('X-CSRF-Token', csrfToken)
    }
    requestInit.headers = headers
  }

  let response = await nativeFetch(input, requestInit)
  if (response.status !== 401 || bypassRefresh) {
    const isBackgroundRequest = requestUrl.searchParams.get('_background') === '1'
    if (response.ok && !bypassRefresh && !isBackgroundRequest && requestPath !== `${apiPath}/auth/session` && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth:activity'))
    }
    return response
  }

  try {
    if (!refreshPromise) {
      refreshPromise = doRefreshTokens().finally(() => { refreshPromise = null })
    }
    await refreshPromise
  } catch (error) {
    if (error instanceof SessionExpiredError) expireClientSession(error.message)
    throw error
  }

  response = await nativeFetch(input, requestInit)
  if (response.status === 401) {
    const body = await response.clone().json().catch(() => ({}))
    const error = new SessionExpiredError(body.message)
    expireClientSession(error.message)
    throw error
  }
  const isBackgroundRequest = requestUrl.searchParams.get('_background') === '1'
  if (response.ok && !bypassRefresh && !isBackgroundRequest && requestPath !== `${apiPath}/auth/session` && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('auth:activity'))
  }
  return response
}

async function handle(res: Response) {
  const resCsrf = res.headers.get('X-CSRF-Token')
  if (resCsrf) setCsrfToken(resCsrf)

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let msg = text || `HTTP ${res.status}`
    let details: any = undefined
    let code: string | null = null
    let retryAfterMs: number | undefined
    try {
      const body = JSON.parse(text)
      msg = body.message || msg
      details = body.details
      code = typeof body.code === 'string' ? body.code : null
      if (res.status === 429 && Number.isFinite(Number(body.retryAfter)) && Number(body.retryAfter) > 0) {
        retryAfterMs = Number(body.retryAfter) * 1000
      }
      if (body.code === 'MAINTENANCE_MODE' && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('maintenance:active', { detail: { message: msg } }))
      }
    } catch {}
    const error = new ApiResponseError(msg, res.status, code)
    if (details !== undefined) Object.assign(error, { details })
    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After')
      if (retryAfter) {
        const seconds = Number(retryAfter)
        const retryAfterMs = Number.isFinite(seconds)
          ? Math.max(0, seconds * 1000)
          : Math.max(0, Date.parse(retryAfter) - Date.now())
        if (Number.isFinite(retryAfterMs)) {
          Object.assign(error, { retryAfterMs })
        }
      }
    }
    if (retryAfterMs !== undefined) Object.assign(error, { retryAfterMs })
    throw error
  }
  return res
}

/**
 * Refresh access token using refresh token (internal, doesn't use handle to avoid recursion)
 */
async function doRefreshTokens(): Promise<void> {
  const csrfToken = await ensureCsrfToken()
  const headers: Record<string, string> = {}
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken

  const res = await nativeFetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let message = text || `HTTP ${res.status}`
    let code = ''
    try {
      const body = JSON.parse(text)
      message = body.message || message
      code = body.code || ''
    } catch {}
    if (res.status === 401 || res.status === 403) {
      if (code === 'SESSION_EXPIRED') throw new SessionExpiredError(message)
      throw new SessionExpiredError(message)
    }
    throw new ApiResponseError(message, res.status)
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
  adminRole?: string
  status?: 'pending' | 'approved' | 'rejected'
  phone?: string
  branch?: string
  examType?: string | null
  guardianEmail?: string | null
  parentResultEmailConsent?: boolean
  mhcetId?: string
  createdAt?: string
  mustResetPassword?: boolean
  initialPasswordAvailable?: boolean
  expiresAt?: string
  inactivityTimeoutSeconds?: number
  batch?: number
  photo?: string
}

export interface AuthenticatedSession {
  authenticated: boolean
  expiresAt: string
  inactivityTimeoutSeconds: number
  user: AuthUser
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
  invalidateUserReadCache()
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

    let backendError: Error | null = null
    try {
      const csrfToken = await ensureCsrfToken()
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)

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
      if (error instanceof DOMException && error.name === 'AbortError') {
        backendError = new Error('The authentication server took too long to respond. Please try again.')
      } else {
        backendError = error instanceof Error ? error : new Error('Unable to reach the login server.')
      }
    }

    throw backendError || new Error('Unable to reach the login server.')
  },
  setupPassword: async (token: string, newPassword: string) => {
    const csrfToken = await ensureCsrfToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken
    const res = await fetch(`${BASE}/auth/setup-password`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ token, newPassword }),
    })
    return await handle(res).then(response => response.json()) as { success: boolean; message: string }
  },
  register: async (name: string, email: string, phone: string, branch: string, batch: string | number) => {
    const numBatch = Number(batch)
    const cleanEmail = email.trim().toLowerCase()
    const cleanPhone = phone.trim()
    const res = await fetch(`${BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), email: cleanEmail, phone: cleanPhone, branch, batch: numBatch }),
    })
    const data = await handle(res).then(response => response.json())
    invalidateUserReadCache()
    return data
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
  recordActivity: async (): Promise<{ expiresAt: string; inactivityTimeoutSeconds: number }> => {
    const res = await fetch(`${BASE}/auth/activity`, {
      method: 'POST',
      credentials: 'include',
    })
    const data = await handle(res).then(response => response.json())
    return {
      expiresAt: data.expiresAt,
      inactivityTimeoutSeconds: data.inactivityTimeoutSeconds,
    }
  },
  checkSession: async (): Promise<AuthenticatedSession> => {
    if (!sessionCheckPromise) {
      sessionCheckPromise = (async () => {
        const res = await fetch(`${BASE}/auth/session`, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        })
        return await handle(res).then(response => response.json() as Promise<AuthenticatedSession>)
      })().finally(() => { sessionCheckPromise = null })
    }
    return sessionCheckPromise
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
    const csrfToken = await ensureCsrfToken()
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

const READ_CACHE_TTL_MS = 15_000
const readCache = new Map<string, { expiresAt: number; value: unknown }>()
type InFlightRead = {
  promise: Promise<unknown>
  controller: AbortController
  consumers: number
  completed: boolean
}
const inFlightReads = new Map<string, InFlightRead>()
let readCacheIdentity: string | null = null
const MAX_CACHED_READS = 100

const getReadCacheIdentity = () => {
  const user = session.get<AuthUser>()
  return user ? `${user.id || user._id}:${user.role || ''}` : null
}

const clearUserReadCache = () => {
  readCache.clear()
  inFlightReads.forEach(request => request.controller.abort())
  inFlightReads.clear()
}

const invalidateUserReadCache = () => clearUserReadCache()

const sleep = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) {
    reject(new DOMException('The request was aborted.', 'AbortError'))
    return
  }
  const timer = globalThis.setTimeout(() => {
    signal.removeEventListener('abort', abort)
    resolve()
  }, milliseconds)
  const abort = () => {
    globalThis.clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    reject(new DOMException('The request was aborted.', 'AbortError'))
  }
  signal.addEventListener('abort', abort, { once: true })
})

const subscribeToRead = <T>(request: InFlightRead, signal?: AbortSignal): Promise<T> => {
  if (signal?.aborted) return Promise.reject(new DOMException('The request was aborted.', 'AbortError'))
  request.consumers += 1
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const release = () => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      request.consumers -= 1
      if (request.consumers === 0 && !request.completed) {
        queueMicrotask(() => {
          if (request.consumers !== 0 || request.completed) return
          for (const [key, current] of inFlightReads) {
            if (current === request) inFlightReads.delete(key)
          }
          request.controller.abort()
        })
      }
    }
    const abort = () => {
      release()
      reject(new DOMException('The request was aborted.', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    request.promise.then(
      value => {
        if (settled) return
        release()
        resolve(value as T)
      },
      error => {
        if (settled) return
        release()
        reject(error)
      },
    )
  })
}

const cachedRead = async <T>(
  cacheKey: string,
  load: (signal: AbortSignal) => Promise<T>,
  { refresh = false, ttl = READ_CACHE_TTL_MS, signal }: { refresh?: boolean; ttl?: number; signal?: AbortSignal } = {},
): Promise<T> => {
  if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError')
  const identity = getReadCacheIdentity()
  if (identity !== readCacheIdentity) {
    clearUserReadCache()
    readCacheIdentity = identity
  }
  const key = `${identity || 'anonymous'}:${cacheKey}`
  const cached = readCache.get(key)
  if (!refresh && cached && cached.expiresAt > Date.now()) return cached.value as T
  const existing = inFlightReads.get(key)
  if (existing) return subscribeToRead<T>(existing, signal)

  const entry: InFlightRead = {
    controller: new AbortController(),
    consumers: 0,
    completed: false,
    promise: Promise.resolve(),
  }
  entry.promise = (async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const value = await load(entry.controller.signal)
        if (entry.controller.signal.aborted) throw new DOMException('The request was aborted.', 'AbortError')
        for (const [existingKey, entry] of readCache) {
          if (entry.expiresAt <= Date.now()) readCache.delete(existingKey)
        }
        readCache.set(key, { value, expiresAt: Date.now() + ttl })
        while (readCache.size > MAX_CACHED_READS) {
          const oldestKey = readCache.keys().next().value
          if (oldestKey === undefined) break
          readCache.delete(oldestKey)
        }
        return value
      } catch (error) {
        if (entry.controller.signal.aborted) throw error
        if (!(error instanceof ApiResponseError) || error.status !== 429 || attempt >= 2) throw error
        const retryAfterMs = Number((error as ApiResponseError & { retryAfterMs?: number }).retryAfterMs)
        if (retryAfterMs > 30_000) throw error
        const baseDelay = Number.isFinite(retryAfterMs) && retryAfterMs > 0
          ? retryAfterMs
          : 1000 * (2 ** attempt)
        await sleep(baseDelay + Math.random() * 250, entry.controller.signal)
      }
    }
  })().finally(() => {
    entry.completed = true
    if (inFlightReads.get(key) === entry) inFlightReads.delete(key)
  })
  inFlightReads.set(key, entry)
  return subscribeToRead<T>(entry, signal)
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
  async getAll(status?: string, options: { refresh?: boolean; signal?: AbortSignal } = {}) {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    const query = params.size ? `?${params.toString()}` : ''
    return cachedRead(`users:list:${status || 'all'}`, async signal => {
      const res = await fetch(`${BASE}/users${query}`, { method: 'GET', credentials: 'include', signal })
      const data = await handle(res).then(response => response.json())
      return data as AuthUser[]
    }, { refresh: options.refresh, signal: options.signal })
  },
  async getPage(options: {
    status?: string
    page?: number
    pageSize?: number
    search?: string
    branch?: string
    batch?: string
    refresh?: boolean
    signal?: AbortSignal
  } = {}) {
    const params = new URLSearchParams({
      page: String(options.page || 1),
      pageSize: String(options.pageSize || 50),
    })
    if (options.status) params.set('status', options.status)
    if (options.search?.trim()) params.set('search', options.search.trim())
    if (options.branch && options.branch !== 'All') params.set('branch', options.branch)
    if (options.batch && options.batch !== 'All') params.set('batch', options.batch)
    const key = `users:page:${params.toString()}`
    return cachedRead(key, async signal => {
      const res = await fetch(`${BASE}/users?${params.toString()}`, {
        method: 'GET',
        credentials: 'include',
        signal,
      })
      return await handle(res).then(response => response.json()) as {
        users: AuthUser[]
        total: number
        page: number
        pageSize: number
      }
    }, { refresh: options.refresh, signal: options.signal })
  },
  invalidateCache() {
    invalidateUserReadCache()
  },
  async getStudentReport(id: string, from?: string, to?: string, options: { signal?: AbortSignal } = {}) {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const query = params.size ? `?${params.toString()}` : ''
    const res = await fetch(`${BASE}/users/${encodeURIComponent(id)}/report${query}`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      signal: options.signal,
    })
    const data = await handle(res).then(response => response.json())
    return data as StudentReportData
  },
  async stats(options: { refresh?: boolean; signal?: AbortSignal } = {}) {
    return cachedRead('users:registration-stats', async signal => {
      const res = await fetch(`${BASE}/users/stats`, { method: 'GET', credentials: 'include', signal })
      return await handle(res).then(response => response.json()) as {
        total: number
        pending: number
        approved: number
        rejected: number
      }
    }, { refresh: options.refresh, signal: options.signal })
  },
  async approve(id: string) {
    const csrfToken = await ensureCsrfToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken
    const res = await fetch(`${BASE}/users/${id}/approve`, {
      method: 'POST',
      credentials: 'include',
      headers,
    })
    const result = await handle(res).then(response => response.json())
    invalidateUserReadCache()
    return result
  },
  async resendCredentials(id: string, resetUnrecoverableToken = false) {
    const csrfToken = getCsrfToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    const res = await fetch(`${BASE}/users/${id}/resend-credentials`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ resetUnrecoverableToken }),
    })
    const data = await handle(res).then(() => res.json())
    return data as {
      success: boolean
      status?: 'accepted' | 'delivered' | 'pending' | 'failed' | 'unknown' | 'cancelled' | 'disabled' | 'skipped'
      notificationId?: string | null
      message: string
    }
  },
  async getTemporaryPassword(id: string) {
    const res = await fetch(`${BASE}/users/${encodeURIComponent(id)}/temporary-password`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    })
    const data = await handle(res).then(response => response.json())
    return data as { available: boolean; password: string | null }
  },
  async getTemporaryPasswordStatus(id: string) {
    const res = await fetch(`${BASE}/users/${encodeURIComponent(id)}/temporary-password/status`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    })
    const data = await handle(res).then(response => response.json())
    return data as { available: boolean }
  },
  async resetTemporaryPassword(id: string) {
    const csrfToken = await ensureCsrfToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    const res = await fetch(`${BASE}/users/${encodeURIComponent(id)}/temporary-password/reset`, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers,
      body: JSON.stringify({ confirm: true }),
    })
    const data = await handle(res).then(response => response.json())
    invalidateUserReadCache()
    return data as {
      success: boolean
      available: boolean
      password: string
      emailStatus: string
      message: string
    }
  },
  async reject(id: string) {
    const csrfToken = await ensureCsrfToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken
    const res = await fetch(`${BASE}/users/${id}/reject`, {
      method: 'POST',
      credentials: 'include',
      headers,
    })
    const result = await handle(res).then(response => response.json())
    invalidateUserReadCache()
    return result
  },
  async bulkApprove(ids: string[]) {
    const csrfToken = await ensureCsrfToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken
    const res = await fetch(`${BASE}/users/bulk-approve`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ ids }),
    })
    const result = await handle(res).then(response => response.json())
    invalidateUserReadCache()
    return result
  },
  async bulkReject(ids: string[], reason?: string) {
    const csrfToken = await ensureCsrfToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken
    const res = await fetch(`${BASE}/users/bulk-reject`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ ids, reason }),
    })
    const result = await handle(res).then(response => response.json())
    invalidateUserReadCache()
    return result
  },
  async updateStudent(id: string, updates: Partial<AuthUser>) {
    const csrfToken = await ensureCsrfToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken
    const res = await fetch(`${BASE}/users/${id}`, {
      method: 'PUT',
      credentials: 'include',
      headers,
      body: JSON.stringify(updates),
    })
    const data = await handle(res).then(response => response.json())
    invalidateUserReadCache()
    return data.user
  },
  async delete(id: string) {
    const csrfToken = await ensureCsrfToken()
    const headers: Record<string, string> = {}
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken
    const res = await fetch(`${BASE}/users/${id}`, {
      method: 'DELETE',
      credentials: 'include',
      headers,
    })
    await handle(res)
    invalidateUserReadCache()
  },
  async updateProfile(payload: { name?: string; email?: string; phone?: string; branch?: string; batch?: string | number; examType?: string | null; guardianEmail?: string | null; parentResultEmailConsent?: boolean }) {
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
    invalidateUserReadCache()
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
    invalidateUserReadCache()
    return data as { photoUrl: string; message: string }
  },
  async uploadMyPhoto(file: File) {
    const form = new FormData()
    form.append('image', file)
    const csrfToken = await ensureCsrfToken()
    const headers: Record<string, string> = {}
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken
    const res = await fetch(`${BASE}/upload/profile`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: form,
    })
    const data = await handle(res).then(() => res.json())
    invalidateUserReadCache()
    return data as { photoUrl: string; message: string }
  },
  async removeMyPhoto() {
    const csrfToken = await ensureCsrfToken()
    const headers: Record<string, string> = {}
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken
    const res = await fetch(`${BASE}/upload/profile`, {
      method: 'DELETE',
      credentials: 'include',
      headers,
    })
    const data = await handle(res).then(() => res.json())
    invalidateUserReadCache()
    return data as { message: string }
  },
  async resetPassword(newPassword: string) {
    const csrfToken = await ensureCsrfToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken
    const res = await fetch(`${BASE}/users/reset-password`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ newPassword }),
    })
    return await handle(res).then(() => res.json())
  },
}

/* ── Mock Tests ── */
export interface MockTest {
  _id: string
  title: string
  subject: string
  examType?: string | null
  questions: number
  duration: number
  difficulty: 'Easy' | 'Medium' | 'Hard'
  status: 'active' | 'scheduled' | 'draft'
  maxAttempts?: number
  attempts: number
  avgScore: number
  scheduledDate?: string
  createdBy: string
  createdAt: string
  questionIds?: string[]
}

export type MockTestAssignment = {
  _id: string
  mockTestId: string
  mockTestName: string
  assignedTo: 'all' | 'students' | 'batch' | 'branch' | 'examType'
  studentIds: string[]
  batchId?: number | null
  branch?: string | null
  examType?: string | null
  subject?: string
  questionCount?: number
  totalMarks?: number
  startDateTime: string
  endDateTime: string
  duration: number
  attemptLimit: number | null
  visibility: 'scheduled' | 'available' | 'draft'
  timeZone: string
  schedulingStatus: 'draft' | 'scheduled' | 'active' | 'expired' | 'cancelled'
  activatedAt?: string | null
  expiredAt?: string | null
  resultVisibility: 'immediate' | 'after_close' | 'admin_only' | 'hidden'
  randomizeQuestions: boolean
  randomizeOptions: boolean
  allowBackNavigation: boolean
  allowResume: boolean
  status: 'active' | 'cancelled' | 'archived' | 'Upcoming' | 'Available' | 'In Progress' | 'Completed' | 'Submitted' | 'Expired'
  assignedStudentCount?: number
  attemptsUsed?: number
  hasSubmittedAttempt?: boolean
  attemptsRemaining?: number | null
  attemptCount?: number
  activeAttemptId?: string | null
  results?: Array<{ score: number; totalMarks: number; attemptedAt: string }>
  createdAt?: string
}

export type MockTestAttempt = {
  _id: string
  assignmentId: string
  mockTestId: string
  studentId: string
  startedAt: string
  submittedAt?: string | null
  status: 'in_progress' | 'submitted' | 'expired'
  attemptNumber: number
  score?: number | null
  totalMarks: number
  answers: Record<string, number>
  timeSpent: number
  questionIds: string[]
  optionOrders: Record<string, number[]>
}

export type StartedMockTest = {
  success: boolean
  message: string
  assignment: MockTestAssignment
  attempt: MockTestAttempt
  questions: Array<Omit<Question, 'correctIndex' | 'solution'>>
  resumed: boolean
}

export interface TestResult {
  _id: string
  userId: string | { _id?: string; name?: string; email?: string; branch?: string }
  mockTestId?: string | null
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
  questionIds?: string[]
  correct?: number
  incorrect?: number
  unanswered?: number
  totalQuestions?: number
}

export type NotificationCategory = 'exam_update' | 'test_assignment' | 'result' | 'reminder' | 'system_alert'
export type NotificationPage = 'dashboard' | 'mocktests' | 'results' | 'analytics' | 'settings'
export interface StudentNotification {
  _id: string
  category: NotificationCategory
  title: string
  message: string
  targetPage: NotificationPage
  targetType: 'assignment' | 'result' | null
  targetId: string | null
  readAt: string | null
  createdAt: string
}

export interface StudentReportData {
  success: boolean
  student: Omit<AuthUser, '_id'> & { _id: string; id: string }
  results: Array<Omit<TestResult, '_id' | 'percentile'> & {
    id: string
    mockTestAttemptId?: string | null
    percentile: number | null
    subjectQuestionStats: Record<string, { totalQuestions: number; correct: number; incorrect: number; unattempted: number }>
  }>
  assignments: Array<{
    id: string
    testName: string
    startDateTime: string
    endDateTime: string
    status: string
    visibility: string
  }>
  attempts: Array<{
    id: string
    assignmentId: string
    testName: string
    status: 'in_progress' | 'submitted' | 'expired'
    attemptNumber: number
    startedAt: string
    submittedAt?: string | null
    score?: number | null
    totalMarks: number
    resultId?: string | null
  }>
  reportPeriod: { from: string | null; to: string | null }
}

export interface AdminDashboardOverview {
  stats: {
    totalStudents: number
    totalMockTests: number
    activeMockTests: number
    questionCount: number
    attemptsToday: number
  }
  dailyAttemptCounts: number[]
  yearlyAttemptCounts: number[]
  testResults: TestResult[]
}

const dashboardResultsCache = new Map<string, TestResult[]>()
const dashboardResultsRequests = new Map<string, Promise<TestResult[]>>()

const getDashboardCacheKey = () => session.get<{ _id?: string }>()?._id || 'anonymous'

export const adminDashboardAPI = {
  async getOverview(options: { refresh?: boolean; signal?: AbortSignal } = {}) {
    return cachedRead('admin:dashboard-overview', async signal => {
      const res = await fetch(`${BASE}/admin/dashboard/overview`, {
        credentials: 'include',
        cache: 'no-store',
        signal,
      })
      const data = await handle(res).then(response => response.json())
      return data as AdminDashboardOverview
    }, {
      refresh: options.refresh,
      ttl: 60_000,
      signal: options.signal,
    })
  },
}

export const testsAPI = {
  async getAllAdmin(options: { summaryOnly?: boolean } = {}) {
    const query = options.summaryOnly ? '?summary=true' : ''
    const res = await fetch(`${BASE}/tests${query}`, { credentials: 'include' })
    const data = await handle(res).then(() => res.json())
    if (!Array.isArray(data)) throw new Error('Unable to load test results.')
    return data as TestResult[]
  },
  async getReview(id: string) {
    const res = await fetch(`${BASE}/tests/${encodeURIComponent(id)}/review`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    })
    return await handle(res).then(response => response.json()) as { result: TestResult; questions: Question[] }
  },
  async getMyResults() {
    const res = await fetch(`${BASE}/tests/my`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    })
    const data = await handle(res).then(() => res.json())
    return data as TestResult[]
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
  
  async submitResult(payload: { testName: string; subject: string; score: number; totalMarks: number; percentile: number; duration: number; subjectWiseScores?: any[]; answers?: Record<string, number>; questionIds?: string[]; mockTestId?: string; submissionKey: string; correct: number; incorrect: number; unanswered: number; totalQuestions: number; }) {
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
  },
}

export const adminSettingsAPI = {
  async getEmailNotifications() {
    const res = await fetch(`${BASE}/email/admin`, { credentials: 'include', cache: 'no-store' })
    return await handle(res).then(response => response.json()) as {
      configuration: { senderEmail: string; senderName: string; serviceUrlConfigured: boolean; serviceTokenConfigured: boolean; ready: boolean; error: string | null; setupEncryptionConfigured: boolean }
      notifications: Array<{
        id: string
        notification_type: string
        student_id: string | null
        student_name: string | null
        test_result_id: string | null
        exam_name: string | null
        recipient_email: string
        status: 'pending' | 'accepted' | 'delivered' | 'failed' | 'unknown' | 'cancelled'
        safe_error: string | null
        retry_count: number
        last_attempt_at: string | null
        created_at: string
      }>
    }
  },
  async sendTestEmail() {
    const res = await fetch(`${BASE}/email/admin/test`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    return await handle(res).then(response => response.json()) as { success: boolean; message: string; status: string }
  },
  async validateEmailService() {
    const res = await fetch(`${BASE}/email/admin/validate`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    return await handle(res).then(response => response.json()) as { success: boolean; valid: boolean; message: string }
  },
  async retryEmailNotification(id: string) {
    const res = await fetch(`${BASE}/email/admin/retry/${encodeURIComponent(id)}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    return await handle(res).then(response => response.json()) as { success: boolean; message: string }
  },
  async get() {
    const res = await fetch(`${BASE}/admin/settings`, { credentials: 'include', cache: 'no-store' })
    return await handle(res).then(response => response.json()) as {
      settings: Record<string, string | number | boolean>
      admins: Array<{ id: string; name: string; email: string; role: string; admin_role?: string; status: string; created_at: string }>
      auditLogs: Array<{ id: string; admin_name: string; action: string; module: string; created_at: string; ip_address: string; status: string }>
      userCount: number
    }
  },
  async save(settings: Record<string, string | number | boolean>) {
    const res = await fetch(`${BASE}/admin/settings`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    })
    return await handle(res).then(response => response.json()) as { success: boolean }
  },
  async createAdmin(payload: { name: string; email: string; role: string; clusterId?: string }) {
    const res = await fetch(`${BASE}/admin/settings/admins`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return await handle(res).then(response => response.json()) as {
      success: boolean
      admin: {
        id: string
        name: string
        email: string
        phone: string | null
        role: string
        admin_role: string | null
        status: string | null
        is_locked: boolean | null
        locked_reason: string | null
        cluster_id: string | null
        created_at: string | null
      }
      temporaryPassword: string
    }
  },
  async deleteAdmin(id: string) {
    const res = await fetch(`${BASE}/admin/settings/admins/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    return await handle(res).then(response => response.json()) as { success: boolean }
  },
  async getData(table: string) {
    const res = await fetch(`${BASE}/admin/settings/data/${encodeURIComponent(table)}`, {
      credentials: 'include',
      cache: 'no-store',
    })
    return await handle(res).then(response => response.json()) as Record<string, unknown>[]
  },
}

export interface SuperAdminStats {
  totalStudents: number
  totalAdmins: number
  totalMockTests: number
  totalQuestions: number
  activeExams: number
  todayAttempts: number
  todayRegistrations: number
  lockedAdmins: number | null
  activeAlertsCount: number | null
  todayApiCalls: number | null
  totalApiCalls: number | null
  backupHistoryAvailable: boolean
  lastBackup: {
    id: string
    file_name: string
    file_size_bytes: number
    created_at: string
    status: string
  } | null
  serverQuick: {
    uptimeSeconds: number | null
    processUptime: number
    memoryUsagePercent: number | null
    cpuLoad1m: number | null
  }
}

export interface StorageOptimizationMetrics {
  databaseBytes: number
  tables: Array<{ tableName: string; bytes: number; approximateRows: number }>
  storageBytes: number
  storageObjectCount: number
  sizeTrackedObjects: number
  sha256TrackedObjects: number
  duplicateObjects: number
  buckets: Array<{ bucketId: string; bytes: number; objectCount: number }>
  largestFiles: Array<{ bucketId: string; path: string; bytes: number }>
  measuredAt: string
  history: Array<{
    snapshot_date: string
    captured_at: string
    database_bytes: number
    storage_bytes: number
    object_count: number
  }>
}

export interface SecurityAlert {
  id: string
  alert_type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
  metadata?: Record<string, unknown>
  status: 'active' | 'investigating' | 'resolved'
  resolved_by?: string
  resolved_at?: string
  created_at: string
}

export interface ServerDiagnostics {
  platform: string
  release: string
  arch: string
  hostname: string
  nodeVersion: string
  applicationVersion: string
  environment: string
  processId: number
  database: string
  databaseVersion: string | null
  serverTime: string
  uptimeSeconds: number | null
  processUptimeSeconds: number
  loadAverage: number | null
  loadLabel: string
  loadUnavailableReason: string | null
  cpuUsage: number | null
  cpuUnavailableReason: string | null
  cpuCores: number | null
  diskUsedGB: number | null
  diskTotalGB: number | null
  diskUsage: number | null
  diskUnavailableReason: string | null
  cpu: {
    count: number | null
    model: string | null
    speedMHz: number | null
  }
  systemMemory: {
    totalMB: number | null
    usedMB: number | null
    freeMB: number | null
    usagePercent: number | null
  }
  processMemory: {
    rssMB: number
    heapTotalMB: number
    heapUsedMB: number
    externalMB: number
  }
  timestamp: string
}

export interface ApiAnalytics {
  totalRequests: number
  clientErrors4xx: number
  serverErrors5xx: number
  successfulRequests: number
  rateLimitHits: number
  averageResponseTimeMs: number | null
  rateLimit: {
    limit: number
    used: number
    remaining: number
    windowMs: number
    resetAt: string | null
    storage: string
  } | null
  lastCall: {
    endpoint: string
    method: string
    status_code: number
    response_time_ms: number
    created_at: string
  } | null
  topEndpoints: Array<{
    endpoint: string
    method: string
    count: number
    avgResponseTimeMs: number
  }>
  topAdmins: Array<{ id: string; name: string; email: string; count: number }>
  recentLogs: Array<{
    id: string
    endpoint: string
    method: string
    status_code: number
    response_time_ms: number
    created_at: string
  }>
}

export interface BackupRecord {
  id: string
  backup_type: string
  file_name: string
  file_size_bytes: number
  storage_path: string
  status: string
  error_message?: string
  created_at: string
}

export interface SystemPerformancePoint {
  bucket_start: string
  cpu_usage: number | null
  memory_usage: number | null
  disk_usage: number | null
  load_average: number | null
}

export interface SystemService {
  id: string
  name: string
  status: 'running' | 'stopped' | 'failed' | 'unknown' | 'unavailable'
  uptime?: number | null
  responseTimeMs?: number
  reason?: string
  controllable: boolean
}

export interface SystemLog {
  id: string
  endpoint: string
  method: string
  status_code: number
  response_time_ms: number
  created_at: string
  severity: 'error' | 'warning' | 'info'
  message: string
}

export interface SafeSystemConfig {
  environment: string
  runtime: string
  nodeVersion: string
  applicationVersion: string
  port: number
  database: string
  databaseConfigured: boolean
  redisConfigured: boolean
  csrfProtection: boolean
  sessionStorage: string
}

const superAdminCsrfHeaders = async (): Promise<Record<string, string>> => {
  const token = await ensureCsrfToken()
  return token ? { 'X-CSRF-Token': token } : {}
}

export const superAdminAPI = {
  async getOverview() {
    const res = await fetch(`${BASE}/super-admin/overview`, { credentials: 'include', cache: 'no-store' })
    return await handle(res).then(response => response.json()) as {
      success: boolean
      stats: SuperAdminStats
      admins: Array<{
        id: string
        name: string | null
        email: string
        phone: string | null
        role: string
        admin_role: string | null
        status: string | null
        is_locked: boolean | null
        locked_reason: string | null
        cluster_id: string | null
        created_at: string | null
      }>
      adminDetailsAvailable: boolean
      recentAlerts: SecurityAlert[]
      systemMetrics: Record<string, number | string | null>
      dataWarnings: string[]
    }
  },
  async lockAdmin(id: string, reason?: string) {
    const csrfHeaders = await superAdminCsrfHeaders()
    const res = await fetch(`${BASE}/super-admin/admins/${encodeURIComponent(id)}/lock`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders },
      body: JSON.stringify({ reason }),
    })
    return await handle(res).then(response => response.json()) as { success: boolean; message: string }
  },
  async unlockAdmin(id: string) {
    const csrfHeaders = await superAdminCsrfHeaders()
    const res = await fetch(`${BASE}/super-admin/admins/${encodeURIComponent(id)}/unlock`, {
      method: 'POST',
      credentials: 'include',
      headers: csrfHeaders,
    })
    return await handle(res).then(response => response.json()) as { success: boolean; message: string }
  },
  async forceLogoutAdmin(id: string) {
    const csrfHeaders = await superAdminCsrfHeaders()
    const res = await fetch(`${BASE}/super-admin/admins/${encodeURIComponent(id)}/force-logout`, {
      method: 'POST',
      credentials: 'include',
      headers: csrfHeaders,
    })
    return await handle(res).then(response => response.json()) as { success: boolean; message: string }
  },
  async getServerStatus() {
    const res = await fetch(`${BASE}/super-admin/server/status`, { credentials: 'include', cache: 'no-store' })
    return await handle(res).then(response => response.json()) as { success: boolean; server: ServerDiagnostics }
  },
  async getSystemStats() {
    const res = await fetch(`${BASE}/super-admin/system/stats`, { credentials: 'include', cache: 'no-store' })
    return await handle(res).then(response => response.json()) as { success: boolean; data: Record<string, number | string | null>; message: string }
  },
  async getStorageOptimization() {
    const res = await fetch(`${BASE}/super-admin/storage-optimization`, { credentials: 'include', cache: 'no-store' })
    return await handle(res).then(response => response.json()) as {
      success: boolean
      data: StorageOptimizationMetrics
      message: string
    }
  },
  async getPerformance(range: '1h' | '24h' | '7d' | '30d') {
    const res = await fetch(`${BASE}/super-admin/system/performance?range=${range}`, { credentials: 'include', cache: 'no-store' })
    return await handle(res).then(response => response.json()) as { success: boolean; data: SystemPerformancePoint[]; message: string }
  },
  async getServices() {
    const res = await fetch(`${BASE}/super-admin/system/services`, { credentials: 'include', cache: 'no-store' })
    return await handle(res).then(response => response.json()) as { success: boolean; data: SystemService[]; message: string }
  },
  async getSystemLogs(options: { limit?: number; offset?: number; severity?: string; search?: string } = {}) {
    const params = new URLSearchParams()
    if (options.limit !== undefined) params.set('limit', String(options.limit))
    if (options.offset !== undefined) params.set('offset', String(options.offset))
    if (options.severity) params.set('severity', options.severity)
    if (options.search) params.set('search', options.search)
    const res = await fetch(`${BASE}/super-admin/system/logs?${params}`, { credentials: 'include', cache: 'no-store' })
    return await handle(res).then(response => response.json()) as { success: boolean; data: SystemLog[]; total: number; limit: number; offset: number; message: string }
  },
  async getSystemConfig() {
    const res = await fetch(`${BASE}/super-admin/system/config`, { credentials: 'include', cache: 'no-store' })
    return await handle(res).then(response => response.json()) as { success: boolean; data: SafeSystemConfig; message: string }
  },
  async getMaintenance() {
    const res = await fetch(`${BASE}/super-admin/server/maintenance`, { credentials: 'include', cache: 'no-store' })
    return await handle(res).then(response => response.json()) as { success: boolean; data: { enabled: boolean; message: string; updatedAt: string | null }; message: string }
  },
  async getActivity() {
    const res = await fetch(`${BASE}/super-admin/activity`, { credentials: 'include', cache: 'no-store' })
    return await handle(res).then(response => response.json()) as { success: boolean; data: Array<{ id: string; type: string; description: string; created_at: string }>; message: string }
  },
  async getAnalyticsOverview() {
    const res = await fetch(`${BASE}/super-admin/analytics/overview`, { credentials: 'include', cache: 'no-store' })
    return await handle(res).then(response => response.json()) as { success: boolean; data: Record<string, number>; message: string }
  },
  async getAnalytics(metric: 'attempts' | 'registrations' | 'questions' | 'exams', range = '30d') {
    const res = await fetch(`${BASE}/super-admin/analytics/${metric}?range=${encodeURIComponent(range)}`, { credentials: 'include', cache: 'no-store' })
    return await handle(res).then(response => response.json()) as { success: boolean; data: Array<{ bucket_start: string; total: number }>; message: string }
  },
  async clearCache(type: 'application' | 'config' | 'view' | 'redis' = 'application') {
    const csrfHeaders = await superAdminCsrfHeaders()
    const res = await fetch(`${BASE}/super-admin/server/clear-cache`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders },
      body: JSON.stringify({ type }),
    })
    return await handle(res).then(response => response.json()) as { success: boolean; message: string }
  },
  async toggleMaintenance(enabled: boolean, reason?: string) {
    const csrfHeaders = await superAdminCsrfHeaders()
    const res = await fetch(`${BASE}/super-admin/server/maintenance`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders },
      body: JSON.stringify({ enabled, reason }),
    })
    return await handle(res).then(response => response.json()) as { success: boolean; maintenanceMode: boolean; message: string }
  },
  async getApiAnalytics(limit = 100) {
    const res = await fetch(`${BASE}/super-admin/api-analytics?limit=${limit}`, { credentials: 'include', cache: 'no-store' })
    return await handle(res).then(response => response.json()) as { success: boolean; analytics: ApiAnalytics }
  },
  async getBackups() {
    const res = await fetch(`${BASE}/super-admin/backups`, { credentials: 'include', cache: 'no-store' })
    return await handle(res).then(response => response.json()) as { success: boolean; backups: BackupRecord[] }
  },
  async triggerBackup(type = 'full_db') {
    const csrfHeaders = await superAdminCsrfHeaders()
    const res = await fetch(`${BASE}/super-admin/backups/create`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders },
      body: JSON.stringify({ type }),
    })
    return await handle(res).then(response => response.json()) as {
      success: boolean
      backup: BackupRecord
      content: string
      fileName: string
      sizeBytes: number
      message: string
    }
  },
  async getSecurityAlerts(status = 'all', severity = 'all') {
    const res = await fetch(`${BASE}/super-admin/security-alerts?status=${encodeURIComponent(status)}&severity=${encodeURIComponent(severity)}`, {
      credentials: 'include',
      cache: 'no-store',
    })
    return await handle(res).then(response => response.json()) as { success: boolean; alerts: SecurityAlert[] }
  },
  async resolveSecurityAlert(id: string) {
    const csrfHeaders = await superAdminCsrfHeaders()
    const res = await fetch(`${BASE}/super-admin/security-alerts/${encodeURIComponent(id)}/resolve`, {
      method: 'PUT',
      credentials: 'include',
      headers: csrfHeaders,
    })
    return await handle(res).then(response => response.json()) as { success: boolean; message: string }
  },
}


export const mockTestsAPI = {
  async getAll(options: { background?: boolean } = {}) {
    const backgroundQuery = options.background ? '?_background=1' : ''
    const res = await fetch(`${BASE}/mock-tests${backgroundQuery}`, {
      method: 'GET',
      credentials: 'include',
    })
    const data = await handle(res).then(() => res.json())
    return data as MockTest[]
  },
  async getAllAdmin() {
    const res = await fetch(`${BASE}/mock-tests?admin=true`, { credentials: 'include' })
    const data = await handle(res).then(() => res.json())
    return data as MockTest[]
  },
  async getById(id: string) {
    const res = await fetch(`${BASE}/mock-tests/${encodeURIComponent(id)}`, {
      method: 'GET',
      credentials: 'include',
    })
    const data = await handle(res).then(() => res.json())
    return data as MockTest
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
    const data = await handle(res).then(response => response.json())
    return data as { success: boolean; message: string }
  },
}

const jsonHeaders = async () => {
  const csrfToken = await ensureCsrfToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken
  return headers
}

export const notificationsAPI = {
  async list(limit = 20, offset = 0) {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    const res = await fetch(`${BASE}/notifications?${query}`, {
      credentials: 'include',
      cache: 'no-store',
    })
    const data = await handle(res).then(response => response.json()) as {
      success: boolean
      notifications: StudentNotification[]
      unreadCount: number
      total: number
      hasMore: boolean
    }
    return data
  },
  async markRead(id: string) {
    const res = await fetch(`${BASE}/notifications/${encodeURIComponent(id)}/read`, {
      method: 'PATCH',
      credentials: 'include',
      headers: await jsonHeaders(),
    })
    return await handle(res).then(response => response.json()) as { success: boolean; notification: StudentNotification }
  },
  async markAllRead() {
    const res = await fetch(`${BASE}/notifications/read-all`, {
      method: 'POST',
      credentials: 'include',
      headers: await jsonHeaders(),
      body: JSON.stringify({}),
    })
    return await handle(res).then(response => response.json()) as { success: boolean }
  },
  async delete(id: string) {
    const res = await fetch(`${BASE}/notifications/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: await jsonHeaders(),
    })
    return await handle(res).then(response => response.json()) as { success: boolean }
  },
  async clearAll() {
    const res = await fetch(`${BASE}/notifications`, {
      method: 'DELETE',
      credentials: 'include',
      headers: await jsonHeaders(),
    })
    return await handle(res).then(response => response.json()) as { success: boolean }
  },
  async publishAnnouncement(payload: { title: string; message: string; targetPage: NotificationPage; requestId: string }) {
    const res = await fetch(`${BASE}/notifications/announcements`, {
      method: 'POST',
      credentials: 'include',
      headers: await jsonHeaders(),
      body: JSON.stringify(payload),
    })
    return await handle(res).then(response => response.json()) as { success: boolean; message: string }
  },
}

export const mockTestAssignmentsAPI = {
  async getAdminAssignments() {
    const res = await fetch(`${BASE}/admin/mock-tests/assignments`, { credentials: 'include', cache: 'no-store' })
    return await handle(res).then(response => response.json()) as { success: boolean; assignments: MockTestAssignment[] }
  },
  async create(payload: Record<string, unknown>) {
    const res = await fetch(`${BASE}/admin/mock-tests/assign`, {
      method: 'POST',
      credentials: 'include',
      headers: await jsonHeaders(),
      body: JSON.stringify(payload),
    })
    return await handle(res).then(response => response.json()) as { success: boolean; message: string; assignmentId: string; assignment: MockTestAssignment }
  },
  async update(id: string, payload: Record<string, unknown>) {
    const res = await fetch(`${BASE}/admin/mock-tests/assignments/${encodeURIComponent(id)}`, {
      method: 'PUT',
      credentials: 'include',
      headers: await jsonHeaders(),
      body: JSON.stringify(payload),
    })
    return await handle(res).then(response => response.json()) as {
      success: boolean
      message: string
      assignment?: MockTestAssignment
    }
  },
  async cancel(id: string) {
    const res = await fetch(`${BASE}/admin/mock-tests/assignments/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: await jsonHeaders(),
    })
    return await handle(res).then(response => response.json()) as { success: boolean; message: string }
  },
  async getAttempts(id: string) {
    const res = await fetch(`${BASE}/admin/mock-tests/assignments/${encodeURIComponent(id)}/attempts`, { credentials: 'include' })
    return await handle(res).then(response => response.json()) as { success: boolean; attempts: MockTestAttempt[] }
  },
  async getStudentAssignments() {
    const res = await fetch(`${BASE}/student/mock-tests/assigned`, { credentials: 'include', cache: 'no-store' })
    return await handle(res).then(response => response.json()) as { success: boolean; assignments: MockTestAssignment[] }
  },
  async start(assignmentId: string) {
    const res = await fetch(`${BASE}/student/mock-tests/${encodeURIComponent(assignmentId)}/start`, {
      method: 'POST',
      credentials: 'include',
      headers: await jsonHeaders(),
      body: JSON.stringify({}),
    })
    return await handle(res).then(response => response.json()) as StartedMockTest
  },
  async saveProgress(attemptId: string, answers: Record<string, number>, timeSpent: number) {
    const res = await fetch(`${BASE}/student/mock-tests/attempts/${encodeURIComponent(attemptId)}/progress`, {
      method: 'PUT',
      credentials: 'include',
      headers: await jsonHeaders(),
      body: JSON.stringify({ answers, timeSpent }),
    })
    return await handle(res).then(response => response.json()) as { success: boolean; message: string; attempt: MockTestAttempt }
  },
  async submit(attemptId: string, answers: Record<string, number>, timeSpent: number) {
    const res = await fetch(`${BASE}/student/mock-tests/attempts/${encodeURIComponent(attemptId)}/submit`, {
      method: 'POST',
      credentials: 'include',
      headers: await jsonHeaders(),
      body: JSON.stringify({ answers, timeSpent }),
    })
    return await handle(res).then(response => response.json()) as { success: boolean; message: string; result?: TestResult; attempt: MockTestAttempt }
  },
}

/* ── Questions ── */
export interface Question {
  _id: string
  questionCode?: string | null
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
  // MHT-CET classification (optional — empty/undefined = not classified)
  questionType?: string
  cetDifficulty?: string
  cetRelevance?: string
  classificationConfidence?: number | null
  classificationSource?: string
  sourcePdf?: string
  sourcePage?: number | null
  sourceQuestionNumber?: number | null
  generationJobId?: string
  isActive: boolean
  createdAt?: string
}

/** Shape of one question as produced by POST /api/questions/extract/pdf. */
export interface ExtractedPdfQuestion {
  questionNumber: number
  question: string
  options: Record<string, string>
  correctAnswer: string
  correctIndex: number
  subject: string
  chapter: string
  topic: string
  subTopic?: string
  difficulty: 'Easy' | 'Medium' | 'Hard'
  questionType?: string
  cetDifficulty?: string
  cetRelevance?: string
  classificationConfidence?: number
  classificationSource?: string
  sourcePdf?: string
  solution: string
  confidence: number
  needsReview: boolean
  reviewReason: string
  warnings: string[]
  sourcePage?: number
  duplicate: boolean
  duplicateType: 'exact' | 'similar' | null
  duplicateOfId: string | null
  duplicateOfText: string | null
  duplicateScore: number
  duplicateInBatch?: boolean
  duplicateAction: 'skip' | 'import' | 'replace'
}

/* ── CET classification (MHT-CET syllabus mapping of PDF extractions) ── */

export interface CetDistributionEntry {
  name: string
  count: number
  percent: number
}

export interface CetAnalysisTopic extends CetDistributionEntry {
  subTopics: CetDistributionEntry[]
}

export interface CetAnalysisChapter extends CetDistributionEntry {
  topics: CetAnalysisTopic[]
}

export interface CetAnalysisSubject extends CetDistributionEntry {
  chapters: CetAnalysisChapter[]
}

/** Distribution analysis returned with every PDF extraction. */
export interface PdfAnalysis {
  totalQuestions: number
  classified: number
  unclassified: number
  subjects: CetDistributionEntry[]
  chaptersBySubject: Record<string, CetDistributionEntry[]>
  tree: CetAnalysisSubject[]
  difficulty: CetDistributionEntry[]
  cetRelevance: CetDistributionEntry[]
  questionTypes: CetDistributionEntry[]
}

export interface CetTaxonomyTopic {
  name: string
  subTopics: string[]
}

export interface CetTaxonomyChapter {
  name: string
  topics: CetTaxonomyTopic[]
}

export interface CetTaxonomySubject {
  name: string
  chapters: CetTaxonomyChapter[]
}

/** MHT-CET syllabus taxonomy + classification vocabularies (admin dropdowns). */
export interface CetTaxonomy {
  subjects: CetTaxonomySubject[]
  questionTypes: string[]
  cetRelevanceLevels: string[]
  cetDifficultyLevels: string[]
  classificationSources: string[]
}

export interface PdfExtractResponse {
  success: boolean
  totalExtracted: number
  duplicateCount: number
  questions: ExtractedPdfQuestion[]
  warnings: string[]
  analysis: PdfAnalysis | null
  meta: {
    mode: 'text' | 'ocr'
    ocrPages?: number
    pages?: number
    truncated?: boolean
    fileName: string
    sizeBytes: number
    warnings?: string[]
    [k: string]: unknown
  }
}

/** Payload sent to POST /api/questions/import/batch after admin review. */
export interface PdfImportQuestion extends ExtractedPdfQuestion {
  selected: boolean
}

export interface NotesGeneratedQuestion {
  subject: string
  chapter: string
  topic: string
  subTopic: string
  text: string
  options: string[]
  solution: string
  correctIndex: number
  marks: number
  negativeMarks: number
  difficulty: 'Easy' | 'Medium' | 'Hard'
  requestedDifficulty: 'Easy' | 'Medium' | 'Hard'
  sourceDocument: string
  sourceType: 'page' | 'slide'
  sourcePage: number
  evidence: string
  confidence: number
  validationIssues: string[]
  approved: boolean
  selected: boolean
}

export interface NotesGenerationConfig {
  subject: string
  count: number
  chapters?: string[]
  topics?: string[]
  questionsPerBatch?: number
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Mixed'
  mixedDifficulty?: Record<'Easy' | 'Medium' | 'Hard', number>
  generateExplanations?: boolean
  includeNumericalQuestions?: boolean
  topicDistribution: {
    mode: 'automatic' | 'equal' | 'custom'
    values?: Record<string, number>
  }
}

export interface NotesGenerationResult {
  questions: NotesGeneratedQuestion[]
  topics: Array<{ name: string; subtopics: string[]; sourcePages: number[] }>
  detectedSubjects?: string[]
  requestedCount: number
  generatedCount: number
  highConfidenceCount: number
  warnings: string[]
  sourceDocument: string
  sourceType: 'page' | 'slide'
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

const pollPdfExtractionJob = async (
  jobId: string,
  onProgress?: (percent: number, stage?: string) => void,
): Promise<PdfExtractResponse> => {
  const deadline = Date.now() + 5 * 60 * 1000
  while (Date.now() < deadline) {
    await wait(1500)
    const res = await fetch(`${BASE}/questions/extract/pdf/jobs/${encodeURIComponent(jobId)}`, {
      credentials: 'include',
      cache: 'no-store',
    })
    const payload = await res.json().catch(() => null) as
      | { success?: boolean; status?: string; stage?: string; percent?: number; result?: Omit<PdfExtractResponse, 'success'>; error?: { message?: string }; message?: string }
      | null

    if (!res.ok || !payload?.success) {
      throw new ApiResponseError(
        payload?.message || `Could not check PDF processing status (HTTP ${res.status})`,
        res.status,
      )
    }
    onProgress?.(payload.percent ?? 0, payload.stage || 'Processing PDF')

    if (payload.status === 'completed' && payload.result) {
      return { ...payload.result, success: true }
    }
    if (payload.status === 'failed') {
      throw new ApiResponseError(payload.error?.message || 'PDF processing failed.', 422)
    }
  }
  throw new ApiResponseError('PDF processing is taking longer than expected. Please retry with a smaller PDF.', 408)
}

const pollNotesGenerationJob = async (
  jobId: string,
  onProgress?: (percent: number, stage?: string) => void,
): Promise<NotesGenerationResult & { jobId: string }> => {
  const deadline = Date.now() + 15 * 60 * 1000
  let consecutiveStatusFailures = 0
  let lastReportedProgress = 0
  while (Date.now() < deadline) {
    await wait(1500)
    let res: Response
    try {
      res = await fetch(`${BASE}/questions/notes/jobs/${encodeURIComponent(jobId)}`, {
        credentials: 'include',
        cache: 'no-store',
      })
    } catch {
      consecutiveStatusFailures += 1
      onProgress?.(lastReportedProgress, 'Reconnecting to the server')
      await wait(Math.min(1000 * 2 ** (consecutiveStatusFailures - 1), 8000))
      continue
    }
    const payload = await res.json().catch(() => null) as
      | { success?: boolean; status?: string; stage?: string; percent?: number; error?: { message?: string }; message?: string }
      | null
    if (!res.ok || !payload?.success) {
      if ([502, 503, 504].includes(res.status)) {
        consecutiveStatusFailures += 1
        onProgress?.(lastReportedProgress, 'Reconnecting to the server')
        await wait(Math.min(1000 * 2 ** (consecutiveStatusFailures - 1), 8000))
        continue
      }
      throw new ApiResponseError(payload?.message || `Could not check AI generation status (HTTP ${res.status}).`, res.status)
    }
    consecutiveStatusFailures = 0
    lastReportedProgress = payload.percent ?? lastReportedProgress
    onProgress?.(lastReportedProgress, payload.stage || 'Processing notes')
    if (payload.status === 'COMPLETED' || payload.status === 'PARTIALLY_COMPLETED') {
      const result = await getNotesGenerationResults(jobId)
      return { ...result, jobId }
    }
    if (payload.status === 'FAILED') {
      throw new ApiResponseError(payload.error?.message || 'AI question generation failed.', 422)
    }
    if (payload.status === 'CANCELLED') throw new ApiResponseError('AI question generation was cancelled.', 409)
  }
  if (consecutiveStatusFailures > 0) {
    throw new ApiResponseError(
      'The server stayed unavailable while checking AI generation status. The job may still be running; check the server and retry.',
      0,
    )
  }
  throw new ApiResponseError('AI question generation is taking longer than expected. Retry with a smaller document.', 408)
}

const getNotesGenerationResults = async (jobId: string): Promise<NotesGenerationResult> => {
  const results: NotesGenerationResult['questions'] = []
  let page = 1
  let baseResult: Omit<NotesGenerationResult, 'questions'> | null = null
  let totalPages = 1
  do {
    const res = await fetch(
      `${BASE}/questions/notes/jobs/${encodeURIComponent(jobId)}/questions?page=${page}&limit=100`,
      { credentials: 'include', cache: 'no-store' },
    )
    const data = await handle(res).then(() => res.json()) as {
      result: NotesGenerationResult
      pagination: { totalPages: number }
    }
    const { questions, ...result } = data.result
    if (!baseResult) baseResult = result
    results.push(...questions)
    totalPages = data.pagination.totalPages
    page += 1
  } while (page <= totalPages)
  if (!baseResult) throw new ApiResponseError('Generated question results were empty.', 502)
  return { ...baseResult, questions: results }
}

export const questionsAPI = {
  async getAll(filters?: { subject?: string; topic?: string; difficulty?: string; isActive?: boolean; includeAnswers?: boolean; ids?: string[] }) {
    const qs = new URLSearchParams()
    Object.entries(filters || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== '') qs.set(k, Array.isArray(v) ? v.join(',') : String(v))
    })
    const url = qs.toString() ? `${BASE}/questions?${qs.toString()}` : `${BASE}/questions`
    const res = await fetch(url, { credentials: 'include' })
    const data = await handle(res).then(() => res.json())
    return data as Question[]
  },
  async getAllAdmin(filters?: { subject?: string; topic?: string; difficulty?: string; isActive?: boolean; includeAnswers?: boolean; ids?: string[] }) {
    const params = new URLSearchParams({ admin: 'true' })
    if (filters?.subject) params.set('subject', filters.subject)
    if (filters?.topic) params.set('topic', filters.topic)
    if (filters?.difficulty) params.set('difficulty', filters.difficulty)
    if (filters?.isActive !== undefined) params.set('isActive', String(filters.isActive))
    if (filters?.ids?.length) params.set('ids', filters.ids.join(','))
    params.set('includeAnswers', String(filters?.includeAnswers ?? true))
    const res = await fetch(`${BASE}/questions?${params.toString()}`, { credentials: 'include' })
    const data = await handle(res).then(() => res.json())
    return data as Question[]
  },
  async getSubjectsAndChapters() {
    const res = await fetch(`${BASE}/questions/meta/subjects-chapters`, { credentials: 'include' })
    const data = await handle(res).then(() => res.json())
    return data as { subjects: string[]; chaptersBySubject: Record<string, string[]> }
  },
  /** MHT-CET syllabus taxonomy powering the classification dropdowns. */
  async getCetTaxonomy() {
    const res = await fetch(`${BASE}/questions/meta/cet-taxonomy`, { credentials: 'include' })
    const data = await handle(res).then(() => res.json())
    return data as CetTaxonomy
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
    const mimeByExtension: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
    }
    const mimeType = file.type.toLowerCase() || mimeByExtension[file.name.split('.').pop()?.toLowerCase() || '']
    const extension = Object.entries(mimeByExtension).find(([, mime]) => mime === mimeType)?.[0]
    if (!mimeType || !extension) {
      throw new ApiResponseError('Only JPEG, PNG, and WebP question images are supported.', 400)
    }
    const namedMimeType = mimeByExtension[file.name.split('.').pop()?.toLowerCase() || '']
    const csrfToken = await ensureCsrfToken()
    const form = new FormData()
    const uploadFile = file.type && namedMimeType === mimeType
      ? file
      : new File([file], `question-image.${extension}`, { type: mimeType })
    form.append('image', uploadFile, uploadFile.name)
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
  /**
   * Upload a PDF for question extraction and track upload progress.
   * Uses XHR (fetch has no upload progress) and returns the extracted,
   * duplicate-flagged questions for the admin review screen.
   */
  extractPdf(file: File, onProgress?: (percent: number, stage?: string) => void): Promise<PdfExtractResponse> {
    return new Promise((resolve, reject) => {
      const csrfToken = getCsrfToken()
      const form = new FormData()
      form.append('file', file)
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${BASE}/questions/extract/pdf/jobs`)
      xhr.withCredentials = true
      if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken)

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100), 'Uploading PDF')
      }
      xhr.onload = () => {
        let payload: unknown = null
        try { payload = JSON.parse(xhr.responseText) } catch { /* non-JSON error page */ }
        const data = payload as ({ success?: boolean; message?: string; jobId?: string }) | null
        if (xhr.status < 200 || xhr.status >= 300 || !data?.success || !data.jobId) {
          reject(new ApiResponseError(data?.message || `Could not start PDF processing (HTTP ${xhr.status})`, xhr.status))
          return
        }
        void pollPdfExtractionJob(data.jobId, onProgress).then(resolve, reject)
      }
      xhr.onerror = () => reject(new ApiResponseError('Network error while uploading the PDF. Check your connection and try again.', 0))
      xhr.ontimeout = () => reject(new ApiResponseError('The PDF upload timed out. Try again with a smaller file or a more stable connection.', 0))
      xhr.send(form)
    })
  },
  /** Persist the admin-reviewed extraction result via the shared import pipeline. */
  async importBatch(questions: PdfImportQuestion[]) {
    const csrfToken = await ensureCsrfToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    const res = await fetch(`${BASE}/questions/import/batch`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ questions }),
    })
    const data = await handle(res).then(() => res.json())
    return data as { imported: number; replaced: number; skipped: number; failed: number; total: number; errors: Array<{ questionNumber: number; message: string }> }
  },
  /**
   * AI-assisted refinement of classifications the rules engine could not
   * confidently place. Returns the merged questions plus a rebuilt analysis;
   * PDF-printed classifications are never overridden.
   */
  async classifyBatch(questions: PdfImportQuestion[]) {
    const csrfToken = await ensureCsrfToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    const res = await fetch(`${BASE}/questions/classify/batch`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ questions }),
    })
    const data = await handle(res).then(() => res.json())
    return data as { success: boolean; aiApplied: number; questions: PdfImportQuestion[]; analysis: PdfAnalysis }
  },
  generateFromNotes(
    file: File,
    syllabusFile: File,
    config: NotesGenerationConfig,
    onJobStarted?: (jobId: string) => void,
    onProgress?: (percent: number, stage?: string) => void,
  ): Promise<NotesGenerationResult & { jobId: string }> {
    return new Promise((resolve, reject) => {
      void ensureCsrfToken().then((csrfToken) => {
        const form = new FormData()
        form.append('file', file)
        form.append('syllabus', syllabusFile)
        form.append('config', JSON.stringify(config))
        const xhr = new XMLHttpRequest()
        xhr.open('POST', `${BASE}/questions/notes/generate`)
        xhr.withCredentials = true
        if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken)
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 10), 'Uploading notes')
        }
        xhr.onload = () => {
          let payload: unknown = null
          try { payload = JSON.parse(xhr.responseText) } catch { /* non-JSON error page */ }
          const data = payload as { success?: boolean; message?: string; jobId?: string } | null
          if (xhr.status < 200 || xhr.status >= 300 || !data?.success || !data.jobId) {
            reject(new ApiResponseError(data?.message || `Could not start AI processing (HTTP ${xhr.status}).`, xhr.status))
            return
          }
          onJobStarted?.(data.jobId)
          void pollNotesGenerationJob(data.jobId, onProgress).then(resolve, reject)
        }
        xhr.onerror = () => reject(new ApiResponseError('Network error while uploading notes. Check your connection and retry.', 0))
        xhr.ontimeout = () => reject(new ApiResponseError('The notes upload timed out. Try a smaller file or a more stable connection.', 0))
        xhr.send(form)
      }).catch(reject)
    })
  },
  async cancelNotesGenerationJob(jobId: string) {
    const csrfToken = await ensureCsrfToken()
    const headers: Record<string, string> = {}
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken
    const res = await fetch(`${BASE}/questions/notes/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
      credentials: 'include',
      headers,
    })
    return await handle(res).then(() => res.json()) as {
      success: boolean
      status: string
      alreadyFinished: boolean
    }
  },
  async validateNotesQuestion(
    jobId: string,
    questionIndex: number,
    question: Pick<NotesGeneratedQuestion, 'subject' | 'topic' | 'subTopic' | 'text' | 'options' | 'solution' | 'correctIndex' | 'requestedDifficulty'>,
  ) {
    const csrfToken = await ensureCsrfToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken
    const res = await fetch(`${BASE}/questions/notes/jobs/${encodeURIComponent(jobId)}/validate`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ questionIndex, question }),
    })
    const data = await handle(res).then(() => res.json())
    return data as { success: boolean; question: NotesGeneratedQuestion }
  },
  async regenerateNotesQuestion(jobId: string, questionIndex: number) {
    const csrfToken = await ensureCsrfToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken
    const res = await fetch(`${BASE}/questions/notes/jobs/${encodeURIComponent(jobId)}/regenerate`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ questionIndex }),
    })
    const data = await handle(res).then(() => res.json())
    return data as { success: boolean; question: NotesGeneratedQuestion }
  },
}