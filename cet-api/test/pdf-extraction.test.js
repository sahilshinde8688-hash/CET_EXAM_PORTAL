/**
 * PDF question extraction tests.
 *
 * Covers the math normaliser, duplicate detection, the question parser
 * heuristics (line fixtures) and an end-to-end text-layer extraction against
 * a synthetic multi-page PDF built in-memory (no OCR required).
 *
 * Run: npm test  (node --test)
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { normalizeMathText, normalizeForMatching, isNumericMatrixRow } = require('../services/mathText')
const { flagDuplicates, similarity } = require('../utils/duplicateDetection')
const { parseQuestions, stripChrome, splitInlineOptions } = require('../services/pdfQuestionParser')
const { extractPdfPages, PdfTextError, renderPageToPng } = require('../services/pdfText')

// ── helpers ───────────────────────────────────────────────────────────────

const lines = (texts, pageNumber = 1) => ({ pageNumber, lines: texts.map((text) => ({ text })) })

/** Escape a string for a PDF literal. */
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')

/**
 * Build a minimal but valid one-or-more-page PDF from absolute text segments.
 * @param {Array<Array<{text:string,x:number,y:number,size?:number}>>} pages
 */
const buildTestPdf = (pages) => {
  const objects = []
  const fontObj = 3
  let next = 4
  const pageEntries = pages.map((segments) => {
    const pageNum = next
    const contentNum = next + 1
    next += 2
    const ops = segments
      .map((seg) => `BT /F1 ${seg.size || 12} Tf 1 0 0 1 ${seg.x} ${seg.y} Tm (${esc(seg.text)}) Tj ET`)
      .join('\n')
    return {
      pageNum,
      contentNum,
      page: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${contentNum} 0 R >>`,
      content: `<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`,
    }
  })

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageEntries.map((p) => `${p.pageNum} 0 R`).join(' ')}] /Count ${pages.length} >>`
  objects[fontObj] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  pageEntries.forEach((p) => {
    objects[p.pageNum] = p.page
    objects[p.contentNum] = p.content
  })

  let pdf = '%PDF-1.4\n'
  const offsets = []
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = pdf.length
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`
  }
  const startxref = pdf.length
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let i = 1; i < objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

/** Run the text-layer pipeline (extract -> strip chrome -> parse). */
const runPipeline = async (buffer) => {
  const extracted = await extractPdfPages(buffer, { maxPages: 50 })
  const cleaned = stripChrome(extracted.pages)
  return { ...parseQuestions(cleaned, { mode: 'text' }), extracted }
}

// ── mathText ──────────────────────────────────────────────────────────────

test('normalizeMathText preserves symbols and expands super/subscripts', () => {
  assert.equal(normalizeMathText('x² + y² = r²'), 'x^2 + y^2 = r^2')
  assert.equal(normalizeMathText('H₂SO₄'), 'H_2SO_4')
  assert.equal(normalizeMathText('x⁻²'), 'x^-2')
  assert.equal(normalizeMathText('√2 × 2 ≤ 10'), '√2 × 2 ≤ 10')
  assert.equal(normalizeMathText('½ of θ'), '1/2 of θ')
  assert.equal(normalizeMathText('𝑥 + 𝑦'), 'x + y')
})

test('normalizeForMatching fingerprints ignore case, punctuation and math notation', () => {
  assert.equal(normalizeForMatching('Find the value of x² + 1'), normalizeForMatching('find the value of x^2 + 1'))
  assert.notEqual(normalizeForMatching('Find the value of x + 1'), normalizeForMatching('Find the value of x + 2'))
})

test('isNumericMatrixRow detects wrapped matrix rows', () => {
  assert.equal(isNumericMatrixRow('[ 1  2'), true)
  assert.equal(isNumericMatrixRow('3  4 ]'), true)
  assert.equal(isNumericMatrixRow('find the matrix'), false)
})

// ── duplicateDetection ────────────────────────────────────────────────────

test('flagDuplicates marks exact and similar duplicates against the bank', () => {
  const bank = [
    { id: 'id-1', text: 'If A is a square matrix of order 2, find |A|.' },
    { id: 'id-2', text: 'The value of integration of x dx from 0 to 1 is' },
  ]
  const result = flagDuplicates([
    { question: 'If A is a square matrix of order 2, find |A|.' },
    { question: 'The value of integration of x dx from 0 to 2 is' },
    { question: 'Integrate x squared with respect to x.' },
  ], bank)

  assert.equal(result[0].duplicate, true)
  assert.equal(result[0].duplicateType, 'exact')
  assert.equal(result[0].duplicateOfId, 'id-1')
  assert.equal(result[0].duplicateAction, 'skip')

  assert.equal(result[1].duplicate, true)
  assert.equal(result[1].duplicateType, 'similar')

  assert.equal(result[2].duplicate, false)
  assert.equal(result[2].duplicateAction, 'import')
})

test('flagDuplicates detects duplicates inside the same batch', () => {
  const result = flagDuplicates([
    { question: 'Differentiate sin x with respect to x.' },
    { question: 'differentiate sin x with respect to x' },
  ], [])
  assert.equal(result[1].duplicate, true)
  assert.equal(result[1].duplicateInBatch, true)
})

test('similarity scores behave sensibly', () => {
  assert.equal(similarity('abc', 'abc'), 1)
  assert.ok(similarity('the unit of force is newton', 'the si unit of force is newton') > 0.8)
  assert.equal(similarity('short', 'a completely different and much longer sentence about biology'), 0)
})

// ── pdfQuestionParser (line fixtures) ─────────────────────────────────────

test('parses numbered markers, block options and inline answers', () => {
  const { questions } = parseQuestions([lines([
    '1. If A = [1 2; 3 4], find |A|.',
    'A) -2',
    'B) 2',
    'C) 6',
    'D) -6',
    'Ans: A',
    '2) The SI unit of force is',
    'A) joule',
    'B) newton',
    'C) watt',
    'D) pascal',
    'Answer - B',
  ])])

  assert.equal(questions.length, 2)
  assert.equal(questions[0].question, 'If A = [1 2; 3 4], find |A|.')
  assert.deepEqual(questions[0].options, { A: '-2', B: '2', C: '6', D: '-6' })
  assert.equal(questions[0].correctAnswer, 'A')
  assert.equal(questions[0].needsReview, false)
  assert.equal(questions[1].correctAnswer, 'B')
})

test('parses Q.1, Question 4 and (5) marker styles', () => {
  const { questions } = parseQuestions([lines([
    'Q.1 What is the value of g on earth?',
    'A) 9.8 m/s2',
    'B) 8.9 m/s2',
    'C) 10 m/s2',
    'D) 1 m/s2',
    'Question 2: Pick the scalar quantity',
    'A) velocity',
    'B) speed',
    'C) acceleration',
    'D) displacement',
    '(3) Which is a noble gas?',
    'A) Helium',
    'B) Nitrogen',
    'C) Oxygen',
    'D) Chlorine',
  ])])
  assert.equal(questions.length, 3)
  assert.equal(questions[0].questionNumber, 1)
  assert.equal(questions[1].questionNumber, 2)
  assert.equal(questions[2].questionNumber, 3)
})

test('splits inline option packs on a single line', () => {
  const parts = splitInlineOptions('A) 5 kg B) 10 kg C) 15 kg D) 20 kg')
  assert.equal(parts.length, 4)
  assert.deepEqual(parts.map((p) => p.letter), ['A', 'B', 'C', 'D'])
  assert.equal(parts[3].text, '20 kg')
  // Math parentheses must not be mistaken for options
  assert.equal(splitInlineOptions('the value of (a+b) c and (d+e) f'), null)
})

test('applies a trailing ANSWER KEY section by question number', () => {
  const { questions } = parseQuestions([lines([
    '1. The SI unit of work is',
    'A) joule',
    'B) newton',
    'C) watt',
    'D) pascal',
    '2. Acceleration due to gravity has units',
    'A) m/s',
    'B) m/s2',
    'C) m2/s',
    'D) s/m',
    'ANSWER KEY',
    '1. A  2. B',
  ])])
  assert.equal(questions.length, 2)
  assert.equal(questions[0].correctAnswer, 'A')
  assert.equal(questions[1].correctAnswer, 'B')
  assert.ok(questions.every((q) => q.needsReview === false))
})

test('captures subject, chapter, topic and difficulty metadata', () => {
  const { questions } = parseQuestions([lines([
    'Subject: Physics',
    'Chapter: Gravitation',
    '1. Kepler second law is based on',
    'A) momentum',
    'B) angular momentum',
    'C) energy',
    'D) force',
    'Topic: Kepler laws',
    'Difficulty: Hard',
  ])])
  assert.equal(questions[0].subject, 'Physics')
  assert.equal(questions[0].chapter, 'Gravitation')
  assert.equal(questions[0].topic, 'Kepler laws')
  assert.equal(questions[0].difficulty, 'Hard')
})

test('flags questions without options and keeps them for review', () => {
  const { questions } = parseQuestions([lines([
    '1. State Newton first law of motion.',
  ])])
  assert.equal(questions.length, 1)
  assert.equal(questions[0].needsReview, true)
  assert.match(questions[0].reviewReason, /options/i)
})

test('joins multi-line questions and matrix rows', () => {
  const { questions } = parseQuestions([lines([
    '1. Given matrix',
    '[ 1  2',
    '3  4 ]',
    'compute the value of',
    'the determinant |A|.',
    'A) -2',
    'B) 2',
    'C) 6',
    'D) -6',
  ])])
  assert.equal(questions[0].question, 'Given matrix [ 1 2; 3 4 ] compute the value of the determinant |A|.')
})

test('keeps stray numbered lines for review without splitting the question', () => {
  const { questions } = parseQuestions([lines([
    '1. First real question about vectors?',
    'A) one',
    'B) two',
    'C) three',
    'D) four',
    '23. This stray line is not a question start',
    'B) two',
  ])])
  assert.equal(questions.length, 1)
  const joined = [
    questions[0].question,
    Object.values(questions[0].options).join(' '),
  ].join(' ')
  assert.ok(joined.includes('This stray line is not a question start'), 'stray content must be preserved')
  assert.match(questions[0].warnings.join(' '), /Unexpected question numbering/)
})

test('merges questions spanning a page break', () => {
  const { questions } = parseQuestions([
    lines(['1. A car accelerates uniformly from'], 1),
    lines(['rest to 20 m/s in 5 s. Its acceleration is'], 2),
    lines(['A) 2 m/s2', 'B) 4 m/s2', 'C) 5 m/s2', 'D) 10 m/s2'], 2),
  ])
  assert.equal(questions.length, 1)
  assert.match(questions[0].question, /uniformly from rest to 20 m\/s in 5 s/)
})

test('strips repeated headers, footers and page numbers', () => {
  const page = (num, question) => lines([
    'CET Preparation Booklet',
    question,
    'A) one',
    'B) two',
    'C) three',
    'D) four',
    'www.example.com',
    `${num}`,
  ], num)
  const cleaned = stripChrome([page(1, '1. Some question about chemistry?'), page(2, '2. Another question about biology?')])
  const allText = cleaned.flatMap((p) => p.lines.map((l) => l.text)).join('\n')
  assert.ok(!allText.includes('CET Preparation Booklet'))
  assert.ok(!allText.includes('www.example.com'))
  const { questions } = parseQuestions(cleaned)
  assert.equal(questions.length, 2)
  assert.ok(!questions[0].question.includes('CET'))
})

// ── end-to-end text-layer extraction on a synthetic PDF ───────────────────

test('extracts structured questions from a synthetic multi-page PDF', async () => {
  const pdf = buildTestPdf([
    [
      { text: 'MHT CET Question Bank', x: 72, y: 750, size: 10 },
      { text: 'Subject: Mathematics', x: 72, y: 726 },
      { text: '1. If A = [1 2; 3 4], find |A|.', x: 72, y: 700 },
      { text: 'A) -2', x: 90, y: 682 },
      { text: 'B) 2', x: 90, y: 664 },
      { text: 'C) 6', x: 90, y: 646 },
      { text: 'D) -6', x: 90, y: 628 },
      { text: 'Ans: A', x: 90, y: 610 },
      // "Q2) The value of x^2 + 1 for x = 2 is" with a raised superscript glyph
      { text: 'Q2) The value of x', x: 72, y: 592 },
      { text: '2', x: 192, y: 595, size: 8 },
      { text: ' + 1 for x = 2 is', x: 198, y: 592 },
      { text: 'A) 3', x: 90, y: 570 },
      { text: 'B) 5', x: 90, y: 552 },
      { text: 'C) 4', x: 90, y: 534 },
      { text: 'D) 2', x: 90, y: 516 },
      { text: '2. Which of the following is a vector quantity?', x: 72, y: 490 },
      { text: 'A) Speed', x: 90, y: 468 },
      { text: 'B) Work', x: 90, y: 450 },
      { text: 'C) Force', x: 90, y: 432 },
      { text: 'D) Energy', x: 90, y: 414 },
      { text: 'ANSWER KEY', x: 72, y: 380 },
      { text: '1. A  2. B', x: 72, y: 358 },
      { text: '1', x: 300, y: 30 },
    ],
    [
      { text: 'MHT CET Question Bank', x: 72, y: 750, size: 10 },
      { text: '3. Evaluate sqrt(2) × sqrt(8).', x: 72, y: 700 },
      { text: 'A) 2', x: 90, y: 682 },
      { text: 'B) 4', x: 90, y: 664 },
      { text: 'C) 16', x: 90, y: 646 },
      { text: 'D) 8', x: 90, y: 628 },
      { text: 'Ans: B', x: 90, y: 610 },
      { text: '2', x: 300, y: 30 },
    ],
  ])

  const { questions, warnings, answerKeyFound } = await runPipeline(pdf)

  assert.equal(questions.length, 3)
  assert.equal(answerKeyFound, 2)

  assert.equal(questions[0].question, 'If A = [1 2; 3 4], find |A|.')
  assert.equal(questions[0].correctAnswer, 'A')
  assert.equal(questions[0].subject, 'Mathematics')
  assert.equal(questions[0].needsReview, false)

  assert.equal(questions[1].question, 'The value of x^2 + 1 for x = 2 is')
  assert.equal(questions[1].questionNumber, 2)
  assert.equal(questions[1].correctAnswer, 'B')

  assert.equal(questions[2].question, 'Evaluate sqrt(2) × sqrt(8).')
  assert.equal(questions[2].correctAnswer, 'B')

  // Chrome must not leak into any question
  const allText = questions.map((q) => q.question).join(' ')
  assert.ok(!allText.includes('MHT CET'))
  warnings.forEach(() => {}) // warnings are informational
})

test('rejects non-pdf garbage with a meaningful error', async () => {
  await assert.rejects(
    () => extractPdfPages(Buffer.from('this is not a pdf at all')),
    (err) => err instanceof PdfTextError,
  )
})

test('caps OCR render dimensions and releases page resources', async () => {
  let renderedViewport
  let cleaned = false
  const page = {
    getViewport: ({ scale }) => ({ width: 2000 * scale, height: 2000 * scale }),
    render: ({ viewport }) => {
      renderedViewport = viewport
      return { promise: Promise.resolve() }
    },
    cleanup: () => { cleaned = true },
  }

  const png = await renderPageToPng({ getPage: async () => page }, 1)
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)

  assert.ok(width * height <= 2_005_000)
  assert.ok(width <= 3000 && height <= 3000)
  assert.ok(renderedViewport.width * renderedViewport.height <= 2_000_000)
  assert.equal(cleaned, true)
})

test('rejects extreme OCR page dimensions with a handled PDF error', async () => {
  let cleaned = false
  const page = {
    getViewport: ({ scale }) => ({ width: 10000 * scale, height: 10000 * scale }),
    cleanup: () => { cleaned = true },
  }

  await assert.rejects(
    () => renderPageToPng({ getPage: async () => page }, 1),
    (error) => error instanceof PdfTextError && error.code === 'PAGE_TOO_LARGE',
  )
  assert.equal(cleaned, true)
})
