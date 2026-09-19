const express = require('express')
const router = express.Router()

const getApiKey = () => process.env.OPENROUTER_API_KEY

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

Provide an expert, highly actionable, encouraging yet honest diagnostic analysis.
You MUST respond with valid JSON adhering EXACTLY to this schema (no markdown formatting around the json, pure json):
{
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
