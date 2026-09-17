const express = require('express')
const multer = require('multer')
const XLSX = require('xlsx')
const path = require('path')
const db = require('../services/dbService')
const router = express.Router()
const { apiLimiter, uploadLimiter } = require('../middleware/rateLimit')
const { protect, adminOnly, optionalAuth } = require('../middleware/auth')
const { validateCsrfToken } = require('../middleware/csrf')

// Strict Multer setup for question spreadsheets
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    const allowedExts = ['.xlsx', '.xls', '.csv']
    if (!allowedExts.includes(ext)) {
      return cb(new Error('Only .xlsx, .xls, and .csv files are allowed for question import.'))
    }
    cb(null, true)
  },
})

// GET /api/questions
// Withholds answer keys and solutions from students and anonymous users
router.get('/', optionalAuth, apiLimiter, async (req, res) => {
  const { subject, topic, difficulty, isActive } = req.query
  const filter = {}
  if (subject) filter.subject = subject
  if (topic) filter.topic = topic
  if (difficulty) filter.difficulty = difficulty
  if (typeof isActive !== 'undefined') filter.isActive = isActive === 'true'

  const isAdmin = req.user?.role === 'admin'

  try {
    const questions = await db.getQuestions(filter, { isAdmin })
    res.json(questions)
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to load questions' })
  }
})

// GET /api/questions/meta/subjects-chapters
router.get('/meta/subjects-chapters', apiLimiter, async (req, res) => {
  try {
    const questions = await db.getQuestions({ isActive: true }, { isAdmin: false })

    const subjectsSet = new Set()
    const chaptersBySubject = {}

    questions.forEach((q) => {
      if (q.subject) {
        subjectsSet.add(q.subject)
        if (q.chapter) {
          if (!chaptersBySubject[q.subject]) {
            chaptersBySubject[q.subject] = new Set()
          }
          chaptersBySubject[q.subject].add(q.chapter)
        }
      }
    })

    const result = Object.fromEntries(
      Object.entries(chaptersBySubject).map(([subject, chaptersSet]) => [subject, Array.from(chaptersSet)])
    )

    res.json({ subjects: Array.from(subjectsSet), chaptersBySubject: result })
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to load subjects and chapters' })
  }
})

// GET /api/questions/:id
router.get('/:id', optionalAuth, apiLimiter, async (req, res) => {
  try {
    const isAdmin = req.user?.role === 'admin'
    const question = await db.getQuestionById(req.params.id, { isAdmin })
    if (!question) {
      return res.status(404).json({ success: false, message: 'Question not found' })
    }
    res.json(question)
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to load question' })
  }
})

// POST /api/questions — ADMIN ONLY
router.post('/', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    const { subject, text, options, correctIndex, marks } = req.body
    if (!subject || !text) {
      return res.status(400).json({ success: false, message: 'Subject and question text are required.' })
    }
    if (!Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ success: false, message: 'At least two options are required.' })
    }
    const cIdx = Number(correctIndex)
    if (isNaN(cIdx) || cIdx < 0 || cIdx >= options.length) {
      return res.status(400).json({ success: false, message: 'Invalid correct answer index.' })
    }

    const question = await db.createQuestion(req.body)
    res.status(201).json(question)
  } catch (e) {
    res.status(400).json({ success: false, message: 'Invalid question data: ' + e.message })
  }
})

const uploadHandler = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || 'Upload failed',
      })
    }
    next()
  })
}

// POST /api/questions/upload — ADMIN ONLY BULK IMPORT
router.post('/upload', protect, adminOnly, validateCsrfToken, uploadLimiter, uploadHandler, async (req, res) => {
  const file = req.file
  if (!file) return res.status(400).json({ success: false, message: 'Spreadsheet file is required.' })

  try {
    const workbook = XLSX.read(file.buffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) return res.status(400).json({ success: false, message: 'No sheet found in file.' })

    const sheet = workbook.Sheets[sheetName]
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
    if (!rawRows.length) return res.status(400).json({ success: false, message: 'No data rows found in file.' })

    const normalize = (key) => String(key || '').trim().toLowerCase().replace(/[_\s]+/g, ' ')
    const headerCandidates = rawRows.slice(0, 5)

    const candidateScores = headerCandidates.map((row, index) => {
      const keys = row.map((cell) => normalize(cell))
      const score = keys.reduce((count, key) => {
        if (!key) return count
        if (['question', 'question text', 'item', 'stem', 'question statement', 'q'].includes(key)) return count + 3
        if (['subject', 'course', 'section'].includes(key)) return count + 2
        if (['topic', 'chapter', 'module', 'sub topic'].includes(key)) return count + 2
        if (['difficulty', 'level', 'difficulty level'].includes(key)) return count + 1
        if (['correct answer', 'correct option', 'answer', 'correct'].includes(key)) return count + 1
        if (/^(option|choice|opt|a|b|c|d)( [1-4])?$/.test(key)) return count + 1
        if (/^[1-4]$/.test(key)) return count + 1
        return count
      }, 0)
      return { index, score, keys }
    })

    const bestHeader = candidateScores.reduce((best, current) => (current.score > best.score ? current : best), {
      index: 0,
      score: -1,
      keys: [],
    })
    const headerRowIndex = bestHeader.score > 0 ? bestHeader.index : 0
    const headerRow = rawRows[headerRowIndex]
    const headers = headerRow.map(normalize)

    const headerMap = headers.reduce((acc, key, index) => {
      if (key) acc[key] = index
      return acc
    }, {})

    const findHeader = (names) => names.map((name) => normalize(name)).find((key) => key && headerMap[key] !== undefined)
    const headerIndex = (names) => {
      const key = findHeader(names)
      return key !== undefined ? headerMap[key] : undefined
    }

    const textIndex = headerIndex(['question', 'question text', 'item', 'stem', 'question statement', 'q'])
    const subjectIndex = headerIndex(['subject', 'course', 'section'])
    const chapterIndex = headerIndex(['chapter', 'section', 'unit'])
    const topicIndex = headerIndex(['topic', 'module'])
    const subTopicIndex = headerIndex(['sub topic', 'subtopic', 'sub-topic'])
    const difficultyIndex = headerIndex(['difficulty', 'level', 'difficulty level'])
    const correctIndex = headerIndex(['correct answer', 'correct option', 'answer', 'correct'])
    const explanationIndex = headerIndex(['explanation', 'solution', 'detailed solution', 'answer explanation'])
    const marksIndex = headerIndex(['marks', 'score', 'points'])
    const negativeIndex = headerIndex(['negative marks', 'neg marks', 'penalty'])
    const statusIndex = headerIndex(['status', 'is active', 'active'])

    let optionIndices = headers
      .map((key, index) => ({ key, index }))
      .filter((item) => /^(?:option|choice|opt)\s*[a-d1-4]$/.test(item.key) || /^[a-d1-4]$/.test(item.key))
      .sort((a, b) => {
        const order = (key) => {
          const match = key.match(/([1-4]|[a-d])$/)
          if (!match) return 0
          const value = match[1]
          if (/^[1-4]$/.test(value)) return Number(value)
          return value.charCodeAt(0) - 96
        }
        return order(a.key) - order(b.key)
      })
      .map((item) => item.index)

    if (!optionIndices.length) {
      const questionCol = textIndex !== undefined ? textIndex : headers.indexOf('question')
      const maxCol = correctIndex !== undefined ? correctIndex : Math.min(questionCol + 5, headers.length)
      optionIndices = []
      for (let i = questionCol + 1; i < maxCol && optionIndices.length < 4; i += 1) {
        optionIndices.push(i)
      }
    }

    const convertCorrectIndex = (raw, options) => {
      if (raw === undefined || raw === null) return 0
      const value = String(raw).trim()
      if (/^[1-4]$/.test(value)) return Number(value) - 1
      if (/^[a-d]$/i.test(value)) return value.toLowerCase().charCodeAt(0) - 97
      const optionIndex = options.findIndex((opt) => opt.toLowerCase() === value.toLowerCase())
      return optionIndex >= 0 ? optionIndex : 0
    }

    const parseBool = (raw) => {
      if (typeof raw === 'boolean') return raw
      const value = String(raw).trim().toLowerCase()
      if (['false', 'no', '0', 'draft', 'inactive', 'not active'].includes(value)) return false
      return true
    }

    const rowsToSave = []
    const errors = []

    const findFallbackOptions = (row, questionCol) => {
      const opts = []
      const start = questionCol !== undefined ? questionCol + 1 : 0
      for (let j = start; j < row.length && opts.length < 4; j += 1) {
        const value = String(row[j] ?? '').trim()
        if (!value) continue
        if (questionCol !== undefined && j === questionCol) continue
        opts.push(value)
      }
      return opts
    }

    for (let rowIndex = headerRowIndex + 1; rowIndex < rawRows.length; rowIndex += 1) {
      const row = rawRows[rowIndex]
      if (!row || row.every((cell) => String(cell || '').trim() === '')) continue

      const get = (idx) => row[idx] ?? ''
      let questionText = ''
      if (textIndex !== undefined) {
        questionText = String(get(textIndex)).trim()
      } else {
        questionText = String(row[0] ?? '').trim()
      }

      if (!questionText) {
        const firstNonEmpty = row.find((cell) => String(cell ?? '').trim())
        if (firstNonEmpty && typeof firstNonEmpty === 'string') questionText = String(firstNonEmpty).trim()
      }

      if (!questionText) {
        errors.push({ row: rowIndex + 1, message: 'Missing question text' })
        continue
      }

      const options = optionIndices.map((idx) => String(get(idx)).trim()).filter(Boolean)
      if (!options.length) {
        options.push(...findFallbackOptions(row, textIndex))
      }

      if (!options.length && row.length > 1) {
        const fallback = row.slice(1, 5).map((cell) => String(cell ?? '').trim()).filter(Boolean)
        if (fallback.length >= 2) options.push(...fallback)
      }

      if (!options.length) {
        errors.push({ row: rowIndex + 1, message: 'Missing answer options' })
        continue
      }

      const question = {
        subject: subjectIndex !== undefined ? String(get(subjectIndex)).trim() || 'General' : 'General',
        chapter: chapterIndex !== undefined ? String(get(chapterIndex)).trim() : '',
        topic:
          topicIndex !== undefined
            ? String(get(topicIndex)).trim() || (chapterIndex !== undefined ? String(get(chapterIndex)).trim() || 'General' : 'General')
            : chapterIndex !== undefined
            ? String(get(chapterIndex)).trim() || 'General'
            : 'General',
        subTopic: subTopicIndex !== undefined ? String(get(subTopicIndex)).trim() : '',
        text: questionText,
        options,
        solution: explanationIndex !== undefined ? String(get(explanationIndex)).trim() : '',
        correctIndex: convertCorrectIndex(correctIndex !== undefined ? get(correctIndex) : '', options),
        marks: Number(marksIndex !== undefined ? get(marksIndex) : 0) || 2,
        negativeMarks: Number(negativeIndex !== undefined ? get(negativeIndex) : 0) || 0,
        difficulty:
          difficultyIndex !== undefined && ['Easy', 'Medium', 'Hard'].includes(String(get(difficultyIndex)).trim())
            ? String(get(difficultyIndex)).trim()
            : 'Medium',
        isActive: statusIndex !== undefined ? parseBool(get(statusIndex)) : true,
      }
      rowsToSave.push(question)
    }

    if (!rowsToSave.length) {
      return res.status(400).json({
        success: false,
        message: 'No valid questions found in file',
        details: { errors },
      })
    }

    const created = []
    for (const qData of rowsToSave) {
      const q = await db.createQuestion(qData)
      created.push(q)
    }

    res.status(201).json({ success: true, imported: created.length, total: rowsToSave.length, errors })
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to upload questions: ' + (e.message || e) })
  }
})

// PUT /api/questions/:id — ADMIN ONLY
router.put('/:id', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    const updated = await db.updateQuestion(req.params.id, req.body)
    res.json(updated)
  } catch (e) {
    res.status(400).json({ success: false, message: 'Invalid question data: ' + e.message })
  }
})

// DELETE /api/questions/:id — ADMIN ONLY
router.delete('/:id', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    await db.deleteQuestion(req.params.id)
    res.json({ success: true, message: 'Deleted' })
  } catch (e) {
    res.status(400).json({ success: false, message: 'Delete failed' })
  }
})

module.exports = router