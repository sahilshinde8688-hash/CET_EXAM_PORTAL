const sanitizeHtml = require('sanitize-html')

const leakedPresentationAttributes = /["']?\s*role\s*=\s*["']presentation["']\s+style\s*=\s*["'][\s\S]*?(?:--tw-|box-sizing\s*:)[\s\S]*?["']\s*>/gi
const removeLeakedPresentationText = (content) => content.replace(leakedPresentationAttributes, '')

const QUESTION_CONTENT_OPTIONS = {
  allowedTags: [
    'p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup',
    'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tfoot', 'tr',
    'th', 'td', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code', 'img',
    'math', 'mrow', 'mi', 'mn', 'mo', 'mfrac', 'msqrt', 'mroot', 'msup',
    'msub', 'msubsup', 'mfenced', 'mtable', 'mtr', 'mtd', 'mtext', 'mspace',
    'mstyle', 'semantics', 'annotation',
  ],
  allowedAttributes: {
    '*': [
      'style', 'display', 'mathvariant', 'stretchy', 'fence', 'separator',
      'linethickness', 'columnalign', 'rowalign', 'columnspan', 'rowspan',
      'open', 'close', 'encoding',
    ],
    td: ['colspan', 'rowspan', 'style'],
    th: ['colspan', 'rowspan', 'style'],
    img: ['src', 'alt', 'width', 'height'],
  },
  allowedSchemes: ['http', 'https'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowedStyles: {
    '*': {
      'font-weight': [/^(?:normal|bold|[1-9]00)$/],
      'font-style': [/^(?:normal|italic|oblique)$/],
      'text-decoration': [/^(?:none|underline|line-through)$/],
      'text-align': [/^(?:left|right|center|justify)$/],
      'vertical-align': [/^(?:baseline|sub|super|middle|top|bottom)$/],
      'font-size': [/^(?:\d+(?:\.\d+)?(?:px|pt|em|rem|%))$/],
      'line-height': [/^(?:\d+(?:\.\d+)?(?:px|pt|em|rem|%)?)$/],
      margin: [/^(?:-?\d+(?:\.\d+)?(?:px|pt|em|rem|%))(?:\s+-?\d+(?:\.\d+)?(?:px|pt|em|rem|%)){0,3}$/],
      padding: [/^(?:\d+(?:\.\d+)?(?:px|pt|em|rem|%))(?:\s+\d+(?:\.\d+)?(?:px|pt|em|rem|%)){0,3}$/],
      color: [/^#[0-9a-f]{3,8}$/i, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/i, /^[a-z]{3,20}$/i],
      'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/i, /^[a-z]{3,20}$/i],
    },
  },
  disallowedTagsMode: 'discard',
  nonTextTags: ['style', 'script', 'textarea', 'option', 'nav', 'header', 'footer', 'aside', 'button', 'form', 'select', 'iframe', 'object', 'embed'],
  parser: { decodeEntities: true },
  textFilter: removeLeakedPresentationText,
}

const normalizeEscapedQuestionContent = (content) => {
  const encodedFormattingTag = /&lt;\/?(?:p|br|div|span|b|strong|i|em|u|s|sub|sup|ul|ol|li|blockquote|table|thead|tbody|tr|th|td|hr|h[1-6]|pre|code|img|math|mrow|mi|mn|mo|mfrac|msqrt|mroot|msup|msub|msubsup|mfenced|mtable|mtr|mtd|mtext|mspace|mstyle|semantics|annotation)\b/i
  return encodedFormattingTag.test(content)
    ? content
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
    : content
}

function isMatrixCell(str) {
  const trimmed = str.trim()
  if (!trimmed) return false
  return /^[+\-−]?(?:\d+(?:\.\d+)?|[a-zA-Z](?:[_^][a-zA-Z0-9]+)?)(?:\/[+\-−]?(?:\d+|[a-zA-Z]))?$/.test(trimmed)
}

function parseCells(str) {
  return str.trim().split(/\s*,\s*|\s+/).filter(Boolean)
}

function reconstructDisconnectedMatrices(text) {
  if (!text) return ''

  let normalized = text.replace(
    /([(\[{\|])\s*([^()[\]{}|;]+(?:\s*;\s*[^()[\]{}|;]+)+)\s*([)\]}|])/g,
    (match, openBracket, matrixContent, closeBracket) => {
      const rawRows = matrixContent.split(/\s*;\s*|\r?\n/).map(r => r.trim()).filter(Boolean)
      if (rawRows.length < 2) return match

      const parsedRows = rawRows.map(r => parseCells(r))
      const colCount = parsedRows[0].length
      if (colCount < 1 || colCount > 6) return match
      if (!parsedRows.every(r => r.length === colCount && r.every(isMatrixCell))) return match

      const env = openBracket === '[' && closeBracket === ']'
        ? 'bmatrix'
        : (openBracket === '|' && closeBracket === '|')
          ? 'vmatrix'
          : 'pmatrix'

      const latexRows = parsedRows.map(r => r.map(c => c.replace(/[−–—]/g, '-')).join(' & ')).join(' \\\\ ')
      return `\\(\\begin{${env}}${latexRows}\\end{${env}}\\)`
    },
  )

  const lines = normalized.split(/\r?\n/)
  const resultLines = []
  let pendingRows = []

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    const trimmed = rawLine.trim()
    if (!trimmed) {
      if (pendingRows.length === 0) resultLines.push(rawLine)
      continue
    }

    const cells = parseCells(trimmed)
    if (cells.length >= 2 && cells.length <= 6 && cells.every(isMatrixCell)) {
      pendingRows.push(cells)
      continue
    }

    if (pendingRows.length > 0) {
      const match = trimmed.match(/^([\s\S]*?[=≈]\s*)([\(\[\{])([^\(\)\[\]\{\};]+)([\)\]\}])([\s\S]*)$/)
      if (match) {
        const prefix = match[1]
        const openBracket = match[2]
        const inlineRowText = match[3]
        const closeBracket = match[4]
        const suffix = match[5]

        const inlineCells = parseCells(inlineRowText)
        const expectedCols = pendingRows[0].length
        if (
          inlineCells.length === expectedCols &&
          pendingRows.every(r => r.length === expectedCols) &&
          inlineCells.every(isMatrixCell)
        ) {
          const allRows = [...pendingRows, inlineCells]
          const env = openBracket === '[' && closeBracket === ']'
            ? 'bmatrix'
            : openBracket === '{'
              ? 'Bmatrix'
              : 'pmatrix'
          const latexRows = allRows.map(row => row.map(c => c.replace(/[−–—]/g, '-')).join(' & ')).join(' \\\\ ')
          const matrixLatex = `\\(\\begin{${env}}${latexRows}\\end{${env}}\\)`
          resultLines.push(`${prefix}${matrixLatex}${suffix}`)
          pendingRows = []
          continue
        }
      }

      resultLines.push(...pendingRows.map(r => r.join(' ')))
      pendingRows = []
    }

    resultLines.push(rawLine)
  }

  if (pendingRows.length > 0) {
    resultLines.push(...pendingRows.map(r => r.join(' ')))
  }

  return resultLines.join('\n')
}

function ensureMathDelimiters(content) {
  if (!content) return ''
  return content.replace(
    /(?:(\\begin\{(?:pmatrix|bmatrix|vmatrix|Vmatrix|matrix|Bmatrix)\}[\s\S]*?\\end\{(?:pmatrix|bmatrix|vmatrix|Vmatrix|matrix|Bmatrix)\}))/g,
    (match, env, offset, full) => {
      const before = full.slice(Math.max(0, offset - 3), offset)
      const after = full.slice(offset + match.length, offset + match.length + 3)
      if (before.endsWith('\\(') && after.startsWith('\\)')) return match
      if (before.endsWith('\\[') && after.startsWith('\\]')) return match
      if (before.endsWith('$$') && after.startsWith('$$')) return match
      if (before.endsWith('$') && after.startsWith('$')) return match
      return `\\(${env}\\)`
    },
  )
}

const sanitizeQuestionContent = (content) => {
  let value = removeLeakedPresentationText(normalizeEscapedQuestionContent(String(content || '')))
  value = reconstructDisconnectedMatrices(value)
  value = ensureMathDelimiters(value)
  return /<\/?[a-z][^>]*>/i.test(value)
    ? ensureMathDelimiters(removeLeakedPresentationText(sanitizeHtml(value, QUESTION_CONTENT_OPTIONS)))
    : value
}

module.exports = {
  sanitizeQuestionContent,
  reconstructDisconnectedMatrices,
  ensureMathDelimiters,
}
