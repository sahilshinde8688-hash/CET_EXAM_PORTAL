/**
 * pdfQuestionParser.js
 * --------------------
 * Turns the ordered text lines of a PDF (text layer or OCR) into structured
 * CET questions. Pure functions only — no I/O — so the heuristics are unit
 * testable (see test/pdf-extraction.test.js).
 *
 * Capabilities
 * - Question numbering: "1." "1)" "Q1" "Q.1" "Q No. 3" "Question 4" "(5)"
 * - Options: "A)" "A." "(A)" "[A]" "a -" plus inline "A) .. B) .. C) .. D) .."
 * - Answer keys: inline "Ans: B" and trailing "ANSWER KEY 1. B 2. C ..." blocks
 * - Subject / chapter / topic metadata ("Subject: Physics", section headings)
 * - Headers, footers, page numbers, watermark/ad lines are filtered out
 * - Multi-line and multi-page questions are merged; wrapped matrix rows are
 *   re-joined with "; " so "A = [1 2; 3 4]" style content survives
 * - Every question carries a 0..1 confidence plus review flags
 */

const { normalizeMathText, normalizeForMatching, isNumericMatrixRow } = require('./mathText')

// ── Line classification regexes ────────────────────────────────────────────

const QUESTION_MARKERS = [
  /^(?:q(?:ues|uestion)?)\s*\.?\s*no\.?\s*:?\s*(\d{1,3})\b[.):\s-]*/i,
  /^(?:q(?:ues|uestion)?)\s*\.?\s*(\d{1,3})\b[.):\s-]*/i,
  /^question\s*\.?\s*(\d{1,3})\b[.):\s-]*/i,
  /^(\d{1,3})\s*[.)\]:\-]\s*(?!\d)/,
  /^\((\d{1,3})\)\s*(?!\d)/,
]

const OPTION_LINE = /^\[\s*([A-Da-d])\s*\]\s*(.*)$|^\(\s*([A-Da-d])\s*\)\s*(.*)$|^\(?([A-Da-d])\s*[).:\-]\s*(.*)$/
// Inline options inside a single physical line, e.g. "A) 5 kg  B) 10 kg"
const INLINE_OPTION = /(?:^|[\s(])([A-Da-d])[).]\s*/g

const ANSWER_LINE = /^(?:ans(?:wer)?|correct\s*(?:answer|option|choice)?|key)\s*[:.\-–)\]]?\s*\(?\s*([A-Da-d1-4])\s*\)?\s*\.?\s*(.*)$/i
const ANSWER_TRAILING = /[,;]?\s*\b(?:ans(?:wer)?|correct\s*(?:answer|option|choice))\s*[:.\-–]?\s*\(?\s*([A-Da-d1-4])\s*\)?\s*\.?\s*$/i

const SOLUTION_LINE = /^(?:sol(?:ution)?|explanation|expln|hint|reason)\s*[:.\-–]\s*(.*)$/i

const SUBJECT_LINE = /^(?:subject|paper)\s*[:\-–]\s*(.+)$/i
const CHAPTER_LINE = /^(?:chapter|unit)\s*[:\-–]\s*(.+)$/i
const TOPIC_LINE = /^(?:topic|module)\s*[:\-–]\s*(.+)$/i
const SECTION_LINE = /^section\s*[-–:]?\s*[ivx]+\b\s*[:\-–]?\s*(.*)$/i
const DIFFICULTY_LINE = /^(?:difficulty|level)\s*[:.\-–]\s*(easy|medium|hard|moderate|difficult|tough)\b/i
const ANSWER_KEY_HEADER = /^(?:answers?\s*key|key\s*answers?|answers?)\s*[:\-–]?\s*$/i
const SKIP_LINE = /^(?:directions?|instructions?|general\s+instructions|note\s*:)\b/i
const SUBJECT_HEADING = /^(physics|chemistry|biology|mathematics|maths|math|botany|zoology)\b[:\s]*$/i

const AD_LINE = /(www\.|https?:\/\/|downloaded\s+from|visit\s+(?:us|our)|\.com\b|\.in\b|all\s+the\s+best)/i
const AD_SOFT_LINE = /(click\s+here|subscribe|advertisement|addvertise|watermark|scan\s+(?:this|the)\s+qr|qr\s+code)/i
const PAGE_NUM_LINE = /^(?:page\s*)?[0-9]{1,4}$|^-?\s*[0-9]{1,4}\s*-$|^page\s+\d+(?:\s*(?:of|\/)\s*\d+)?$/i

const KNOWN_SUBJECTS = {
  physics: 'Physics',
  chemistry: 'Chemistry',
  biology: 'Biology',
  mathematics: 'Mathematics',
  maths: 'Mathematics',
  math: 'Math',
  botany: 'Botany',
  zoology: 'Zoology',
}

const DIFFICULTY_VALUES = { easy: 'Easy', medium: 'Medium', moderate: 'Medium', hard: 'Hard', difficult: 'Hard', tough: 'Hard' }

const MAX_QUESTION_CHARS = 5000
const MAX_OPTION_CHARS = 1000
const MAX_SOLUTION_CHARS = 5000

/** Strip noise (control chars, trailing junk) and cap length defensively. */
const sanitizeValue = (value, maxLen) => {
  const clean = normalizeMathText(value)
  return clean.length > maxLen ? clean.slice(0, maxLen).trimEnd() : clean
}

/** Detect "1. B 2. C 3. D" style answer-key pairs on a line. */
const parseAnswerKeyPairs = (line, pairs) => {
  const strict = /(\d{1,3})\s*(?:[.):\-–]\s*\(?\s*([A-Da-d])\s*\)?|\(\s*([A-Da-d])\s*\))(?![A-Za-z0-9])/g
  let found = 0
  let match
  while ((match = strict.exec(line)) !== null) {
    const num = parseInt(match[1], 10)
    const letter = String(match[2] || match[3] || '').toUpperCase()
    if (num > 0 && num <= 300 && letter) {
      pairs.set(num, letter)
      found += 1
    }
  }
  if (found > 0) return found
  // Loose fallback: "1 B 2 C 3 A"
  const loose = /(?:^|\s)(\d{1,3})\s+([A-Da-d])(?![A-Za-z0-9])/g
  while ((match = loose.exec(line)) !== null) {
    const num = parseInt(match[1], 10)
    const letter = match[2].toUpperCase()
    if (num > 0 && num <= 300) {
      pairs.set(num, letter)
      found += 1
    }
  }
  return found
}

/**
 * Split a physical line that packs several options: "A) x B) y C) z D) w".
 * Returns null unless at least two option markers are found, which avoids
 * false positives on math text like "(a+b) 10 (c+d) 20".
 */
const splitInlineOptions = (text) => {
  INLINE_OPTION.lastIndex = 0
  const marks = []
  let match
  while ((match = INLINE_OPTION.exec(text)) !== null) {
    marks.push({
      letter: match[1].toUpperCase(),
      contentStart: match.index + match[0].length,
    })
  }
  if (marks.length < 2) return null
  const parts = []
  marks.forEach((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].contentStart : text.length
    parts.push({ letter: mark.letter, text: text.slice(mark.contentStart, end).trim() })
  })
  return parts.filter((p) => p.text.length > 0)
}

/**
 * Remove headers, footers, page numbers, watermark and advertisement lines.
 * Lines repeated on the top/bottom edges of most pages are treated as chrome.
 */
const stripChrome = (pages) => {
  const pageCount = pages.length || 1
  const edgeCounts = new Map()

  pages.forEach((page) => {
    const strip = [...page.lines.slice(0, 2), ...page.lines.slice(-2)]
    strip.forEach((line) => {
      const key = normalizeForMatching(line.text)
      if (!key) return
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1)
    })
  })

  const chromeThreshold = Math.max(2, Math.ceil(pageCount / 2))
  const chromeKeys = new Set()
  for (const [key, count] of edgeCounts.entries()) {
    if (count >= chromeThreshold) chromeKeys.add(key)
  }

  const cleaned = []
  pages.forEach((page) => {
    const lines = []
    page.lines.forEach((line, index) => {
      const raw = line.text.trim()
      const key = normalizeForMatching(raw)
      const atEdge = index < 2 || index >= page.lines.length - 2
      if (PAGE_NUM_LINE.test(raw) && (atEdge || raw.length <= 6)) return
      if (key && chromeKeys.has(key)) return
      if (AD_LINE.test(raw) && raw.length < 150) return
      if (AD_SOFT_LINE.test(raw) && (atEdge || raw.length < 80)) return
      lines.push(line)
    })
    if (lines.length) cleaned.push({ ...page, lines })
  })
  return cleaned
}

/** Join wrapped lines of one question block, re-stitching matrix rows. */
const joinBlockLines = (lines) => {
  let out = ''
  lines.forEach((line, i) => {
    if (i === 0) { out = line; return }
    const prev = lines[i - 1]
    if (isNumericMatrixRow(line) && (isNumericMatrixRow(prev) || /[[{]\s*$/.test(prev))) {
      out += out.endsWith(';') || out.endsWith('[') ? ` ${line}` : `; ${line}`
    } else if (/[-–,;]$/.test(out) || /^[-–,;.]/.test(line)) {
      out += line
    } else {
      out += ` ${line}`
    }
  })
  return out.replace(/\s+/g, ' ').trim()
}

/** Score question confidence 0..1 based on extraction completeness signals. */
const computeConfidence = ({ optionCount, hasAnswer, sequenceOk, hasTopic, hasSubject, mode, ocrConfidence }) => {
  let score = 0.35
  if (optionCount >= 2) score += 0.2
  if (optionCount >= 4) score += 0.15
  if (hasAnswer) score += 0.1
  if (sequenceOk) score += 0.1
  if (hasTopic) score += 0.05
  if (hasSubject) score += 0.05
  score = Math.min(0.99, score)
  if (mode === 'ocr') {
    const quality = typeof ocrConfidence === 'number' ? Math.max(0.3, Math.min(1, ocrConfidence)) : 0.6
    score = Math.min(0.85, score * (0.55 + 0.45 * quality))
  }
  return Math.round(score * 100) / 100
}

const emptyQuestion = (number) => ({
  questionNumber: number,
  question: '',
  options: {},
  correctAnswer: '',
  correctIndex: -1,
  subject: '',
  chapter: '',
  topic: '',
  difficulty: 'Medium',
  solution: '',
  confidence: 0,
  needsReview: true,
  reviewReason: 'Question could not be extracted',
  warnings: [],
})

/**
 * Parse cleaned page lines into structured questions.
 *
 * @param {Array<{pageNumber:number, lines:Array<{text:string}>}>} pages
 * @param {object} [opts]
 * @param {'text'|'ocr'} [opts.mode]
 * @param {number} [opts.ocrConfidence] mean OCR page confidence (0..1)
 * @returns {{questions: Array, warnings: string[], answerKeyFound: number, sections: object}}
 */
const parseQuestions = (pages, { mode = 'text', ocrConfidence } = {}) => {
  const warnings = []
  const answerPairs = new Map()
  const questions = []
  let answerKeyFound = 0

  const context = { subject: '', chapter: '', topic: '', difficulty: '' }

  // Sequential numbering state for marker acceptance
  let lastNumber = 0

  let current = null // in-flight question accumulator
  let inAnswerKeySection = false
  let target = 'question' // where continuation lines go: question | option | solution
  let lastOptionLetter = null
  let sectionSeen = { subject: false, topic: false }

  const startQuestion = (number) => {
    if (current) finalizeCurrent()
    current = {
      number,
      textLines: [],
      options: new Map(),
      answer: '',
      solutionLines: [],
      topic: '',
      chapter: '',
      subject: '',
      difficulty: '',
      warnings: [],
    }
    target = 'question'
    lastOptionLetter = null
  }

  const finalizeCurrent = () => {
    const q = current
    current = null
    if (!q) return

    const text = joinBlockLines(q.textLines)
    if (!text && q.options.size === 0) {
      if (q.number) warnings.push(`Question ${q.number} appeared empty and was skipped.`)
      return
    }

    const letters = Array.from(q.options.keys()).sort()
    const options = {}
    letters.forEach((letter) => { options[letter] = q.options.get(letter) })

    if (!text) {
      q.warnings.push('Question text was not detected (options only).')
    }

    // Detect missing letters in an A-D run (e.g. C) missing) so admins can fix
    if (letters.length >= 2) {
      const expected = 'ABCDEFG'.slice(0, letters[letters.length - 1].charCodeAt(0) - 64)
      const missing = expected.split('').filter((l) => !q.options.has(l) && l <= 'D')
      if (missing.length) q.warnings.push(`Option ${missing.join(', ')} may be missing (not detected in the PDF).`)
    }

    // Inline answer only — answer-key sections are parsed later, so pairs
    // are applied to the finished questions after the main loop.
    const answerLetter = (q.answer || '').toUpperCase()
    const correctIndex = answerLetter && options[answerLetter] !== undefined
      ? answerLetter.charCodeAt(0) - 65
      : -1
    if (answerLetter && correctIndex === -1) {
      q.warnings.push(`Answer "${answerLetter}" was detected but option ${answerLetter} was not found.`)
    }

    const subject = q.subject || context.subject || ''
    const chapter = q.chapter || context.chapter || ''
    const topic = q.topic || context.topic || chapter || ''

    const number = q.number || questions.length + 1
    const sequenceOk = questions.length === 0
      ? number <= 2
      : number === (questions[questions.length - 1].questionNumber || 0) + 1

    const confidence = computeConfidence({
      optionCount: letters.length,
      hasAnswer: correctIndex >= 0,
      sequenceOk,
      hasTopic: Boolean(topic),
      hasSubject: Boolean(subject),
      mode,
      ocrConfidence,
    })

    let needsReview = false
    let reviewReason = ''
    if (!text) { needsReview = true; reviewReason = 'Question text was not detected' }
    else if (letters.length < 2) { needsReview = true; reviewReason = 'Fewer than two options were detected' }
    else if (correctIndex < 0) { needsReview = true; reviewReason = 'Correct answer not found (no answer key)' }
    else if (confidence < 0.6) { needsReview = true; reviewReason = mode === 'ocr' ? 'Low OCR confidence — please verify' : 'Low extraction confidence — please verify' }

    questions.push({
      questionNumber: number,
      question: sanitizeValue(text, MAX_QUESTION_CHARS),
      options,
      correctAnswer: correctIndex >= 0 ? answerLetter : '',
      correctIndex,
      subject: subject ? sanitizeValue(subject, 120) : '',
      chapter: chapter ? sanitizeValue(chapter, 200) : '',
      topic: topic ? sanitizeValue(topic, 200) : '',
      difficulty: (q.difficulty || context.difficulty || 'Medium').replace(/^\w/, (c) => c.toUpperCase()),
      solution: sanitizeValue(q.solutionLines.join(' '), MAX_SOLUTION_CHARS),
      confidence,
      needsReview,
      reviewReason,
      warnings: q.warnings,
      sourcePage: q.firstPage || undefined,
    })
  }

  const flattened = []
  pages.forEach((page) => {
    page.lines.forEach((line) => {
      flattened.push({ text: line.text, pageNumber: page.pageNumber })
    })
  })

  for (let i = 0; i < flattened.length; i += 1) {
    const rawLine = flattened[i].text.trim()
    if (!rawLine) continue
    if (SKIP_LINE.test(rawLine) && rawLine.length < 200) continue

    // ── Answer key section ─────────────────────────────────────────────
    if (ANSWER_KEY_HEADER.test(rawLine)) {
      if (current) finalizeCurrent() // the key always follows the last question
      inAnswerKeySection = true
      continue
    }
    if (inAnswerKeySection) {
      const pairsFound = parseAnswerKeyPairs(rawLine, answerPairs)
      answerKeyFound += pairsFound
      if (pairsFound > 0) continue
      // Leave the key section when real exam content resumes — any question
      // marker, section heading or long prose line that yields no key pairs.
      const exitsKey =
        QUESTION_MARKERS.some((re) => re.test(rawLine)) ||
        SECTION_LINE.test(rawLine) || SUBJECT_LINE.test(rawLine) ||
        SUBJECT_HEADING.test(rawLine) || rawLine.length >= 60
      if (exitsKey) {
        inAnswerKeySection = false
        // fall through so the line is processed normally
      } else {
        continue
      }
    }

    // ── Global metadata lines ──────────────────────────────────────────
    const subjectMatch = rawLine.match(SUBJECT_LINE)
    if (subjectMatch) {
      const value = normalizeMathText(subjectMatch[1])
      context.subject = KNOWN_SUBJECTS[value.toLowerCase()] || value
      sectionSeen.subject = true
      if (current) current.subject = context.subject
      continue
    }
    const chapterMatch = rawLine.match(CHAPTER_LINE)
    if (chapterMatch) {
      context.chapter = normalizeMathText(chapterMatch[1])
      if (current) { current.chapter = context.chapter; continue }
      continue
    }
    const topicMatch = rawLine.match(TOPIC_LINE)
    if (topicMatch) {
      context.topic = normalizeMathText(topicMatch[1])
      if (current) { current.topic = context.topic; continue }
      continue
    }
    const sectionMatch = rawLine.match(SECTION_LINE)
    if (sectionMatch) {
      const value = normalizeMathText(sectionMatch[1] || '')
      if (KNOWN_SUBJECTS[value.toLowerCase()]) {
        context.subject = KNOWN_SUBJECTS[value.toLowerCase()]
        sectionSeen.subject = true
      } else if (value) {
        context.chapter = value
      }
      continue
    }
    if (!current && SECTION_LINE.test(rawLine) === false && SUBJECT_HEADING.test(rawLine) && rawLine.length <= 40) {
      context.subject = KNOWN_SUBJECTS[rawLine.toLowerCase().replace(/[^a-z]/g, '')] ||
        rawLine.replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      sectionSeen.subject = true
      continue
    }

    // ── Question start markers ─────────────────────────────────────────
    // Numbering is validated against the running sequence so stray numbered
    // lines inside solutions don't split questions apart. Gaps of up to 5 and
    // "restart at 1" (per-section numbering) are tolerated.
    let markerNumber = null
    for (const marker of QUESTION_MARKERS) {
      const match = rawLine.match(marker)
      if (match) {
        const num = parseInt(match[1], 10)
        const firstMarker = !current && questions.length === 0
        const accepted = num > 0 && num <= 300 && num !== lastNumber && (
          firstMarker ||
          num === 1 ||
          (num > lastNumber && num - lastNumber <= 5)
        )
        if (accepted) markerNumber = num
        else if (current && !current.strayNumberWarned) {
          // Keep the content (it is absorbed by the current block) but tell
          // the admin that the numbering inside this question looked broken.
          current.strayNumberWarned = true
          current.warnings.push(`Unexpected question numbering "${num}." inside the block — please review.`)
        }
        break
      }
    }
    if (markerNumber !== null) {
      lastNumber = markerNumber
      startQuestion(markerNumber)
      if (current && !current.firstPage) current.firstPage = flattened[i].pageNumber
      const remainder = rawLine.replace(/^(\s*(?:q(?:ues|uestion)?\s*\.?\s*(?:no\.?\s*:?)?\s*)?(?:question\s*)?\d{1,3}\s*[.)\]:\-]?\s*)/i, '')
        .replace(/^\((\d{1,3})\)\s*/, '')
        .trim()
      if (remainder) current.textLines.push(remainder)
      continue
    }

    if (!current) {
      // Free content before the first question (cover pages, instructions…)
      continue
    }

    // ── Inside a question block ────────────────────────────────────────

    // Inline answer at end of a line: "... Ans. B"
    const trailing = rawLine.match(ANSWER_TRAILING)
    if (trailing) {
      const value = trailing[1].toUpperCase()
      current.answer = /\d/.test(value)
        ? String.fromCharCode(64 + parseInt(value, 10))
        : value
      const stripped = rawLine.slice(0, trailing.index).trim().replace(/[,;]$/, '')
      if (stripped) {
        // The stripped part may itself be an option line: "A) 5 kg Ans. B"
        const strippedOption = stripped.match(OPTION_LINE)
        const strippedLetter = strippedOption ? (strippedOption[1] || strippedOption[3] || strippedOption[5] || '').toUpperCase() : ''
        if (strippedLetter && !current.options.has(strippedLetter)) {
          current.options.set(strippedLetter, (strippedOption[2] || strippedOption[4] || strippedOption[6] || '').replace(/^[:.]\s*/, '').trim())
          target = 'option'
          lastOptionLetter = strippedLetter
        } else if (target === 'option' && lastOptionLetter) {
          current.options.set(lastOptionLetter, `${current.options.get(lastOptionLetter)} ${stripped}`.trim())
        } else {
          current.textLines.push(stripped)
        }
      }
      continue
    }

    // Standalone answer line ("Ans: B", "Answer - (2)") possibly with a
    // short explanation. Long prose after the marker means this was really a
    // sentence like "Answer the following questions:"
    const answerMatch = rawLine.match(ANSWER_LINE)
    if (answerMatch) {
      const remainder = (answerMatch[2] || '').trim()
      const isRealAnswer = remainder.length === 0 ||
        remainder.length <= 120 ||
        /^(?:sol|exp|because|since|work|let|as\b)/i.test(remainder)
      if (isRealAnswer) {
        const value = answerMatch[1].toUpperCase()
        current.answer = /\d/.test(value)
          ? String.fromCharCode(64 + Math.min(6, parseInt(value, 10)))
          : value
        if (remainder) current.solutionLines.push(remainder)
        target = 'solution'
        continue
      }
    }

    // Difficulty hint lines
    const diffMatch = rawLine.match(DIFFICULTY_LINE)
    if (diffMatch) {
      const value = DIFFICULTY_VALUES[diffMatch[1].toLowerCase()] || 'Medium'
      current.difficulty = value
      context.difficulty = value
      continue
    }

    // Option lines (also handle inline option packs)
    const optionMatch = rawLine.match(OPTION_LINE)
    if (optionMatch) {
      const letter = (optionMatch[1] || optionMatch[3] || optionMatch[5] || '').toUpperCase()
      const remainder = (optionMatch[2] || optionMatch[4] || optionMatch[6] || '').replace(/^[:.]\s*/, '').trim()
      if (letter && !current.options.has(letter)) {
        const inlineParts = remainder ? splitInlineOptions(remainder) : null
        if (inlineParts) {
          current.options.set(letter, inlineParts[0].text)
          inlineParts.slice(1).forEach((part) => {
            if (!current.options.has(part.letter)) current.options.set(part.letter, part.text)
          })
        } else {
          current.options.set(letter, remainder)
        }
        target = 'option'
        lastOptionLetter = letter
        continue
      }
    }

    // Inline option pack on a continuation line: "... A) x B) y C) z D) w".
    // Only trusted when the first marker is "A" so math like "(a+b) c" can
    // never be mistaken for an option pack.
    if (current.options.size === 0 && target === 'question' && rawLine.length < 600) {
      const inlineParts = splitInlineOptions(rawLine)
      if (inlineParts && inlineParts.length >= 2 && inlineParts[0].letter === 'A') {
        inlineParts.forEach((part) => {
          if (!current.options.has(part.letter)) current.options.set(part.letter, part.text)
        })
        target = 'option'
        lastOptionLetter = Array.from(current.options.keys()).pop()
        continue
      }
    }

    // Solution / explanation blocks
    const solutionMatch = rawLine.match(SOLUTION_LINE)
    if (solutionMatch) {
      target = 'solution'
      if (solutionMatch[1] && solutionMatch[1].trim()) current.solutionLines.push(solutionMatch[1].trim())
      continue
    }

    // Continuation line routing
    if (target === 'option' && lastOptionLetter) {
      const prev = current.options.get(lastOptionLetter) || ''
      current.options.set(lastOptionLetter, `${prev} ${rawLine}`.trim().slice(0, MAX_OPTION_CHARS))
    } else if (target === 'solution') {
      current.solutionLines.push(rawLine)
    } else {
      current.textLines.push(rawLine)
    }
  }

  finalizeCurrent()

  // Answer-key sections follow the questions they refer to, so the pairs can
  // only be applied once every line has been processed.
  if (answerPairs.size > 0 && questions.length > 0) {
    let applied = 0
    questions.forEach((q) => {
      if (q.correctAnswer || !answerPairs.has(q.questionNumber)) return
      const letter = String(answerPairs.get(q.questionNumber) || '').toUpperCase()
      if (!letter || q.options[letter] === undefined) return
      q.correctAnswer = letter
      q.correctIndex = letter.charCodeAt(0) - 65
      if (q.reviewReason === 'Correct answer not found (no answer key)') {
        q.needsReview = false
        q.reviewReason = ''
      }
      applied += 1
    })
    if (applied > 0) warnings.push(`Applied ${applied} answer(s) from the detected answer key section.`)
  }

  return {
    questions,
    warnings,
    answerKeyFound,
    sections: {
      subject: context.subject || '',
      chapter: context.chapter || '',
      topic: context.topic || '',
    },
  }
}

module.exports = {
  parseQuestions,
  stripChrome,
  joinBlockLines,
  splitInlineOptions,
  parseAnswerKeyPairs,
  normalizeForMatching,
  MAX_QUESTION_CHARS,
  MAX_OPTION_CHARS,
  MAX_SOLUTION_CHARS,
}
