/**
 * pdfImportService.js
 * -------------------
 * Orchestrates the full PDF -> questions pipeline for the admin question
 * importer:
 *
 *   Buffer -> text layer (pdfjs) ──┬─> chrome removal -> question parser -> math normalisation
 *                                  └─ (no text?) -> OCR (tesseract) -> same parser
 *                                -> duplicate flagging against the live question bank
 *                                -> MHT-CET classification + distribution analysis
 *
 * Everything stays in memory: uploaded PDFs are never written to disk, so
 * there are no temporary files to clean up and nothing persists between
 * requests. PDF content is only ever decoded (isEvalSupported: false) —
 * scripts, embedded files and actions inside a PDF are ignored entirely.
 */

const { PdfTextError, extractPdfPages } = require('./pdfText')
const { isScannedPdf, ocrPdfBuffer } = require('./ocrService')
const { parseQuestions, stripChrome, MAX_QUESTION_CHARS } = require('./pdfQuestionParser')
const { normalizeMathText } = require('./mathText')
const { flagDuplicates } = require('../utils/duplicateDetection')
const { classifyQuestions, buildAnalysis } = require('./cetClassification')
const db = require('./dbService')

const PDF_MAGIC = '%PDF-'

const MAX_PDF_PAGES = Number(process.env.PDF_MAX_PAGES || 150)
const MAX_OCR_PAGES = Number(process.env.PDF_OCR_MAX_PAGES || 40)
const PROCESS_TIMEOUT_MS = Number(process.env.PDF_PROCESS_TIMEOUT_MS || 180000)

/** Quick binary sniff so garbage uploads fail before the parser runs. */
const looksLikePdf = (buffer) => {
  const head = buffer.subarray(0, 1024).toString('latin1')
  return head.includes(PDF_MAGIC)
}

/**
 * Full extraction pipeline (without duplicate detection).
 * @param {Buffer} buffer raw PDF bytes
 */
const extractQuestionsFromPdf = async (buffer, { onProgress } = {}) => {
  const startedAt = Date.now()
  const deadline = startedAt + PROCESS_TIMEOUT_MS
  const warnings = []

  if (!buffer || !looksLikePdf(buffer)) {
    throw new PdfTextError('CORRUPTED_PDF', 'This file is not a valid PDF document.')
  }

  // ── 1. Text layer ────────────────────────────────────────────────────
  let textResult
  try {
    if (onProgress) onProgress({ stage: 'Reading PDF', percent: 5 })
    textResult = await extractPdfPages(buffer, { maxPages: MAX_PDF_PAGES, onProgress })
  } catch (err) {
    if (err instanceof PdfTextError) throw err
    throw new PdfTextError('UNSUPPORTED_PDF', 'The PDF structure could not be processed.', err)
  }

  if (textResult.numPages > MAX_PDF_PAGES) {
    throw new PdfTextError(
      'TOO_MANY_PAGES',
      `This PDF has ${textResult.numPages} pages. Please split it into documents of up to ${MAX_PDF_PAGES} pages.`,
    )
  }

  let mode = 'text'
  let pages = textResult.pages
  let ocrInfo = null

  // ── 2. Scanned PDF fallback: OCR ─────────────────────────────────────
  if (!textResult.hasText || isScannedPdf(pages)) {
    mode = 'ocr'
    warnings.push('No selectable text found — the PDF was treated as a scanned document and processed with OCR.')
    if (onProgress) onProgress({ stage: 'Reading scanned pages', percent: 10 })
    const ocr = await ocrPdfBuffer(buffer, { maxPages: MAX_OCR_PAGES, deadlineMs: deadline, onProgress })
    pages = ocr.pages
    ocrInfo = {
      meanConfidence: Math.round(ocr.meanConfidence * 100) / 100,
      usedPages: ocr.usedPages,
      truncated: ocr.truncated,
    }
    if (ocr.meanConfidence < 0.6) {
      warnings.push(`OCR confidence is low (${Math.round(ocr.meanConfidence * 100)}%). Extracted questions are flagged for review.`)
    }
  }

  const cleanedPages = stripChrome(pages)

  // ── 3. Question parsing ──────────────────────────────────────────────
  if (onProgress) onProgress({ stage: 'Extracting questions', percent: 70 })
  const parsed = parseQuestions(cleanedPages, {
    mode,
    ocrConfidence: ocrInfo ? ocrInfo.meanConfidence : undefined,
  })
  warnings.push(...parsed.warnings)

  // ── 4. Post-processing / normalisation ───────────────────────────────
  const questions = parsed.questions.map((q, index) => ({
    ...q,
    question: normalizeMathText(q.question).slice(0, MAX_QUESTION_CHARS),
    questionNumber: q.questionNumber || index + 1,
  }))

  // Questions whose options are all empty are dropped with a warning
  const usable = []
  questions.forEach((q) => {
    const nonEmptyOptions = Object.values(q.options).filter((v) => v && String(v).trim().length)
    if (!q.question && nonEmptyOptions.length === 0) {
      warnings.push(`Question ${q.questionNumber} contained no readable content and was skipped.`)
      return
    }
    usable.push(q)
  })

  if (!usable.length) {
    throw new PdfTextError(
      'NO_QUESTIONS_FOUND',
      mode === 'ocr'
        ? 'No questions could be recognised in this scanned PDF. Check the scan quality or add questions manually.'
        : 'No questions could be detected in this PDF. Ensure questions are numbered (e.g. "1." or "Q1") with options A-D.',
    )
  }

  return {
    questions: usable,
    warnings,
    meta: {
      mode,
      pagesProcessed: cleanedPages.length,
      totalDocPages: textResult.numPages,
      truncated: textResult.truncated || Boolean(ocrInfo && ocrInfo.truncated),
      answerKeyEntries: parsed.answerKeyFound,
      ocr: ocrInfo,
      processingMs: Date.now() - startedAt,
    },
  }
}

/**
 * Extraction + duplicate detection + CET classification.
 *
 * Classification and analysis extend the extracted questions in place (no
 * existing field is removed) and are purely additive for the response, so a
 * classification failure never blocks the import workflow itself.
 *
 * @param {Buffer} buffer raw PDF bytes
 * @param {object} [opts]
 * @param {string} [opts.fileName] original upload name (source tracking)
 */
const extractAndFlagDuplicates = async (buffer, { fileName, onProgress } = {}) => {
  const { questions, warnings, meta } = await extractQuestionsFromPdf(buffer, { onProgress })

  let existing = []
  if (onProgress) onProgress({ stage: 'Checking duplicates', percent: 82 })
  try {
    existing = await db.getQuestionFingerprints()
  } catch (err) {
    warnings.push('Existing question bank could not be checked for duplicates.')
  }

  const decorated = flagDuplicates(questions, existing)
  const duplicateCount = decorated.filter((q) => q.duplicate).length
  if (duplicateCount > 0) {
    warnings.push(`${duplicateCount} question(s) look like duplicates of existing bank questions and are marked for your review.`)
  }

  // ── MHT-CET classification: subject -> chapter -> topic -> sub-topic,
  //    question type, difficulty, relevance + distribution analysis. ──────
  let classified = decorated
  let analysis = null
  if (onProgress) onProgress({ stage: 'Classifying questions', percent: 90 })
  try {
    classified = classifyQuestions(decorated, { sourcePdf: fileName })
    analysis = buildAnalysis(classified)
  } catch (err) {
    warnings.push('Automatic CET classification could not be completed — questions can still be reviewed and imported.')
  }

  return { questions: classified, warnings, meta, duplicateCount, analysis }
}

module.exports = {
  extractQuestionsFromPdf,
  extractAndFlagDuplicates,
  looksLikePdf,
  PdfTextError,
  MAX_PDF_PAGES,
  MAX_OCR_PAGES,
  PROCESS_TIMEOUT_MS,
}
