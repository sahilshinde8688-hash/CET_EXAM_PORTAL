/**
 * ocrService.js
 * -------------
 * OCR pipeline for scanned / image-only PDFs (no selectable text layer).
 *
 * Flow: render each page to PNG (pdfjs + @napi-rs/canvas) -> Tesseract.js
 * -> text lines + per-page confidence. Tesseract.js is lazy-required so text
 * PDFs never pay the worker start-up cost.
 *
 * The language pack is downloaded once by Tesseract.js and cached in the OS
 * temp dir (override with PDF_OCR_LANG_PATH for fully offline deployments).
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { PdfTextError } = require('./pdfText')

const DEFAULT_OCR_LANG = process.env.PDF_OCR_LANG || 'eng'
const DEFAULT_OCR_SCALE = 2 // ~144dpi at 72dpi source — good speed/accuracy balance

/** Average characters per page below which a PDF is considered image-only. */
const isScannedPdf = (pages) => {
  if (!pages || !pages.length) return false
  const totalChars = pages.reduce((sum, p) => sum + p.lines.reduce((s, l) => s + l.text.length, 0), 0)
  return totalChars / pages.length < 30
}

/** Group raw OCR text into line objects compatible with the question parser. */
const ocrTextToLines = (text) =>
  String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((text, index) => ({ text, y: -index, pageHeight: 792 }))

/**
 * OCR a PDF buffer page by page.
 *
 * @param {Buffer} buffer raw PDF bytes
 * @param {object} opts
 * @param {number} [opts.maxPages] hard cap on OCR'd pages (default env PDF_OCR_MAX_PAGES || 40)
 * @param {number} [opts.deadlineMs] absolute wall-clock budget for the whole job
 * @returns {Promise<{pages: Array, pageConfidences: number[], meanConfidence: number, usedPages: number, truncated: boolean}>}
 */
const ocrPdfBuffer = async (buffer, { maxPages, deadlineMs, onProgress } = {}) => {
  const pageCap = Number(maxPages || process.env.PDF_OCR_MAX_PAGES || 40)
  const lang = DEFAULT_OCR_LANG
  const langPath = process.env.PDF_OCR_LANG_PATH || undefined
  const cachePath = path.join(os.tmpdir(), 'cet-ocr-cache')
  try { fs.mkdirSync(cachePath, { recursive: true }) } catch { /* best effort */ }

  let tesseract
  try {
    tesseract = require('tesseract.js')
  } catch (err) {
    throw new PdfTextError('OCR_FAILED', 'OCR engine is not available on this server.', err)
  }

  const { openForRendering, renderPageToPng } = require('./pdfText')

  let doc
  let worker
  const pages = []
  const pageConfidences = []

  try {
    doc = await openForRendering(buffer)
    const pageCount = Math.min(doc.numPages, pageCap)

    worker = await tesseract.createWorker(lang, 1, {
      cachePath,
      ...(langPath ? { langPath } : {}),
      gzip: true,
    })

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      if (deadlineMs && Date.now() > deadlineMs) {
        throw new PdfTextError('PROCESSING_TIMEOUT', 'PDF processing timed out. Please upload a smaller document and try again.')
      }
      let png
      try {
        png = await renderPageToPng(doc, pageNumber, { scale: DEFAULT_OCR_SCALE })
      } catch (err) {
        pages.push({ pageNumber, lines: [], ocr: true, renderFailed: true })
        pageConfidences.push(0)
        continue
      }
      try {
        const { data } = await worker.recognize(png)
        const confidence = typeof data.confidence === 'number' ? data.confidence / 100 : 0.5
        pages.push({ pageNumber, lines: ocrTextToLines(data.text), ocr: true })
        pageConfidences.push(confidence)
      } catch (err) {
        pages.push({ pageNumber, lines: [], ocr: true, ocrFailed: true })
        pageConfidences.push(0)
      }
      if (onProgress) {
        onProgress({ stage: 'Reading scanned pages', percent: 10 + Math.round((pageNumber / pageCount) * 55) })
      }
    }

    const usedPages = pages.filter((p) => p.lines.length > 0).length
    if (usedPages === 0) {
      throw new PdfTextError('OCR_FAILED', 'OCR could not read any text from this scanned PDF. The scan quality may be too low.')
    }

    const meanConfidence = pageConfidences.length
      ? pageConfidences.reduce((a, b) => a + b, 0) / pageConfidences.length
      : 0

    return {
      pages,
      pageConfidences,
      meanConfidence,
      usedPages,
      truncated: doc.numPages > pageCount,
      totalDocPages: doc.numPages,
    }
  } catch (err) {
    if (err instanceof PdfTextError) throw err
    throw new PdfTextError('OCR_FAILED', 'OCR processing failed for this PDF.', err)
  } finally {
    if (worker) { try { await worker.terminate() } catch { /* noop */ } }
    if (doc) { try { await doc.destroy() } catch { /* noop */ } }
  }
}

module.exports = { isScannedPdf, ocrPdfBuffer, ocrTextToLines }
