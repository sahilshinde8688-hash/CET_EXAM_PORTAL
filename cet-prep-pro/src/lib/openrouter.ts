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
  return import.meta.env.VITE_OPENROUTER_API_KEY || ''
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
  const cacheKey = `ai_analytics_${params.testId || params.examName}_${params.score}_${params.correctAnswers}`
  
  if (!forceRefresh) {
    const cached = getFromStorage<AIAnalyticsData>(cacheKey)
    if (cached && cached.summaryDiagnosis) return cached
  }

  // 1. Attempt via Backend API
  try {
    const res = await fetch(`${API_BASE}/api/ai/analytics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    if (res.ok) {
      const json = await res.json()
      if (json.success && json.analytics) {
        saveToStorage(cacheKey, json.analytics)
        return json.analytics as AIAnalyticsData
      }
    }
  } catch (backendErr) {
    console.warn('Backend AI route unavailable, falling back to direct OpenRouter fetch:', backendErr)
  }

  // 2. Fallback: Direct OpenRouter call from client
  const apiKey = getOpenRouterKey()
  const prompt = `You are an elite MHT-CET exam mentor and academic data analyst.
Analyze the following mock test results of an engineering/pharmacy entrance student:

Exam: ${params.examName}
Score: ${params.score} / ${params.maxScore} (${params.percentage.toFixed(1)}%)
Time: ${params.timeTaken}
Correct: ${params.correctAnswers}, Incorrect: ${params.wrongAnswers}, Unanswered: ${params.unansweredQuestions}
Subject breakdown:
${params.subjectWiseScores.map(s => `- ${s.subject}: ${s.score}/${s.maxScore} (${s.percentage.toFixed(1)}%)`).join('\n')}

Respond with pure JSON conforming exactly to this structure (no markdown fences, just JSON):
{
  "summaryDiagnosis": "2-3 crisp sentences evaluating readiness and concepts",
  "projectedPercentile": "estimated percentile range e.g. 91.5%ile - 93.8%ile",
  "estimatedCetRank": "estimated state rank range e.g. Rank 4,000 - 6,500",
  "speedAndAccuracyAnalysis": "Detailed analysis of accuracy and question pacing",
  "strengths": ["Strength 1", "Strength 2", "Strength 3"],
  "weaknesses": ["Weakness 1", "Weakness 2", "Weakness 3"],
  "actionPlan": [
    { "subject": "Mathematics", "priority": "High", "focus": "Topics to practice", "action": "Exact strategy" },
    { "subject": "Physics", "priority": "Medium", "focus": "Topics to practice", "action": "Exact strategy" },
    { "subject": "Chemistry", "priority": "Low", "focus": "Topics to practice", "action": "Exact strategy" }
  ],
  "coachVerdict": "Inspiring closing advice from an MHT-CET top mentor"
}`

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'CET Exam Portal',
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.statusText}`)
  }

  const result = await response.json()
  const content = result.choices?.[0]?.message?.content || '{}'
  const parsed = JSON.parse(content) as AIAnalyticsData
  saveToStorage(cacheKey, parsed)
  return parsed
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
    console.warn('Backend AI solution route unavailable, falling back to direct OpenRouter fetch:', backendErr)
  }

  // 2. Fallback: Direct OpenRouter call from client
  const apiKey = getOpenRouterKey()
  const correctOpt = String.fromCharCode(65 + Number(params.correctIndex ?? 0))
  const userOpt = params.userAnswerIndex !== undefined && params.userAnswerIndex !== null
    ? String.fromCharCode(65 + Number(params.userAnswerIndex))
    : null

  const prompt = `You are a premier MHT-CET Faculty member.
Generate a comprehensive, step-by-step mathematical and conceptual solution for this MHT-CET question.

Subject: ${params.subject || 'General'}
Chapter / Topic: ${params.chapter || ''} ${params.topic || ''}
Question:
${params.text}

Options:
${params.options.map((opt, i) => `${String.fromCharCode(65 + i)}) ${opt}`).join('\n')}

Correct Option: Option ${correctOpt}
${userOpt ? `Student's Answer: Option ${userOpt} (${userOpt === correctOpt ? 'CORRECT' : 'INCORRECT'})` : 'Student did not attempt this question.'}
${params.existingSolution ? `Reference solution draft: ${params.existingSolution}` : ''}

Formatting rules:
- Use standard KaTeX mathematical syntax (e.g. $x^2 + y^2 = r^2$, \\frac{a}{b}, \\sqrt{...}, \\int, etc.) for all equations.
- Include structured sections:
  ### 1. Key Concept & Formula
  ### 2. Step-by-Step Derivation & Calculation
  ### 3. Verification & Correct Option
  ${userOpt && userOpt !== correctOpt ? `### 4. Why Option ${userOpt} was Incorrect (Common Trap)` : ''}
  ### 5. MHT-CET Speed Tip / Shortcut Trick
- Ensure full accuracy and clear derivation steps.`

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'CET Exam Portal',
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.statusText}`)
  }

  const result = await response.json()
  const explanation = result.choices?.[0]?.message?.content || 'Solution could not be generated.'
  saveToStorage(cacheKey, explanation)
  return explanation
}
