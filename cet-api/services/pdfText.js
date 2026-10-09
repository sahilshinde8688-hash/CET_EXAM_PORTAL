/**
 * pdfText.js
 * ----------
 * Low-level PDF text extraction built on pdfjs-dist (the same engine Firefox
 * uses). Produces position-aware lines per page so the question parser can
 * rebuild the reading order of a printed exam paper.
 *
 * Security notes:
 * - Parsing happens fully in-process with `isEvalSupported: false`, so PDF
 *   content (JavaScript actions, embedded files, font programs) is never
 *   executed — only the text layer is decoded.
 * - Nothing is written to disk: callers pass a Buffer and receive plain data.
 * - Rendering is optional and only used by the OCR path for scanned PDFs.
 */

const fs = require('fs')
const path = require('path')

const MAX_RENDER_PIXELS = 2_000_000
const MAX_RENDER_DIMENSION = 3000
const MIN_RENDER_SCALE = 0.5

// Lazy-loaded ESM module from the CommonJS backend
let pdfjsPromise = null

const loadPdfjs = async () => {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((mod) => mod.default || mod)
  }
  return pdfjsPromise
}

/** Resolve bundled pdf.js asset dirs (standard fonts + CJK cmaps) on disk. */
const pdfjsAssetDirs = () => {
  try {
    const pkgPath = require.resolve('pdfjs-dist/package.json')
    const root = path.dirname(pkgPath)
    return {
      standardFontDataUrl: path.join(root, 'standard_fonts') + path.sep,
      cMapUrl: path.join(root, 'cmaps') + path.sep,
    }
  } catch {
    return { standardFontDataUrl: undefined, cMapUrl: undefined }
  }
}

/** Typed error used to map engine failures onto meaningful API responses. */
class PdfTextError extends Error {
  constructor(code, message, cause) {
    super(message)
    this.name = 'PdfTextError'
    this.code = code
    if (cause) this.cause = cause
  }
}

const isMeaningfulText = (str) => Boolean(str) && /\S/.test(str)

/**
 * Group a page's positioned text items into visual lines (top -> bottom) and,
 * within each line, join fragments left -> right. Small fragments raised above
 * (or dropped below) the line baseline are treated as super/subscripts and are
 * appended in caret notation so "x2"-style glyph runs survive as "x^2".
 */
const buildLinesFromItems = (items, pageHeight) => {
  const fragments = []
  for (const item of items) {
    if (!item.str || !isMeaningfulText(item.str)) continue
    const tr = item.transform || [1, 0, 0, 1, 0, 0]
    const height = Math.abs(item.height) || Math.abs(tr[3]) || Math.abs(tr[0]) || 10
    fragments.push({
      text: item.str,
      x: tr[4],
      y: tr[5],
      height,
      width: item.width || 0,
      hasEOL: Boolean(item.hasEOL),
    })
  }
  if (!fragments.length) return []

  // Dominant body font size for the page (used to detect raised glyphs).
  const sizeCounts = new Map()
  fragments.forEach((f) => {
    const key = f.height.toFixed(1)
    sizeCounts.set(key, (sizeCounts.get(key) || 0) + f.text.length)
  })
  let dominantSize = 10
  let dominantCount = -1
  for (const [key, count] of sizeCounts.entries()) {
    const size = Number(key)
    // Ignore the giant decorative fonts sometimes used for watermarks
    if (count > dominantCount && size <= pageHeight * 0.08) {
      dominantCount = count
      dominantSize = size
    }
  }
  if (dominantCount < 0) dominantSize = Math.max(...fragments.map((f) => f.height))

  // Group fragments into lines by baseline y. The tolerance is generous
  // enough that raised/dropped exponent glyphs stay on the owner line (they
  // sit roughly 0.3–0.5em off the baseline) while normal leading (>= 0.9em)
  // never merges two printed lines together.
  const tolerance = Math.max(2, dominantSize * 0.5)
  fragments.sort((a, b) => (b.y - a.y) || (a.x - b.x))
  const lines = []
  for (const frag of fragments) {
    const line = lines.find((l) => Math.abs(l.y - frag.y) <= tolerance)
    if (line) {
      line.items.push(frag)
      line.y = (line.y * line.items.length + frag.y) / (line.items.length + 1)
    } else {
      lines.push({ y: frag.y, items: [frag] })
    }
  }

  // A fragment qualifies as super/subscript only when it is BOTH noticeably
  // smaller than the body font AND clearly offset from the line's body
  // baseline — exactly how typeset exponents and indices are drawn. The
  // baseline is computed from body-size fragments only: averaging in the
  // script glyphs themselves would shrink their own offset below detection.
  const scriptToken = /^[0-9A-Za-z+\-°'"]{1,6}$/
  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => {
      const sorted = line.items.sort((a, b) => a.x - b.x)
      const bodyItems = sorted.filter((f) => f.height >= dominantSize * 0.75)
      const baseline = bodyItems.length
        ? bodyItems.reduce((sum, f) => sum + f.y, 0) / bodyItems.length
        : line.y
      let text = ''
      let prevEnd = null
      for (const frag of sorted) {
        let piece = frag.text.replace(/\s+$/g, '')
        const small = sorted.length > 1 && frag.height < dominantSize * 0.75
        const baselineDelta = frag.y - baseline
        if (small && scriptToken.test(piece) && baselineDelta > dominantSize * 0.15) {
          text += `^${piece}`
          prevEnd = frag.x + frag.width // keep spacing context for the next run
          continue
        }
        if (small && scriptToken.test(piece) && baselineDelta < -dominantSize * 0.15) {
          text += `_${piece}`
          prevEnd = frag.x + frag.width
          continue
        }
        if (prevEnd !== null) {
          const gap = frag.x - prevEnd
          // Insert a space when fragments are visually separated, but glue
          // tight letter runs back together ("MCA" style kerning splits).
          if (gap > frag.height * 0.22 && !/\s$/.test(text) && !/^\s/.test(piece)) text += ' '
        }
        text += piece
        prevEnd = frag.x + frag.width
      }
      return { text: text.replace(/\s+/g, ' ').trim(), y: baseline, pageHeight }
    })
    .filter((line) => line.text.length > 0)
}

/**
 * Extract the text layer of a PDF.
 *
 * @param {Buffer|Uint8Array} buffer raw PDF bytes
 * @param {object} opts
 * @param {number} [opts.maxPages] hard cap on pages parsed (DoS guard)
 * @returns {Promise<{pages: Array, numPages: number, hasText: boolean, info: object, truncated: boolean}>}
 */
const extractPdfPages = async (buffer, { maxPages = 200, onProgress } = {}) => {
  const pdfjs = await loadPdfjs()
  const assets = pdfjsAssetDirs()

  let doc
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false, // never evaluate PostScript/JS found inside the PDF
      disableFontFace: true,
      useSystemFonts: false,
      standardFontDataUrl: assets.standardFontDataUrl,
      cMapUrl: assets.cMapUrl,
      cMapPacked: true,
    }).promise
  } catch (err) {
    const name = err?.name || ''
    if (name === 'PasswordException') {
      throw new PdfTextError('PASSWORD_PROTECTED', 'This PDF is password-protected. Remove the password and upload again.', err)
    }
    if (name === 'InvalidPDFException') {
      throw new PdfTextError('CORRUPTED_PDF', 'The PDF file appears to be corrupted or is not a valid PDF document.', err)
    }
    throw new PdfTextError('UNSUPPORTED_PDF', 'The PDF could not be opened (unsupported or damaged structure).', err)
  }

  try {
    const numPages = doc.numPages
    const pageLimit = Math.min(numPages, maxPages)
    const pages = []

    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await doc.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const lines = buildLinesFromItems(content.items, viewport.height)
      pages.push({
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        lines,
      })
      page.cleanup()
      if (onProgress) {
        onProgress({ stage: 'Reading PDF', percent: 5 + Math.round((pageNumber / pageLimit) * 25) })
      }
    }

    const hasText = pages.some((p) => p.lines.length > 0)
    return {
      pages,
      numPages,
      truncated: numPages > maxPages,
      hasText,
      info: doc.info || {},
    }
  } finally {
    try { await doc.destroy() } catch { /* noop */ }
  }
}

/**
 * Render a single PDF page to a PNG buffer (used only by the OCR pipeline for
 * scanned/image PDFs). Requires the optional @napi-rs/canvas package.
 */
const renderPageToPng = async (doc, pageNumber, { scale = 2 } = {}) => {
  const { createCanvas, DOMMatrix, Path2D, ImageData } = require('@napi-rs/canvas')
  // pdfjs legacy build probes these globals when rasterising in Node
  if (typeof globalThis.DOMMatrix === 'undefined') globalThis.DOMMatrix = DOMMatrix
  if (typeof globalThis.Path2D === 'undefined') globalThis.Path2D = Path2D
  if (typeof globalThis.ImageData === 'undefined') globalThis.ImageData = ImageData

  const page = await doc.getPage(pageNumber)
  let canvas
  try {
    const baseViewport = page.getViewport({ scale: 1 })
    if (![baseViewport.width, baseViewport.height].every((dimension) =>
      Number.isFinite(dimension) && dimension > 0)) {
      throw new PdfTextError('INVALID_PAGE_SIZE', 'This PDF contains a page with invalid dimensions.')
    }
    const safeScale = Math.min(
      scale,
      Math.sqrt(MAX_RENDER_PIXELS / (baseViewport.width * baseViewport.height)) * 0.999,
      (MAX_RENDER_DIMENSION / baseViewport.width) * 0.999,
      (MAX_RENDER_DIMENSION / baseViewport.height) * 0.999,
    )
    if (!Number.isFinite(safeScale) || safeScale < MIN_RENDER_SCALE) {
      throw new PdfTextError('PAGE_TOO_LARGE', 'A PDF page is too large to process safely. Split the document and retry.')
    }
    const viewport = page.getViewport({ scale: safeScale })
    canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport, background: '#ffffff' }).promise
    return canvas.toBuffer('image/png')
  } finally {
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
    page.cleanup()
  }
}

/** Open a document for rendering (kept separate so OCR failures never leak doc handles). */
const openForRendering = async (buffer) => {
  const pdfjs = await loadPdfjs()
  const assets = pdfjsAssetDirs()
  return pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: assets.standardFontDataUrl,
    cMapUrl: assets.cMapUrl,
    cMapPacked: true,
  }).promise
}

module.exports = {
  PdfTextError,
  extractPdfPages,
  renderPageToPng,
  openForRendering,
  buildLinesFromItems,
}
