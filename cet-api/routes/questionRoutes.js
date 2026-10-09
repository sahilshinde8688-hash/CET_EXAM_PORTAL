const express = require('express')
const multer = require('multer')
const XLSX = require('xlsx')
const path = require('path')
const db = require('../services/dbService')
const router = express.Router()
const { apiLimiter, uploadLimiter } = require('../middleware/rateLimit')
const { protect, adminOnly, optionalAuth } = require('../middleware/auth')
const { validateCsrfToken } = require('../middleware/csrf')
const { extractAndFlagDuplicates, looksLikePdf, PdfTextError } = require('../services/pdfImportService')
const {
  buildAnalysis,
  getCetTaxonomy,
  QUESTION_TYPES,
  CET_RELEVANCE_LEVELS,
  CET_DIFFICULTY_LEVELS,
  CLASSIFICATION_SOURCES,
} = require('../services/cetClassification')
const {
  NotesGenerationError,
  generateFromNotes,
  regenerateQuestion,
  validateEditedQuestion,
  validateConfig: validateNotesConfig,
} = require('../services/notesQuestionGeneration')
const { flagDuplicates, normalizeForMatching, similarity } = require('../utils/duplicateDetection')

const requireAdminQuery = (req, res, next) => {
  if (req.query.admin !== 'true') return next()
  return protect(req, res, () => adminOnly(req, res, next))
}

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
router.get('/', requireAdminQuery, optionalAuth, apiLimiter, async (req, res) => {
  const { subject, topic, difficulty, isActive, ids } = req.query
  const filter = {}
  if (subject) filter.subject = subject
  if (topic) filter.topic = topic
  if (difficulty) filter.difficulty = difficulty
  if (typeof isActive !== 'undefined') filter.isActive = isActive === 'true'
  if (ids) filter.ids = String(ids).split(',').filter(Boolean)

  const shouldIncludeAnswers = req.query.admin === 'true'

  try {
    const questions = await db.getQuestions(filter, { isAdmin: shouldIncludeAnswers })
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

// GET /api/questions/meta/cet-taxonomy
// MHT-CET syllabus taxonomy + classification vocabularies for the admin review UI dropdowns
router.get('/meta/cet-taxonomy', apiLimiter, async (req, res) => {
  res.json({
    subjects: getCetTaxonomy(),
    questionTypes: QUESTION_TYPES,
    cetRelevanceLevels: CET_RELEVANCE_LEVELS,
    cetDifficultyLevels: CET_DIFFICULTY_LEVELS,
    classificationSources: CLASSIFICATION_SOURCES,
  })
})

// ── AI QUESTION GENERATION FROM PDF/PPTX NOTES — ADMIN ONLY ──────────────

const NOTES_MAX_UPLOAD_MB = Number(process.env.NOTES_MAX_UPLOAD_MB || 25)
const NOTES_JOB_TTL_MS = 30 * 60 * 1000
const NOTES_MAX_ACTIVE_JOBS = 1
const notesJobs = new Map()

const pruneNotesJobs = () => {
  const now = Date.now()
  for (const [id, job] of notesJobs) {
    if (job.status !== 'processing' && job.expiresAt <= now) notesJobs.delete(id)
  }
}

const notesUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: NOTES_MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 1, fieldSize: 64 * 1024 },
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase()
    if (!['.pdf', '.pptx'].includes(extension)) {
      return cb(new Error('Only PDF and PPTX notes files are supported.'))
    }
    cb(null, true)
  },
})

const notesUploadHandler = (req, res, next) => {
  notesUpload.single('file')(req, res, (error) => {
    if (error) return res.status(400).json({ success: false, message: error.message || 'Notes upload failed.' })
    next()
  })
}

const notesJobResultForClient = (result) => {
  const { _sourcePages, _topicsFull, _config, ...publicResult } = result
  return publicResult
}

router.post('/notes/generate', protect, adminOnly, validateCsrfToken, uploadLimiter, notesUploadHandler, async (req, res) => {
  pruneNotesJobs()
  const file = req.file
  if (!file) return res.status(400).json({ success: false, message: 'Choose a PDF or PPTX notes file.' })

  let config
  try {
    config = validateNotesConfig(JSON.parse(String(req.body.config || '{}')))
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message || 'Generation settings are invalid.' })
  }

  const ownerId = String(req.user.id || req.user._id)
  const activeJobs = [...notesJobs.values()].filter((job) => job.status === 'processing').length
  if (activeJobs >= NOTES_MAX_ACTIVE_JOBS) {
    return res.status(429).json({ success: false, message: 'A notes-generation job is already processing. Wait for it to finish before uploading another.' })
  }

  const jobId = require('crypto').randomUUID()
  const fileName = path.basename(String(file.originalname || 'notes')).slice(0, 200)
  const job = {
    id: jobId,
    ownerId,
    status: 'processing',
    stage: 'Queued',
    percent: 0,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + NOTES_JOB_TTL_MS,
    result: null,
    error: null,
  }
  notesJobs.set(jobId, job)

  setImmediate(async () => {
    try {
      job.result = await generateFromNotes({
        buffer: file.buffer,
        fileName,
        rawConfig: config,
        onProgress: (stage, percent) => {
          job.stage = stage
          job.percent = Math.min(99, Math.max(job.percent, percent))
        },
      })
      try {
        const existingQuestions = await db.getQuestionFingerprints()
        const duplicateChecks = flagDuplicates(
          job.result.questions.map((question) => ({ question: question.text })),
          existingQuestions,
        )
        duplicateChecks.forEach((check, index) => {
          if (!check.duplicate) return
          const question = job.result.questions[index]
          question.validationIssues.push(`This question may duplicate an existing Question Bank item (${check.duplicateType}).`)
          question.selected = false
        })
      } catch (error) {
        console.error('Could not check AI-generated questions against the Question Bank:', error.message)
        job.result.warnings.push('Existing Question Bank duplicate checking was unavailable; review each question carefully before approving.')
        job.result.questions.forEach((question) => {
          question.validationIssues.push('Existing Question Bank duplicate check was unavailable.')
          question.selected = false
        })
      }
      job.status = 'completed'
      job.stage = 'Ready for review'
      job.percent = 100
      job.expiresAt = Date.now() + NOTES_JOB_TTL_MS
    } catch (error) {
      if (!(error instanceof NotesGenerationError)) {
        console.error('AI notes generation job failed:', error.message)
      }
      job.error = {
        message: error instanceof NotesGenerationError
          ? error.message
          : 'Question generation failed unexpectedly. Please retry.',
      }
      job.status = 'failed'
      job.stage = 'Failed'
      job.expiresAt = Date.now() + NOTES_JOB_TTL_MS
    }
  })

  return res.status(202).json({ success: true, jobId, status: job.status })
})

router.get('/notes/jobs/:jobId', protect, adminOnly, apiLimiter, (req, res) => {
  pruneNotesJobs()
  const job = notesJobs.get(req.params.jobId)
  if (!job || job.ownerId !== String(req.user.id || req.user._id)) {
    return res.status(404).json({ success: false, message: 'Notes generation job was not found or has expired.' })
  }
  res.set('Cache-Control', 'no-store')
  return res.json({
    success: true,
    status: job.status,
    stage: job.stage,
    percent: job.percent,
    ...(job.status === 'completed' ? { result: notesJobResultForClient(job.result) } : {}),
    ...(job.status === 'failed' ? { error: job.error } : {}),
  })
})

router.post('/notes/jobs/:jobId/validate', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  const job = notesJobs.get(req.params.jobId)
  if (!job || job.ownerId !== String(req.user.id || req.user._id) || job.status !== 'completed') {
    return res.status(404).json({ success: false, message: 'The completed generation job was not found or has expired.' })
  }
  const questionIndex = Number(req.body?.questionIndex)
  if (!Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= job.result.questions.length) {
    return res.status(400).json({ success: false, message: 'Select a valid question to validate.' })
  }
  const supplied = req.body?.question
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)
    || !['subject', 'topic', 'subTopic', 'text', 'solution', 'requestedDifficulty'].every((key) => typeof supplied[key] === 'string')
    || !Array.isArray(supplied.options) || supplied.options.some((option) => typeof option !== 'string')) {
    return res.status(400).json({ success: false, message: 'Edited question data is invalid.' })
  }

  try {
    const current = job.result.questions[questionIndex]
    const topic = job.result._topicsFull.find((item) => item.name.toLowerCase() === current.chapter.toLowerCase())
    if (!topic) return res.status(422).json({ success: false, message: 'The original question topic is no longer available for validation.' })
    const candidate = {
      subject: supplied.subject,
      topic: supplied.topic,
      subTopic: supplied.subTopic,
      text: supplied.text,
      options: supplied.options,
      solution: supplied.solution,
      correctIndex: supplied.correctIndex,
      requestedDifficulty: supplied.requestedDifficulty,
      sourcePage: current.sourcePage,
      evidence: current.evidence,
    }
    const validation = await validateEditedQuestion({
      question: candidate,
      pages: job.result._sourcePages,
      topic,
    })
    const matchingQuestion = job.result.questions.some((question, index) =>
      index !== questionIndex && similarity(
        normalizeForMatching(question.text),
        normalizeForMatching(candidate.text),
      ) >= 0.9,
    )
    if (matchingQuestion) validation.validationIssues.push('This edit duplicates another generated question.')

    const existingQuestions = await db.getQuestionFingerprints()
    const duplicateCheck = flagDuplicates(
      [{ question: candidate.text }],
      existingQuestions,
    )[0]
    if (duplicateCheck.duplicate) {
      validation.validationIssues.push(`This question may duplicate an existing Question Bank item (${duplicateCheck.duplicateType}).`)
    }

    const updated = {
      ...current,
      ...candidate,
      difficulty: candidate.requestedDifficulty === 'Very Hard' ? 'Hard' : candidate.requestedDifficulty,
      confidence: validation.confidence,
      validationIssues: validation.validationIssues,
      selected: validation.validationIssues.length === 0,
      approved: false,
    }
    job.result.questions[questionIndex] = updated
    res.set('Cache-Control', 'no-store')
    return res.json({ success: true, question: updated })
  } catch (error) {
    const status = error.statusCode || 502
    return res.status(status).json({
      success: false,
      message: error instanceof NotesGenerationError
        ? error.message
        : 'Could not verify the edited question. Please retry.',
    })
  }
})

router.post('/notes/jobs/:jobId/regenerate', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  const job = notesJobs.get(req.params.jobId)
  if (!job || job.ownerId !== String(req.user.id || req.user._id) || job.status !== 'completed') {
    return res.status(404).json({ success: false, message: 'The completed generation job was not found or has expired.' })
  }
  const questionIndex = Number(req.body?.questionIndex)
  if (!Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= job.result.questions.length) {
    return res.status(400).json({ success: false, message: 'Select a valid question to regenerate.' })
  }

  try {
    const current = job.result.questions[questionIndex]
    const topic = job.result._topicsFull.find((item) => item.name.toLowerCase() === current.chapter.toLowerCase())
    if (!topic) return res.status(422).json({ success: false, message: 'The original question topic is no longer available for regeneration.' })
    const replacement = await regenerateQuestion({
      question: current,
      pages: job.result._sourcePages,
      topic,
      config: job.result._config,
      fileName: job.result.sourceDocument,
      sourceType: job.result.sourceType,
    })
    const duplicateInJob = job.result.questions.some((question, index) =>
      index !== questionIndex && similarity(
        normalizeForMatching(question.text),
        normalizeForMatching(replacement.text),
      ) >= 0.9,
    )
    if (duplicateInJob) replacement.validationIssues.push('This replacement duplicates another generated question.')
    const existingQuestions = await db.getQuestionFingerprints()
    const duplicateCheck = flagDuplicates([{ question: replacement.text }], existingQuestions)[0]
    if (duplicateCheck.duplicate) {
      replacement.validationIssues.push(`This replacement may duplicate an existing Question Bank item (${duplicateCheck.duplicateType}).`)
    }
    replacement.selected = replacement.validationIssues.length === 0
    replacement.approved = false
    job.result.questions[questionIndex] = replacement
    return res.json({ success: true, question: replacement })
  } catch (error) {
    const status = error.statusCode || 502
    return res.status(status).json({
      success: false,
      message: error instanceof NotesGenerationError ? error.message : 'Could not regenerate this question. Please retry.',
    })
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

// ── PDF QUESTION EXTRACTION — ADMIN ONLY ─────────────────────────────────

const PDF_MAX_UPLOAD_MB = Number(process.env.PDF_MAX_UPLOAD_MB || 20)
const MAX_BATCH_QUESTIONS = 300
const MAX_AI_CLASSIFY_QUESTIONS = 40
const PDF_EXTRACTION_JOB_TTL_MS = 15 * 60 * 1000
const PDF_EXTRACTION_MAX_ACTIVE_JOBS = 2
const QUESTION_DIFFICULTIES = new Set(['Easy', 'Medium', 'Hard'])
const DUPLICATE_ACTIONS = new Set(['skip', 'import', 'replace'])
const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F']
const pdfExtractionJobs = new Map()

const prunePdfExtractionJobs = () => {
  const now = Date.now()
  for (const [id, job] of pdfExtractionJobs) {
    if (job.status !== 'processing' && job.expiresAt <= now) pdfExtractionJobs.delete(id)
  }
}

// Multer for PDFs: memory storage only (nothing is ever written to disk),
// strict size cap and extension/content-type filtering.
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PDF_MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    const mimeTypeOk = !file.mimetype
      || file.mimetype === 'application/pdf'
      || file.mimetype === 'application/octet-stream' // some browsers/OS mislabel
    if (ext !== '.pdf' || !mimeTypeOk) {
      return cb(new Error('Only .pdf files are allowed for PDF question extraction.'))
    }
    cb(null, true)
  },
})

const pdfUploadHandler = (req, res, next) => {
  pdfUpload.single('file')(req, res, (err) => {
    if (!err) return next()
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        message: `PDF is too large. Maximum upload size is ${PDF_MAX_UPLOAD_MB}MB.`,
      })
    }
    return res.status(400).json({ success: false, message: err.message || 'Upload failed' })
  })
}

/**
 * POST /api/questions/extract/pdf/jobs — ADMIN ONLY
 * Starts extraction in-process and returns immediately so slow OCR does not
 * hold open the reverse-proxy request until it times out.
 */
router.post('/extract/pdf/jobs', protect, adminOnly, validateCsrfToken, uploadLimiter, pdfUploadHandler, (req, res) => {
  const file = req.file
  if (!file) return res.status(400).json({ success: false, message: 'PDF file is required.' })
  if (!looksLikePdf(file.buffer)) {
    return res.status(400).json({ success: false, message: 'This file is not a valid PDF document.' })
  }

  prunePdfExtractionJobs()
  const activeJobs = [...pdfExtractionJobs.values()].filter((job) => job.status === 'processing' || job.status === 'queued')
  if (activeJobs.length >= PDF_EXTRACTION_MAX_ACTIVE_JOBS) {
    return res.status(429).json({
      success: false,
      message: 'PDF processing is busy. Please wait for the current import to finish and try again.',
    })
  }

  const { randomUUID } = require('crypto')
  const jobId = randomUUID()
  const ownerId = String(req.user.id || req.user._id)
  const fileName = String(file.originalname || '').slice(0, 200)
  const job = {
    ownerId,
    status: 'queued',
    stage: 'Queued for processing',
    percent: 0,
    createdAt: Date.now(),
    expiresAt: Date.now() + PDF_EXTRACTION_JOB_TTL_MS,
    result: null,
    error: null,
  }
  pdfExtractionJobs.set(jobId, job)

  setImmediate(async () => {
    job.status = 'processing'
    job.stage = 'Reading PDF'
    job.percent = 5
    try {
      const result = await extractAndFlagDuplicates(file.buffer, {
        fileName,
        onProgress: ({ stage, percent }) => {
          job.stage = stage
          job.percent = Math.max(job.percent, Math.min(99, percent))
        },
      })
      job.result = {
        totalExtracted: result.questions.length,
        duplicateCount: result.duplicateCount,
        questions: result.questions,
        warnings: result.warnings,
        analysis: result.analysis,
        meta: {
          ...result.meta,
          fileName,
          sizeBytes: file.size,
        },
      }
      job.status = 'completed'
      job.stage = 'Complete'
      job.percent = 100
      job.expiresAt = Date.now() + PDF_EXTRACTION_JOB_TTL_MS
    } catch (err) {
      if (!(err instanceof PdfTextError)) {
        console.error('PDF question extraction job failed:', err.message)
      }
      job.error = {
        code: err instanceof PdfTextError ? err.code : 'PDF_EXTRACTION_FAILED',
        message: err instanceof PdfTextError
          ? err.message
          : 'Failed to extract questions from the PDF. Please try again.',
      }
      job.status = 'failed'
      job.stage = 'Failed'
      job.expiresAt = Date.now() + PDF_EXTRACTION_JOB_TTL_MS
    }
  })

  res.status(202).json({ success: true, jobId, status: job.status })
})

/** GET /api/questions/extract/pdf/jobs/:jobId — ADMIN ONLY */
router.get('/extract/pdf/jobs/:jobId', protect, adminOnly, apiLimiter, (req, res) => {
  prunePdfExtractionJobs()
  const job = pdfExtractionJobs.get(req.params.jobId)
  if (!job || job.ownerId !== String(req.user.id || req.user._id)) {
    return res.status(404).json({ success: false, message: 'PDF extraction job was not found or has expired.' })
  }

  res.set('Cache-Control', 'no-store')
  return res.json({
    success: true,
    status: job.status,
    stage: job.stage,
    percent: job.percent,
    ...(job.status === 'completed' ? { result: job.result } : {}),
    ...(job.status === 'failed' ? { error: job.error } : {}),
  })
})

/**
 * POST /api/questions/extract/pdf — ADMIN ONLY
 * Extracts questions from an uploaded PDF (text layer, or OCR for scans),
 * flags duplicates against the existing bank, classifies every question
 * against the MHT-CET syllabus and returns them with a distribution
 * analysis for review. Nothing is imported at this stage — the admin
 * confirms via /import/batch.
 */
router.post('/extract/pdf', protect, adminOnly, validateCsrfToken, uploadLimiter, pdfUploadHandler, async (req, res) => {
  const file = req.file
  if (!file) return res.status(400).json({ success: false, message: 'PDF file is required.' })

  // Magic-byte check: never trust the client-supplied name/type alone
  if (!looksLikePdf(file.buffer)) {
    return res.status(400).json({ success: false, message: 'This file is not a valid PDF document.' })
  }

  try {
    const result = await extractAndFlagDuplicates(file.buffer, { fileName: String(file.originalname || '').slice(0, 200) })
    return res.json({
      success: true,
      totalExtracted: result.questions.length,
      duplicateCount: result.duplicateCount,
      questions: result.questions,
      warnings: result.warnings,
      analysis: result.analysis,
      meta: {
        ...result.meta,
        fileName: String(file.originalname || '').slice(0, 200),
        sizeBytes: file.size,
      },
    })
  } catch (err) {
    if (err instanceof PdfTextError) {
      const status = err.code === 'PROCESSING_TIMEOUT' ? 504 : 400
      return res.status(status).json({ success: false, message: err.message, code: err.code })
    }
    console.error('PDF question extraction failed:', err.message)
    return res.status(500).json({ success: false, message: 'Failed to extract questions from the PDF. Please try again.' })
  }
})

/** Strip control characters and cap length on admin-edited import payloads. */
const cleanImportString = (value, maxLen) => {
  const text = String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
  return text.length > maxLen ? text.slice(0, maxLen).trimEnd() : text
}

/** Validate and normalise one admin-confirmed question for DB persistence. */
const validateImportQuestion = (raw, position) => {
  const number = Number(raw.questionNumber) || position + 1
  const fail = (message) => ({ error: { questionNumber: number, message } })

  const text = cleanImportString(raw.question ?? raw.text, 5000)
  if (!text) return fail('Missing question text')

  let optionList = []
  if (Array.isArray(raw.options)) {
    optionList = raw.options.map((opt) => cleanImportString(opt, 1000)).filter(Boolean)
  } else if (raw.options && typeof raw.options === 'object') {
    optionList = OPTION_KEYS
      .map((key) => cleanImportString(raw.options[key], 1000))
      .filter(Boolean)
  }
  if (optionList.length < 2) return fail('At least two non-empty options are required')
  if (optionList.length > 6) optionList = optionList.slice(0, 6)
  if (new Set(optionList).size !== optionList.length) return fail('Options contain duplicate values')

  let correctIndex = -1
  const letter = String(raw.correctAnswer ?? '').trim().toUpperCase()
  if (/^[A-F]$/.test(letter)) {
    correctIndex = letter.charCodeAt(0) - 65
  } else if (raw.correctIndex !== undefined && raw.correctIndex !== null && raw.correctIndex !== '') {
    correctIndex = Number(raw.correctIndex)
  }
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= optionList.length) {
    return fail('Correct answer does not match any option')
  }

  const chapter = cleanImportString(raw.chapter, 200)
  const difficultyRaw = String(raw.difficulty ?? '').trim()
  const difficultyTitled = difficultyRaw.replace(/^\w/, (c) => c.toUpperCase())
  let difficulty = QUESTION_DIFFICULTIES.has(difficultyRaw)
    ? difficultyRaw
    : QUESTION_DIFFICULTIES.has(difficultyTitled)
      ? difficultyTitled
      : 'Medium'

  // ── CET classification fields (admin-editable in the review UI) ────────
  const cetDifficultyRaw = String(raw.cetDifficulty ?? '').trim()
  const cetDifficulty = CET_DIFFICULTY_LEVELS.includes(cetDifficultyRaw) ? cetDifficultyRaw : ''
  const questionTypeRaw = String(raw.questionType ?? '').trim()
  const questionType = QUESTION_TYPES.includes(questionTypeRaw) ? questionTypeRaw : ''
  const cetRelevanceRaw = String(raw.cetRelevance ?? '').trim()
  const cetRelevance = CET_RELEVANCE_LEVELS.includes(cetRelevanceRaw) ? cetRelevanceRaw : ''
  const classificationSourceRaw = String(raw.classificationSource ?? '').trim()
  const classificationSource = CLASSIFICATION_SOURCES.includes(classificationSourceRaw) ? classificationSourceRaw : ''
  const classificationConfidenceNum = Number(raw.classificationConfidence)
  const classificationConfidence = Number.isFinite(classificationConfidenceNum)
    ? Math.max(0, Math.min(1, classificationConfidenceNum))
    : null

  // Legacy 3-level difficulty keeps driving existing tests/UI; the CET
  // classification refines the parser default when the admin did not set one.
  if (cetDifficulty && difficulty === 'Medium') {
    difficulty = { Easy: 'Easy', Moderate: 'Medium', Hard: 'Hard', 'Very Hard': 'Hard' }[cetDifficulty]
  }

  const sourcePageNum = Number(raw.sourcePage)
  const sourcePage = Number.isInteger(sourcePageNum) && sourcePageNum > 0 ? sourcePageNum : null

  const subjectRaw = cleanImportString(raw.subject, 120)
  const topicRaw = cleanImportString(raw.topic, 200)
  const actionRaw = String(raw.duplicateAction ?? 'import').toLowerCase()
  const duplicateAction = DUPLICATE_ACTIONS.has(actionRaw) ? actionRaw : 'import'
  const duplicateOfId = raw.duplicateOfId && typeof raw.duplicateOfId === 'string' ? raw.duplicateOfId : null

  if (duplicateAction === 'replace' && !duplicateOfId) {
    return fail('Replace action requires the id of the existing question')
  }

  return {
    data: {
      subject: subjectRaw || 'General',
      chapter,
      topic: topicRaw || chapter || 'General',
      subTopic: cleanImportString(raw.subTopic, 200),
      text,
      options: optionList,
      correctIndex,
      solution: cleanImportString(raw.solution, 5000),
      marks: Number.isFinite(Number(raw.marks)) && Number(raw.marks) > 0 ? Number(raw.marks) : 2,
      negativeMarks: Number.isFinite(Number(raw.negativeMarks)) ? Number(raw.negativeMarks) : 0,
      difficulty,
      isActive: raw.isActive !== undefined ? Boolean(raw.isActive) : true,
      questionType,
      cetDifficulty,
      cetRelevance,
      classificationConfidence,
      classificationSource,
      sourcePdf: cleanImportString(raw.sourcePdf, 200),
      sourcePage,
      sourceQuestionNumber: number,
      duplicateAction,
      duplicateOfId,
      questionNumber: number,
    },
  }
}

/**
 * POST /api/questions/import/batch — ADMIN ONLY
 * Persists admin-reviewed questions from the PDF import preview. Reuses the
 * exact same question schema and db service as the Excel import. Duplicate
 * strategy per question: skip | import | replace.
 */
router.post('/import/batch', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  const incoming = Array.isArray(req.body?.questions) ? req.body.questions : null
  if (!incoming || !incoming.length) {
    return res.status(400).json({ success: false, message: 'questions array is required.' })
  }
  if (incoming.length > MAX_BATCH_QUESTIONS) {
    return res.status(400).json({
      success: false,
      message: `Too many questions in one batch (${incoming.length}). Import at most ${MAX_BATCH_QUESTIONS} at a time.`,
    })
  }

  const selected = incoming.filter((q) => q.selected !== false)
  if (!selected.length) {
    return res.status(400).json({ success: false, message: 'No questions are selected for import.' })
  }

  const errors = []
  const toCreate = []
  const toReplace = []
  let skipped = 0

  selected.forEach((raw, position) => {
    const { data, error } = validateImportQuestion(raw, position)
    if (error) {
      errors.push(error)
      return
    }
    if (data.duplicateAction === 'skip') {
      skipped += 1
      return
    }
    if (data.duplicateAction === 'replace') {
      toReplace.push(data)
    } else {
      toCreate.push(data)
    }
  })

  let imported = 0
  let replaced = 0
  let failed = 0

  for (const data of toCreate) {
    try {
      await db.createQuestion(data)
      imported += 1
    } catch (e) {
      failed += 1
      errors.push({ questionNumber: data.questionNumber, message: 'Save failed: ' + (e.message || 'unknown error') })
    }
  }
  for (const data of toReplace) {
    try {
      await db.updateQuestion(data.duplicateOfId, {
        subject: data.subject,
        chapter: data.chapter,
        topic: data.topic,
        subTopic: data.subTopic,
        text: data.text,
        options: data.options,
        correctIndex: data.correctIndex,
        solution: data.solution,
        marks: data.marks,
        negativeMarks: data.negativeMarks,
        difficulty: data.difficulty,
        questionType: data.questionType,
        cetDifficulty: data.cetDifficulty,
        cetRelevance: data.cetRelevance,
        classificationConfidence: data.classificationConfidence,
        classificationSource: data.classificationSource,
        sourcePdf: data.sourcePdf,
        sourcePage: data.sourcePage,
        sourceQuestionNumber: data.sourceQuestionNumber,
      })
      replaced += 1
    } catch (e) {
      failed += 1
      errors.push({ questionNumber: data.questionNumber, message: 'Replace failed: ' + (e.message || 'unknown error') })
    }
  }

  return res.json({
    success: true,
    imported,
    replaced,
    skipped,
    failed,
    total: selected.length,
    errors,
  })
})

// ── AI-assisted CET classification (review helper) ─────────────────────────

const AI_CLASSIFY_MODEL = 'openai/gpt-4o-mini'
const normLabel = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Resolve one AI answer against the syllabus taxonomy; invalid names are dropped. */
const resolveAiClassification = (taxonomy, ai) => {
  const subject = taxonomy.find((s) => normLabel(s.name) === normLabel(ai.subject))
  if (!subject) return null
  const chapter = subject.chapters.find((c) => normLabel(c.name) === normLabel(ai.chapter)) || null
  const topic = chapter
    ? (chapter.topics.find((t) => normLabel(t.name) === normLabel(ai.topic)) || null)
    : null
  const subTopic = topic
    ? (topic.subTopics.find((n) => normLabel(n) === normLabel(ai.subTopic)) || null)
    : null
  const questionType = QUESTION_TYPES.includes(String(ai.questionType)) ? String(ai.questionType) : ''
  const cetDifficulty = CET_DIFFICULTY_LEVELS.includes(String(ai.cetDifficulty)) ? String(ai.cetDifficulty) : ''
  const cetRelevance = CET_RELEVANCE_LEVELS.includes(String(ai.cetRelevance)) ? String(ai.cetRelevance) : ''
  const confidenceNum = Number(ai.confidence)
  const confidence = Number.isFinite(confidenceNum) ? Math.max(0, Math.min(1, confidenceNum)) : 0.6
  return {
    subject: subject.name,
    chapter: chapter ? chapter.name : '',
    topic: topic ? topic.name : '',
    subTopic: subTopic ? subTopic.name : '',
    questionType,
    cetDifficulty,
    cetRelevance,
    classificationConfidence: confidence,
  }
}

/** Compact taxonomy (names only) for the AI prompt. */
const taxonomyOutline = () =>
  getCetTaxonomy()
    .map((subject) => ({
      subject: subject.name,
      chapters: subject.chapters.map((chapter) => ({
        chapter: chapter.name,
        topics: chapter.topics.map((topic) => ({
          topic: topic.name,
          subTopics: topic.subTopics,
        })),
      })),
    }))

/**
 * POST /api/questions/classify/batch — ADMIN ONLY
 * AI-assisted refinement for questions the rules engine could not confidently
 * classify. Sends the stems to OpenRouter, validates every answer against the
 * syllabus taxonomy and returns the merged questions plus a rebuilt analysis.
 * PDF-printed classifications are treated as authoritative and never overridden.
 */
router.post('/classify/batch', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  const incoming = Array.isArray(req.body?.questions) ? req.body.questions : null
  if (!incoming || !incoming.length) {
    return res.status(400).json({ success: false, message: 'questions array is required.' })
  }
  if (incoming.length > MAX_AI_CLASSIFY_QUESTIONS) {
    return res.status(400).json({
      success: false,
      message: `Too many questions for AI classification (${incoming.length}). Classify at most ${MAX_AI_CLASSIFY_QUESTIONS} at a time.`,
    })
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'OpenRouter API key is not configured.' })
  }

  const stems = incoming.map((q, i) => {
    const options = q.options && typeof q.options === 'object'
      ? Object.values(q.options).filter(Boolean).join(' | ')
      : Array.isArray(q.options)
        ? q.options.filter(Boolean).join(' | ')
        : ''
    const stem = String(q.question ?? q.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 500)
    return `[${i + 1}] ${stem}${options ? ` Options: ${options.slice(0, 200)}` : ''}`
  })

  const prompt = `You are an expert MHT-CET (Maharashtra Common Entrance Test) examiner.
Classify each question below into the official MHT-CET syllabus taxonomy.

TAXONOMY (subject -> chapters -> topics -> subTopics):
${JSON.stringify(taxonomyOutline())}

QUESTIONS:
${stems.join('\n')}

Rules:
- subject MUST be one of the taxonomy subjects (Mathematics, Physics, Chemistry, Biology)
- chapter, topic and subTopic MUST use the exact taxonomy names; use "" when unsure
- questionType MUST be one of: ${QUESTION_TYPES.join(', ')}
- cetDifficulty MUST be one of: ${CET_DIFFICULTY_LEVELS.join(', ')}
- cetRelevance MUST be one of: ${CET_RELEVANCE_LEVELS.join(', ')}
- confidence is a number between 0 and 1

Respond with pure JSON (no markdown) exactly in this shape:
{"classifications":[{"index":1,"subject":"","chapter":"","topic":"","subTopic":"","questionType":"","cetDifficulty":"","cetRelevance":"","confidence":0.8}]}`

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:5173',
        'X-Title': 'CET Exam Portal',
      },
      body: JSON.stringify({
        model: AI_CLASSIFY_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('OpenRouter classification error:', errText)
      return res.status(502).json({ success: false, message: 'AI service returned an error.' })
    }

    const result = await response.json()
    let parsed
    try {
      parsed = JSON.parse(result.choices?.[0]?.message?.content || '{}')
    } catch {
      return res.status(502).json({ success: false, message: 'AI classification response could not be parsed.' })
    }

    const taxonomy = getCetTaxonomy()
    const byIndex = new Map()
    ;(Array.isArray(parsed.classifications) ? parsed.classifications : []).forEach((ai) => {
      const idx = Number(ai.index)
      if (!Number.isInteger(idx) || idx < 1 || idx > incoming.length) return
      const resolved = resolveAiClassification(taxonomy, ai)
      if (resolved) byIndex.set(idx - 1, resolved)
    })

    const merged = incoming.map((q, i) => {
      const ai = byIndex.get(i)
      if (!ai || q.classificationSource === 'pdf') return q // PDF-printed labels win
      return {
        ...q,
        ...ai,
        classificationSource: 'ai',
      }
    })

    return res.json({
      success: true,
      aiApplied: byIndex.size,
      questions: merged,
      analysis: buildAnalysis(merged),
    })
  } catch (error) {
    console.error('AI classify endpoint error:', error)
    return res.status(500).json({ success: false, message: error.message || 'Internal server error.' })
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