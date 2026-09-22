// Service for AI-driven Result Analytics & Step-by-Step Question Solutions via OpenRouter

export interface SubjectScoreItem {
  subject: string
  score: number
  maxScore: number
  percentage: number
}

export interface ResultAnalyticsInput {
  testId?: string
  examName: string
  score: number
  maxScore: number
  percentage: number
  timeTaken: string
  correctAnswers: number
  wrongAnswers: number
  unansweredQuestions: number
  subjectWiseScores: SubjectScoreItem[]
}

export interface ActionPlanItem {
  subject: string
  priority: 'High' | 'Medium' | 'Low'
  focus: string
  action: string
}

export interface AIAnalyticsData {
  aiScore?: number
  summaryDiagnosis: string
  projectedPercentile: string
  estimatedCetRank: string
  speedAndAccuracyAnalysis: string
  strengths: string[]
  weaknesses: string[]
  actionPlan: ActionPlanItem[]
  coachVerdict: string
}

export interface QuestionExplainInput {
  questionId?: string
  text: string
  options: string[]
  correctIndex: number
  userAnswerIndex?: number | null
  subject?: string
  chapter?: string
  topic?: string
  existingSolution?: string
}

const getApiBase = (): string => {
  const configuredApiUrl = import.meta.env.VITE_API_URL?.trim()
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host === 'localhost' || host === '127.0.0.1') {
      return (configuredApiUrl || 'http://localhost:5000').replace(/\/$/, '')
    }
  }
  return (configuredApiUrl || 'https://cet-portal-3vas.onrender.com').replace(/\/$/, '')
}

const API_BASE = getApiBase()

export const getOpenRouterKey = (): string => {
  return ''
}

// ── Cache helpers ─────────────────────────────────────────────────────────────
const getFromStorage = <T>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const saveToStorage = (key: string, data: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch {}
}

// ── 1. Result Analytics Generator ─────────────────────────────────────────────
export async function generateResultAnalytics(
  params: ResultAnalyticsInput,
  forceRefresh = false
): Promise<AIAnalyticsData> {
  const cacheKey = `ai_analytics_v2_${params.testId || params.examName}_${params.score}_${params.correctAnswers}`
  
  if (!forceRefresh) {
    const cached = getFromStorage<AIAnalyticsData>(cacheKey)
    if (cached && cached.summaryDiagnosis) return cached
  }

  // 1. Attempt via Backend API
  try {
    const res = await fetch(`${API_BASE}/api/ai/analytics`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok && json.success && json.analytics) {
      saveToStorage(cacheKey, json.analytics)
      return json.analytics as AIAnalyticsData
    }
    if (!res.ok) throw new Error(json.message || `AI analytics request failed (${res.status}).`)
  } catch (backendErr) {
    console.warn('Backend AI analytics route unavailable:', backendErr)
  }

    throw new Error('AI analytics service is unavailable. Please try again.')
}

// ── 2. Step-by-Step Question Solution Generator ──────────────────────────────
export async function generateQuestionExplanation(
  params: QuestionExplainInput,
  forceRefresh = false
): Promise<string> {
  const cacheKey = `ai_solution_${params.questionId || params.text.slice(0, 40)}_${params.userAnswerIndex ?? 'na'}`

  if (!forceRefresh) {
    const cached = getFromStorage<string>(cacheKey)
    if (cached) return cached
  }

  // 1. Attempt via Backend API
  try {
    const res = await fetch(`${API_BASE}/api/ai/explain-question`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    if (res.ok) {
      const json = await res.json()
      if (json.success && json.explanation) {
        saveToStorage(cacheKey, json.explanation)
        return json.explanation
      }
    }
  } catch (backendErr) {
    console.warn('Backend AI solution route unavailable:', backendErr)
  }

  throw new Error('AI explanation service is unavailable. Please try again.')
}
