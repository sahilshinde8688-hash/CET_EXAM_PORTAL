const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/$/, '')
const BASE = `${API_URL}/api`

/**
 * Get CSRF token from cookies
 * Needed for state-changing requests (POST, PUT, PATCH, DELETE)
 */
const getCsrfToken = (): string | null => {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/(?:^|; )csrfToken=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : null
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
  const csrfToken = getCsrfToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken

  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password }),
  })
  const data = await handle(res).then(() => res.json())
  return { data }
}

export async function register(payload: { name: string; email: string; phone: string; branch: string; batch: number }) {
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await handle(res).then(() => res.json())
  return { data }
}

export async function resetPassword(payload: { token: string; newPassword: string }) {
  const res = await fetch(`${BASE}/users/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await handle(res).then(() => res.json())
  return { data }
}

export const authAPI = {
  login: async (email: string, password: string, rememberMe = false) => {
    const csrfToken = getCsrfToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ email, password, rememberMe }),
    })
    const data = await handle(res, false).then(() => res.json())
    return data
  },
  register: async (name: string, email: string, phone: string, branch: string, batch: string | number) => {
    const res = await fetch(`${BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, branch, batch }),
    })
    const data = await handle(res).then(() => res.json())
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
    const url = status ? `${BASE}/users?status=${status}` : `${BASE}/users`
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
    })
    const data = await handle(res).then(() => res.json())
    return data as AuthUser[]
  },
  async stats() {
    const res = await fetch(`${BASE}/users/stats`, {
      method: 'GET',
      credentials: 'include',
    })
    const data = await handle(res).then(() => res.json())
    return data as { pending: number; approved: number; rejected: number }
  },
  async approve(id: string) {
    const csrfToken = getCsrfToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    const res = await fetch(`${BASE}/users/${id}/approve`, {
      method: 'POST',
      credentials: 'include',
      headers,
    })
    const data = await handle(res).then(() => res.json())
    return data as { mhcetId: string, message: string }
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
    const csrfToken = getCsrfToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    const res = await fetch(`${BASE}/users/${id}/reject`, {
      method: 'POST',
      credentials: 'include',
      headers,
    })
    const data = await handle(res).then(() => res.json())
    return data
  },
  async delete(id: string) {
    const csrfToken = getCsrfToken()
    const headers: Record<string, string> = {}
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    const res = await fetch(`${BASE}/users/${id}`, {
      method: 'DELETE',
      credentials: 'include',
      headers,
    })
    await handle(res)
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
    const res = await fetch(`${BASE}/users/reset-password`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ newPassword }),
    })
    const data = await handle(res).then(() => res.json())
    return data
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
    const res = await fetch(`${BASE}/tests`, { credentials: 'include' })
    const data = await handle(res).then(() => res.json())
    return data as TestResult[]
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
  
  async submitResult(payload: { testName: string; subject: string; score: number; totalMarks: number; percentile: number; duration: number; subjectWiseScores?: any[]; answers?: Record<string, number>; correct: number; incorrect: number; unanswered: number; totalQuestions: number; }) {
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
    const csrfToken = getCsrfToken()
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
    const csrfToken = getCsrfToken()
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
    const csrfToken = getCsrfToken()
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
  async getAll(filters?: { subject?: string; topic?: string; difficulty?: string; isActive?: boolean }) {
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
    const res = await fetch(`${BASE}/questions`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await handle(res).then(() => res.json())
    return data as Question
  },
  async uploadQuestionImage(file: File) {
    const form = new FormData()
    form.append('image', file)
    const res = await fetch(`${BASE}/upload/question`, {
      method: 'POST',
      credentials: 'include',
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
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/questions/upload`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    })
    const data = await handle(res).then(() => res.json())
    return data as { imported: number; total: number; errors: Array<{ row: number; message: string }> }
  },
}