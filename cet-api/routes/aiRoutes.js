const express = require('express')
const db = require('../services/dbService')
const { protect, adminOnly } = require('../middleware/auth')
const { validateCsrfToken } = require('../middleware/csrf')
const { apiLimiter } = require('../middleware/rateLimit')
const { flagDuplicates } = require('../utils/duplicateDetection')
const router = express.Router()

router.use(protect)

const getApiKey = () => process.env.OPENROUTER_API_KEY
const MAX_QUESTION_LENGTH = 12000

const requestQuestionAI = async (prompt, temperature = 0.3) => {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(45000),
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:5173',
      'X-Title': 'CET Exam Portal',
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    console.error(`OpenRouter question-tool request failed with status ${response.status}.`)
    const error = new Error('The AI service could not complete this request.')
    error.status = 502
    throw error
  }

  const result = await response.json()
  const content = result.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    const error = new Error('The AI service returned an empty response.')
    error.status = 502
    throw error
  }

  try {
    return JSON.parse(content)
  } catch {
    const error = new Error('The AI service returned an invalid response.')
    error.status = 502
    throw error
  }
}

const questionText = (value) => String(value || '').trim().slice(0, MAX_QUESTION_LENGTH)

router.post('/question-tools', adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  const { operation, question = {} } = req.body || {}
  const text = questionText(question.text)

  if (!['generate', 'improve-grammar', 'distractors', 'duplicates'].includes(operation)) {
    return res.status(400).json({ success: false, message: 'Choose a supported question tool.' })
  }
  if (operation !== 'generate' && !text) {
    return res.status(400).json({ success: false, message: 'Enter a question before using this tool.' })
  }
  if (operation !== 'duplicates' && !getApiKey()) {
    return res.status(503).json({ success: false, message: 'OpenRouter API key is not configured.' })
  }

  try {
    if (operation === 'duplicates') {
      const bank = await db.getQuestions({}, { isAdmin: true })
      const currentId = String(question.id || '')
      const candidates = bank
        .filter((item) => !currentId || String(item._id || item.id || '') !== currentId)
        .map((item) => ({ id: item._id || item.id, text: item.text }))
      const [match] = flagDuplicates([{ question: text }], candidates)
      const duplicates = match.duplicate
        ? [{
            id: match.duplicateOfId,
            text: match.duplicateOfText,
            type: match.duplicateType,
            score: match.duplicateScore,
          }]
        : []
      return res.json({ success: true, duplicates })
    }

    const context = [
      `Class: ${question.classLevel || 'Not specified'}`,
      `Subject: ${question.subject || 'Not specified'}`,
      `Chapter: ${question.chapter || 'Not specified'}`,
      `Topic: ${question.topic || 'Not specified'}`,
      `Difficulty: ${question.difficulty || 'Medium'}`,
      `Question type: ${question.qType || 'Single Correct'}`,
    ].join('\n')
    const options = Array.isArray(question.options)
      ? question.options.map((option) => String(option || '').slice(0, 2000))
      : []
    let prompt
    let temperature = 0.3

    if (operation === 'generate') {
      temperature = 0.5
      prompt = `Create one accurate, original MHT-CET multiple-choice question.
${context}
Return only a JSON object with this shape:
{"text":"question text","options":["A","B","C","D"],"correctIndex":0,"solution":"step-by-step explanation"}
Use four concise options, exactly one correct answer, and make correctIndex the zero-based index of that answer. Preserve valid mathematical notation using LaTeX where useful.`
    } else if (operation === 'improve-grammar') {
      prompt = `Correct grammar, spelling, and clarity in the following exam question without changing its meaning, facts, mathematical notation, or HTML markup. Return only {"text":"corrected question"} as JSON.
${context}
Question:
${text}`
    } else {
      const correctIndex = Number.isInteger(question.correctIndex) ? question.correctIndex : 0
      prompt = `Write exactly ${Math.max(1, Math.min(options.length - 1, 3))} plausible but incorrect answer choices for this MHT-CET question. Do not include the correct answer or explanations in the choices. Return only {"distractors":["..."]} as JSON.
${context}
Question:
${text}
Correct answer:
${options[correctIndex] || '(not supplied)'}
Existing options to avoid repeating:
${options.filter((_, index) => index !== correctIndex).join('\n')}`
    }

    const result = await requestQuestionAI(prompt, temperature)
    if (operation === 'improve-grammar' && (
      typeof result.text !== 'string'
      || !result.text.trim()
      || result.text.length > MAX_QUESTION_LENGTH
    )) {
      return res.status(502).json({ success: false, message: 'The AI service returned an invalid corrected question.' })
    }
    if (operation === 'generate' && (
      typeof result.text !== 'string'
      || !result.text.trim()
      || result.text.length > MAX_QUESTION_LENGTH
      || !Array.isArray(result.options)
      || result.options.length !== 4
      || result.options.some((option) => typeof option !== 'string' || !option.trim())
      || !Number.isInteger(result.correctIndex)
      || result.correctIndex < 0
      || result.correctIndex > 3
      || (result.solution !== undefined && typeof result.solution !== 'string')
    )) {
      return res.status(502).json({ success: false, message: 'The AI service returned an incomplete question.' })
    }
    if (operation === 'distractors' && (
      !Array.isArray(result.distractors)
      || result.distractors.length !== Math.max(1, Math.min(options.length - 1, 3))
      || result.distractors.some((item) => typeof item !== 'string' || !item.trim() || item.length > 2000)
    )) {
      return res.status(502).json({ success: false, message: 'The AI service returned invalid answer choices.' })
    }

    return res.json({ success: true, result })
  } catch (error) {
    console.error('AI question-tool endpoint error:', error.message)
    return res.status(error.status || 502).json({
      success: false,
      message: error.status ? error.message : 'The AI question tool could not complete this request.',
    })
  }
})

// POST /api/ai/analytics
// Generates deep diagnostic analytics and personalized recommendations for a test attempt
router.post('/analytics', async (req, res) => {
  try {
    const {
      examName,
      score,
      maxScore,
      percentage,
      timeTaken,
      correctAnswers,
      wrongAnswers,
      unansweredQuestions,
      subjectWiseScores = [],
    } = req.body

    const apiKey = getApiKey()
    if (!apiKey) {
      return res.status(500).json({ success: false, message: 'OpenRouter API key is not configured.' })
    }

    const prompt = `You are an elite MHT-CET exam preparation mentor and academic data analyst.
Analyze the following mock test results of a student preparing for MHT-CET (Engineering / Pharmacy entrance):

Exam Name: ${examName || 'MHT-CET Full Length Mock Test'}
Total Score: ${score} / ${maxScore} (${Number(percentage || 0).toFixed(1)}%)
Time Taken: ${timeTaken || 'Full time'}
Correct: ${correctAnswers} questions
Incorrect: ${wrongAnswers} questions
Unanswered: ${unansweredQuestions} questions
Subject Performance Breakdown:
${subjectWiseScores.map(s => `- ${s.subject}: ${s.score}/${s.maxScore} (${Number(s.percentage || 0).toFixed(1)}%)`).join('\n')}

Provide an expert, highly actionable, encouraging yet honest diagnostic analysis. Set aiScore as a holistic readiness score from 0 to 100 based on score, accuracy, completion, subject balance, and time efficiency.
You MUST respond with valid JSON adhering EXACTLY to this schema (no markdown formatting around the json, pure json):
{
  "aiScore": 0,
  "summaryDiagnosis": "2-3 sentences summarizing the overall performance and readiness for MHT-CET",
  "projectedPercentile": "estimated percentile e.g. 96.5%ile - 98.0%ile",
  "estimatedCetRank": "estimated state rank range e.g. Rank 2,500 - 4,000",
  "speedAndAccuracyAnalysis": "Insight on accuracy rate (${Number(correctAnswers / (correctAnswers + wrongAnswers || 1) * 100).toFixed(1)}%) and time efficiency",
  "strengths": ["Specific strength 1", "Specific strength 2", "Specific strength 3"],
  "weaknesses": ["Specific topic or habit to fix 1", "Specific topic or habit to fix 2", "Specific topic or habit to fix 3"],
  "actionPlan": [
    { "subject": "Mathematics", "priority": "High", "focus": "Chapter/topic to revise", "action": "Actionable practice advice" },
    { "subject": "Physics", "priority": "Medium", "focus": "Chapter/topic to revise", "action": "Actionable practice advice" },
    { "subject": "Chemistry", "priority": "Low", "focus": "Chapter/topic to revise", "action": "Actionable practice advice" }
  ],
  "coachVerdict": "Inspirational concluding tip from an experienced CET ranker coach"
}`

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:5173',
        'X-Title': 'CET Exam Portal',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        response_format: { type: 'json_object' },
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('OpenRouter analytics error:', errText)
      return res.status(502).json({ success: false, message: 'AI service returned an error.', details: errText })
    }

    const result = await response.json()
    const content = result.choices?.[0]?.message?.content || '{}'
    let parsed
    try {
      parsed = JSON.parse(content)
    } catch {
      parsed = { summaryDiagnosis: content }
    }

    return res.json({ success: true, analytics: parsed })
  } catch (error) {
    console.error('AI analytics endpoint error:', error)
    return res.status(500).json({ success: false, message: error.message || 'Internal server error.' })
  }
})

// POST /api/ai/explain-question
// Generates a comprehensive, step-by-step mathematical & conceptual explanation
router.post('/explain-question', async (req, res) => {
  try {
    const {
      text,
      options = [],
      correctIndex,
      userAnswerIndex,
      subject,
      chapter,
      topic,
      existingSolution,
    } = req.body

    const apiKey = getApiKey()
    if (!apiKey) {
      return res.status(500).json({ success: false, message: 'OpenRouter API key is not configured.' })
    }

    const correctOptLetter = String.fromCharCode(65 + Number(correctIndex ?? 0))
    const userOptLetter = userAnswerIndex !== undefined && userAnswerIndex !== null
      ? String.fromCharCode(65 + Number(userAnswerIndex))
      : null

    const prompt = `You are a top MHT-CET Subject Matter Expert (PCM/PCB).
Generate a crystal-clear, pedagogical, step-by-step solution for the following MHT-CET question.

Subject: ${subject || 'General'}
Chapter/Topic: ${chapter || ''} ${topic || ''}
Question:
${text}

Options:
${options.map((opt, i) => `${String.fromCharCode(65 + i)}) ${opt}`).join('\n')}

Correct Option: Option ${correctOptLetter}
${userOptLetter ? `Student chose: Option ${userOptLetter} (${userOptLetter === correctOptLetter ? 'CORRECT' : 'INCORRECT'})` : 'Student did not attempt this question.'}
${existingSolution ? `Author reference notes: ${existingSolution}` : ''}

Formatting instructions:
- Use standard KaTeX mathematical syntax for equations (e.g. $x^2 + y^2 = r^2$, \\frac{a}{b}, \\sqrt{...}, \\int, etc.).
- Provide a structured breakdown with these exact sections:
  ### 1. Key Concept & Formula
  ### 2. Step-by-Step Derivation / Solution
  ### 3. Verification & Correct Option
  ${userOptLetter && userOptLetter !== correctOptLetter ? `### 4. Why Option ${userOptLetter} was Incorrect (Common Trap)` : ''}
  ### 5. MHT-CET Speed Tip / Shortcut
- Keep the explanation crisp, intuitive, and accurate. Do not add fluff.`

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:5173',
        'X-Title': 'CET Exam Portal',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('OpenRouter solution error:', errText)
      return res.status(502).json({ success: false, message: 'AI service error.', details: errText })
    }

    const result = await response.json()
    const explanation = result.choices?.[0]?.message?.content || 'Solution could not be generated at this time.'

    return res.json({ success: true, explanation })
  } catch (error) {
    console.error('AI explain endpoint error:', error)
    return res.status(500).json({ success: false, message: error.message || 'Internal server error.' })
  }
})

module.exports = router
