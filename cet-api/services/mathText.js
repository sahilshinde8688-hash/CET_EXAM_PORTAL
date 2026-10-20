/**
 * mathText.js
 * -----------
 * Unicode / math-aware text helpers shared by the PDF question extraction engine
 * and the duplicate detection utility.
 *
 * Goal: preserve mathematical meaning (fractions, powers, roots, Greek letters,
 * matrices, operators) instead of collapsing expressions into corrupted plain
 * text. Storage keeps meaningful Unicode math symbols while decorative math
 * fonts and super/subscripts are expanded into the caret/underscore notation
 * already used by the question editor toolbar ("x^2", "H_2O").
 */

const SUPERSCRIPT_MAP = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-', '⁼': '=', 'ⁿ': 'n', 'ⁱ': 'i',
}

const SUBSCRIPT_MAP = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '₊': '+', '₋': '-', '₌': '=', 'ₙ': 'n', 'ₓ': 'x',
}

// Vulgar fractions -> explicit "a/b" (readable in every renderer and searchable)
const FRACTION_MAP = {
  '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4',
  '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6',
  '⅚': '5/6', '⅐': '1/7', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8',
  '⅞': '7/8', '⅑': '1/9', '⅒': '1/10', '⁄': '/',
}

// Characters PDF text layers frequently emit that must never reach the DB raw.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g

/**
 * Canonicalise extracted math text for storage / display.
 * - Keeps meaningful math symbols exactly as printed: √ ∫ Σ ∏ π θ ≤ ≥ ≠ ± × ÷ ° ∞ →
 * - Expands super/subscripts to ^ / _ notation and vulgar fractions to a/b
 * - NFKC-decodes decorative math fonts (𝑥 -> x, 𝐴 -> A, 𝟏 -> 1) and ligatures
 * - Strips control characters and normalises exotic whitespace/quotes/dashes
 */
const normalizeMathText = (raw) => {
  if (raw === null || raw === undefined) return ''
  let text = String(raw)
    // Protect semantic math notation before compatibility normalisation
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼ⁿⁱ]/g, (ch) => `\u0001${SUPERSCRIPT_MAP[ch]}\u0002`)
    .replace(/[₀₁₂₃₄₅₆₇₈₉₊₋₌ₙₓ]/g, (ch) => `\u0003${SUBSCRIPT_MAP[ch]}\u0004`)
    .replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅐⅛⅜⅝⅞⅑⅒⁄]/g, (ch) => `\u0005${FRACTION_MAP[ch]}\u0006`)
    // Merge adjacent script runs so "x⁻²" becomes "x^-2", not "x^-^2"
    .replace(/\u0002\u0001/g, '')
    .replace(/\u0004\u0003/g, '')
    // NFKC: decode mathematical alphanumeric symbols (𝑥²-fonts), ligatures (ﬁ),
    // circled/enclosed alphanumerics and other compatibility characters.
    .normalize('NFKC')
    .replace(/\u0001/g, '^')
    .replace(/\u0003/g, '_')
    .replace(/\u0002/g, '')
    .replace(/\u0004/g, '')
    .replace(/\u0005/g, '')
    .replace(/\u0006/g, '')
    // Typographic artefacts common in PDF text layers
    .replace(CONTROL_CHARS, ' ')
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2012\u2013\u2014\u2015]/g, '-')

  return text.replace(/[ \t]+/g, ' ').trim()
}

/**
 * Aggressive normalisation used ONLY for duplicate detection / fingerprinting.
 * Lowercases, strips all punctuation and math decoration, and keeps just
 * letters, digits and single spaces so "Find the value of x² + 1" and
 * "find the value of x^2 + 1" produce identical fingerprints.
 */
const normalizeForMatching = (raw) => {
  if (raw === null || raw === undefined) return ''
  let text = normalizeMathText(String(raw)
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")).toLowerCase()
  text = text
    .replace(/√\s*/g, ' sqrt ')
    .replace(/[×✕✖]/g, ' * ')
    .replace(/÷/g, ' / ')
    .replace(/[−–—]/g, '-')
  text = text.replace(/[^a-z0-9]+/g, ' ')
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * True when a line is mostly numeric/symbol content, e.g. a wrapped matrix row
 * like "[ 1  2" or "3  4 ]". Used to re-join such rows with '; ' separators.
 */
const isNumericMatrixRow = (line) => {
  const trimmed = String(line || '').trim()
  if (!trimmed) return false
  const stripped = trimmed.replace(/[[\]{}()|;\s]/g, '')
  if (!stripped) return false
  return /^[\d.,;+\-*/^_ ]*$/.test(stripped)
}

module.exports = {
  normalizeMathText,
  normalizeForMatching,
  isNumericMatrixRow,
  SUPERSCRIPT_MAP,
  SUBSCRIPT_MAP,
}