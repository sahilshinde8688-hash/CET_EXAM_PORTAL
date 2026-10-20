const { createHash } = require('crypto')
const { normalizeMathText } = require('../services/mathText')

const normalizeIdentityText = (value) => {
  const decoded = String(value || '')
    .replace(/<sup\b[^>]*>/gi, '^')
    .replace(/<\/sup>/gi, '')
    .replace(/<sub\b[^>]*>/gi, '_')
    .replace(/<\/sub>/gi, '')
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
  return normalizeMathText(decoded)
    .toLowerCase()
    .replace(/([a-z])\.(?=\s|$)/gi, '$1')
    .replace(/[^\p{L}\p{N}^_+*/÷×=<>≤≥≠±√.\-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const createQuestionHash = (question = {}) => {
  const text = normalizeIdentityText(question.text)
  if (!text || !/[\p{L}\p{N}]/u.test(text)) return null

  const options = Array.isArray(question.options)
    ? question.options.map(normalizeIdentityText).filter(Boolean).sort()
    : []
  const correctIndex = Number(question.correctIndex)
  const correctAnswer = Number.isInteger(correctIndex) && correctIndex >= 0
    ? normalizeIdentityText(question.options?.[correctIndex])
    : ''
  const identity = {
    subject: normalizeIdentityText(question.subject),
    chapter: normalizeIdentityText(question.chapter),
    topic: normalizeIdentityText(question.topic),
    subTopic: normalizeIdentityText(question.subTopic),
    text,
    imageUrl: String(question.imageUrl || '').trim(),
    options,
    correctAnswer,
    solution: normalizeIdentityText(question.solution),
  }

  return createHash('sha256').update(JSON.stringify(identity)).digest('hex')
}

module.exports = { createQuestionHash }
