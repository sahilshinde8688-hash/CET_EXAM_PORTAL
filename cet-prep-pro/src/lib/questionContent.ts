import DOMPurify from 'dompurify'

const allowedTags = [
  'p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup',
  'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tfoot', 'tr',
  'th', 'td', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code',
  'img',
  'math', 'mrow', 'mi', 'mn', 'mo', 'mfrac', 'msqrt', 'mroot', 'msup',
  'msub', 'msubsup', 'mfenced', 'mtable', 'mtr', 'mtd', 'mtext', 'mspace',
  'mstyle', 'semantics', 'annotation',
]

const allowedAttributes = [
  'style', 'colspan', 'rowspan', 'display', 'mathvariant', 'stretchy',
  'fence', 'separator', 'linethickness', 'columnalign', 'rowalign', 'columnspan',
  'src', 'alt', 'width', 'height', 'open', 'close', 'encoding',
]

const encodedFormattingTag = /&lt;\/?(?:p|br|div|span|b|strong|i|em|u|s|sub|sup|ul|ol|li|blockquote|table|thead|tbody|tr|th|td|hr|h[1-6]|pre|code|img|math|mrow|mi|mn|mo|mfrac|msqrt|mroot|msup|msub|msubsup|mfenced|mtable|mtr|mtd|mtext|mspace|mstyle|semantics|annotation)\b/i
const leakedPresentationAttributes = /["']?\s*role\s*=\s*["']presentation["']\s+style\s*=\s*["'][\s\S]*?(?:--tw-|box-sizing\s*:)[\s\S]*?["']\s*>/gi

const mathOperators: Record<string, string> = {
  '−': '-',
  '–': '-',
  '—': '-',
  '×': '\\times ',
  '÷': '\\div ',
  '·': '\\cdot ',
  '±': '\\pm ',
  '∓': '\\mp ',
  '≤': '\\le ',
  '≥': '\\ge ',
  '≠': '\\ne ',
  '≈': '\\approx ',
  '≡': '\\equiv ',
  '∈': '\\in ',
  '∉': '\\notin ',
  '⊂': '\\subset ',
  '⊆': '\\subseteq ',
  '∪': '\\cup ',
  '∩': '\\cap ',
  '→': '\\to ',
  '⇒': '\\implies ',
  '⇔': '\\iff ',
  'π': '\\pi ',
  '∞': '\\infty ',
  '∂': '\\partial ',
  '∇': '\\nabla ',
  '∫': '\\int ',
  '∑': '\\sum ',
  '∏': '\\prod ',
  '√': '\\sqrt ',
}

const greekLetters: Record<string, string> = {
  'α': '\\alpha ', 'β': '\\beta ', 'γ': '\\gamma ', 'δ': '\\delta ',
  'ε': '\\epsilon ', 'θ': '\\theta ', 'λ': '\\lambda ', 'μ': '\\mu ',
  'π': '\\pi ', 'σ': '\\sigma ', 'τ': '\\tau ', 'φ': '\\phi ',
  'ψ': '\\psi ', 'ω': '\\omega ', 'Δ': '\\Delta ', 'Ω': '\\Omega ',
  'Σ': '\\Sigma ', 'Φ': '\\Phi ', 'Ψ': '\\Psi ', 'Γ': '\\Gamma ',
  'Λ': '\\Lambda ', 'Θ': '\\Theta ',
}

export interface PreparedPaste {
  content: string
  warning: string
}

export function normalizeEscapedQuestionContent(content: string): string {
  if (!encodedFormattingTag.test(content)) return content
  return content
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
}

function removeLeakedPresentationText(root: ParentNode): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  let current: Node | null
  while ((current = walker.nextNode())) {
    if (current.nodeValue) textNodes.push(current as Text)
  }

  const combinedText = textNodes.map(node => node.data).join('')
  const ranges = Array.from(combinedText.matchAll(leakedPresentationAttributes), match => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }))

  for (const { start, end } of ranges.reverse()) {
    let offset = 0
    let startNode: Text | undefined
    let startOffset = 0
    let endNode: Text | undefined
    let endOffset = 0

    for (const textNode of textNodes) {
      const nodeStart = offset
      const nodeEnd = nodeStart + textNode.data.length
      if (!startNode && start >= nodeStart && start < nodeEnd) {
        startNode = textNode
        startOffset = start - nodeStart
      }
      if (end > nodeStart && end <= nodeEnd) {
        endNode = textNode
        endOffset = end - nodeStart
        break
      }
      offset = nodeEnd
    }

    if (!startNode || !endNode) continue
    const range = document.createRange()
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)
    range.deleteContents()
  }
}

function determineMatrixEnvironment(open?: string | null, close?: string | null): string {
  const o = open?.trim()
  const c = close?.trim()
  if (o === '[' && c === ']') return 'bmatrix'
  if (o === '|' && c === '|') return 'vmatrix'
  if ((o === '‖' && c === '‖') || (o === '||' && c === '||')) return 'Vmatrix'
  if (o === '{' && c === '}') return 'Bmatrix'
  return 'pmatrix'
}

function tableToMatrixLatex(tableNode: Element, defaultEnv = 'pmatrix'): string {
  const rows = Array.from(tableNode.children)
    .filter(child => child.localName.toLowerCase() === 'mtr' || child.localName.toLowerCase() === 'mlabeledtr')
    .map(row => Array.from(row.children)
      .filter(cell => cell.localName.toLowerCase() === 'mtd')
      .map(cell => mathChildrenToLatex(cell).trim())
      .join(' & '))
    .filter(row => row.length > 0)

  if (!rows.length) return ''
  return `\\begin{${defaultEnv}}${rows.join(' \\\\ ')}\\end{${defaultEnv}}`
}

function mrowToLatex(node: Element): string {
  const children = Array.from(node.children)
  const tableIndex = children.findIndex(c => c.localName.toLowerCase() === 'mtable')

  if (tableIndex !== -1) {
    const tableChild = children[tableIndex]
    let openFence: string | null = null
    let closeFence: string | null = null
    let openIndex = -1
    let closeIndex = -1

    if (tableIndex > 0) {
      const prev = children[tableIndex - 1]
      const text = prev.textContent?.trim() || ''
      if (prev.localName.toLowerCase() === 'mo' && ['(', '[', '{', '|', '‖'].includes(text)) {
        openFence = text
        openIndex = tableIndex - 1
      }
    }

    if (tableIndex < children.length - 1) {
      const next = children[tableIndex + 1]
      const text = next.textContent?.trim() || ''
      if (next.localName.toLowerCase() === 'mo' && [')', ']', '}', '|', '‖'].includes(text)) {
        closeFence = text
        closeIndex = tableIndex + 1
      }
    }

    const env = determineMatrixEnvironment(openFence, closeFence)
    const matrixLatex = tableToMatrixLatex(tableChild, env)

    const beforeParts: string[] = []
    const afterParts: string[] = []

    for (let i = 0; i < children.length; i++) {
      if (i === openIndex || i === tableIndex || i === closeIndex) continue
      if (i < tableIndex) {
        beforeParts.push(mathNodeToLatex(children[i]))
      } else {
        afterParts.push(mathNodeToLatex(children[i]))
      }
    }

    return `${beforeParts.join('')}${matrixLatex}${afterParts.join('')}`
  }

  return mathChildrenToLatex(node)
}

function mathNodeToLatex(node: Element): string {
  const tag = node.localName.toLowerCase()

  if (tag === 'semantics') {
    const annotation = node.querySelector('annotation[encoding*="tex"]') || node.querySelector('annotation')
    const text = annotation?.textContent?.trim()
    if (text && !text.includes('<math') && !text.includes('<?xml')) return text
    const presentation = Array.from(node.children).find(child => child.localName !== 'annotation' && child.localName !== 'annotation-xml')
    return presentation ? mathNodeToLatex(presentation) : ''
  }

  if (tag === 'annotation' || tag === 'annotation-xml') return ''

  if (tag === 'mi') {
    const val = node.textContent?.trim() || ''
    return greekLetters[val] ?? val
  }

  if (tag === 'mn') {
    return (node.textContent || '').replace(/[−–—]/g, '-')
  }

  if (tag === 'mtext') {
    const text = node.textContent || ''
    return /^[a-zA-Z0-9\s.,=+\-*/()]+$/.test(text) ? text : `\\text{${text}}`
  }

  if (tag === 'mo') {
    const val = node.textContent?.trim() || ''
    return mathOperators[val] ?? (val === '−' || val === '–' || val === '—' ? '-' : val)
  }

  if (tag === 'mfrac') {
    const [num, den] = Array.from(node.children)
    return num && den ? `\\frac{${mathNodeToLatex(num)}}{${mathNodeToLatex(den)}}` : ''
  }

  if (tag === 'msqrt') return `\\sqrt{${mathChildrenToLatex(node)}}`

  if (tag === 'mroot') {
    const [radicand, index] = Array.from(node.children)
    return radicand && index ? `\\sqrt[${mathNodeToLatex(index)}]{${mathNodeToLatex(radicand)}}` : ''
  }

  if (tag === 'msup' || tag === 'msub' || tag === 'msubsup') {
    const children = Array.from(node.children)
    if (tag === 'msup' && children.length >= 2) return `${mathNodeToLatex(children[0])}^{${mathNodeToLatex(children[1])}}`
    if (tag === 'msub' && children.length >= 2) return `${mathNodeToLatex(children[0])}_{${mathNodeToLatex(children[1])}}`
    if (children.length >= 3) return `${mathNodeToLatex(children[0])}_{${mathNodeToLatex(children[1])}}^{${mathNodeToLatex(children[2])}}`
  }

  if (tag === 'mtable') {
    return tableToMatrixLatex(node, 'pmatrix')
  }

  if (tag === 'mfenced') {
    const open = node.getAttribute('open') ?? '('
    const close = node.getAttribute('close') ?? ')'
    const tableChild = Array.from(node.children).find(c => c.localName.toLowerCase() === 'mtable')
    if (tableChild) {
      const env = determineMatrixEnvironment(open, close)
      return tableToMatrixLatex(tableChild, env)
    }
    const inner = mathChildrenToLatex(node)
    const env = determineMatrixEnvironment(open, close)
    return `\\left${open}${inner}\\right${close}`
  }

  if (tag === 'mrow') {
    return mrowToLatex(node)
  }

  if (tag === 'mstyle' || tag === 'mpadded' || tag === 'mphantom') {
    return mathChildrenToLatex(node)
  }

  return mathChildrenToLatex(node)
}

function normalizeLatex(value: string): string {
  return value.trim()
    .replace(/^\s*(?:\$\$?|\\\(|\\\[)\s*/, '')
    .replace(/\s*(?:\$\$?|\\\)|\\\])\s*$/, '')
}

function mathChildrenToLatex(node: Element): string {
  return Array.from(node.childNodes)
    .map(child => child.nodeType === Node.ELEMENT_NODE
      ? mathNodeToLatex(child as Element)
      : (child.textContent || '').replace(/[−–—]/g, '-'))
    .join('')
}

function isMatrixCell(str: string): boolean {
  const trimmed = str.trim()
  if (!trimmed) return false
  return /^[+\-−]?(?:\d+(?:\.\d+)?|[a-zA-Z](?:[_^][a-zA-Z0-9]+)?)(?:\/[+\-−]?(?:\d+|[a-zA-Z]))?$/.test(trimmed)
}

function parseCells(str: string): string[] {
  return str.trim().split(/\s*,\s*|\s+/).filter(Boolean)
}

/**
 * Reconstructs matrix expressions from plain text or copy-paste artifacts.
 * Handles:
 * 1. Disconnected matrix rows from Chromium layout extraction:
 *    "3   −2\n\nIf A + I = (1   −1), then..." -> "If A + I = \(\begin{pmatrix}3 & -2 \\ 1 & -1\end{pmatrix}\)..."
 * 2. Bracketed semicolon matrix notation:
 *    "If A + I = [3 −2; 1 −1], then..." -> "If A + I = \(\begin{pmatrix}3 & -2 \\ 1 & -1\end{pmatrix}\)..."
 * 3. Double pipe or pipe determinant notation:
 *    "|3 -2; 1 -1|" -> "\(\begin{vmatrix}3 & -2 \\ 1 & -1\end{vmatrix}\)"
 */
export function reconstructDisconnectedMatrices(text: string): string {
  if (!text) return ''

  // 1. First normalize inline bracketed / semicolon matrix notation like [3 -2; 1 -1] or (3 -2; 1 -1)
  let normalized = text.replace(
    /([(\[{\|])\s*([^()[\]{}|;]+(?:\s*;\s*[^()[\]{}|;]+)+)\s*([)\]}|])/g,
    (match, openBracket, matrixContent: string, closeBracket) => {
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

  // 2. Normalize vertically separated matrix lines (Chromium clipboard artifact)
  const lines = normalized.split(/\r?\n/)
  const resultLines: string[] = []
  let pendingRows: string[][] = []

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
      // Pattern: "... = (1      −1)..." or "... = [1      −1]..."
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

      // Flush pending rows if match wasn't found
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

export function convertAccessibleMatrix(value: string): string {
  const reconstructed = reconstructDisconnectedMatrices(value)
  return reconstructed.replace(/\[\s*([+\-−\d.,\s;]+?)\s*\]/g, (match, matrixText: string) => {
    const rows = matrixText.split(/\s*;\s*|\r?\n/)
      .map((row: string) => row.trim().split(/\s*,\s*|\s+/).filter(Boolean))
    if (rows.length < 2 || rows.some((row: string[]) => row.length !== rows[0].length || row.length < 1)) return match
    return `\\begin{pmatrix}${rows.map((row: string[]) => row.map(c => c.replace(/[−–—]/g, '-')).join(' & ')).join(' \\\\ ')}\\end{pmatrix}`
  })
}

function accessibleLabel(element: Element, document: Document): string {
  const labelledBy = element.getAttribute('aria-labelledby')
    ?.split(/\s+/)
    .map(id => document.getElementById(id)?.textContent || '')
    .join(' ')
    .trim()
  return element.getAttribute('aria-label')
    || labelledBy
    || element.querySelector('title, desc')?.textContent
    || element.textContent
    || ''
}

function mathWrapper(element: Element): Element {
  let wrapper = element.closest('.katex, .MathJax, mjx-container')
  if (!wrapper) return element

  let parent = wrapper.parentElement
  while (parent) {
    const ancestor = parent.closest('.katex, .MathJax, mjx-container')
    if (!ancestor) break
    wrapper = ancestor
    parent = wrapper.parentElement
  }
  return wrapper
}

function decodeMjxChar(className: string): string {
  const match = className.match(/\bmjx-c([0-9a-fA-F]+)\b/)
  if (!match) return ''
  try {
    const code = parseInt(match[1], 16)
    if (Number.isFinite(code) && code > 0) {
      const char = String.fromCodePoint(code)
      return char === '−' || char === '–' || char === '—' ? '-' : char
    }
  } catch {
    // ignore
  }
  return ''
}

function extractMjxCellText(cell: Element): string {
  const chars = Array.from(cell.querySelectorAll('[class*="mjx-c"]'))
    .map(c => {
      const decoded = decodeMjxChar(c.className)
      return decoded || c.textContent?.trim() || ''
    })
    .filter(Boolean)

  if (chars.length > 0) return chars.join('')
  return (cell.textContent || '').trim().replace(/[−–—]/g, '-')
}

function ommlName(element: Element): string {
  return element.localName.split(':').at(-1)?.toLowerCase() || ''
}

function ommlChild(element: Element, name: string): Element | null {
  return Array.from(element.children).find(child => ommlName(child) === name.toLowerCase()) || null
}

function ommlAttribute(element: Element | null, name: string): string {
  if (!element) return ''
  return Array.from(element.attributes).find(attribute => attribute.localName.toLowerCase() === name.toLowerCase())?.value || ''
}

function ommlToLatex(element: Element): string {
  const name = ommlName(element)
  const children = Array.from(element.children)
  const child = (childName: string) => {
    const found = ommlChild(element, childName)
    return found ? ommlToLatex(found) : ''
  }

  if (name === 't' || name === 'r') {
    return children.map(ommlToLatex).join('') || element.textContent || ''
  }
  if (name === 'f') return `\\frac{${child('num')}}{${child('den')}}`
  if (name === 'ssup') return `${child('e')}^{${child('sup')}}`
  if (name === 'ssub') return `${child('e')}_{${child('sub')}}`
  if (name === 'ssubsup') return `${child('e')}_{${child('sub')}}^{${child('sup')}}`
  if (name === 'rad') {
    const degree = child('deg')
    const radicand = child('e')
    return degree ? `\\sqrt[${degree}]{${radicand}}` : `\\sqrt{${radicand}}`
  }
  if (name === 'd') {
    const properties = ommlChild(element, 'dpr')
    const open = ommlAttribute(properties ? ommlChild(properties, 'begchr') : null, 'val') || '('
    const close = ommlAttribute(properties ? ommlChild(properties, 'endchr') : null, 'val') || ')'
    return `\\left${open}${child('e')}\\right${close}`
  }
  if (name === 'func') return `${child('fname')}${child('e')}`
  if (name === 'nary') {
    const properties = ommlChild(element, 'narypr')
    const operator = ommlAttribute(properties ? ommlChild(properties, 'chr') : null, 'val')
    const base = operator === '∫' ? '\\int' : operator === '∏' ? '\\prod' : '\\sum'
    const lower = child('sub')
    const upper = child('sup')
    return `${base}${lower ? `_{${lower}}` : ''}${upper ? `^{${upper}}` : ''}${child('e')}`
  }
  if (name === 'limlow') return `${child('e')}_{${child('lim')}}`
  if (name === 'limupp') return `${child('e')}^{${child('lim')}}`

  return children.map(ommlToLatex).join('') || (children.length ? '' : element.textContent || '')
}

function extractOfficeMath(document: Document): boolean {
  const expressions = Array.from(document.querySelectorAll('*'))
    .filter(element => ommlName(element) === 'omath')
  if (!expressions.length) return false

  expressions.forEach(expression => {
    const latex = ommlToLatex(expression).trim()
    expression.replaceWith(document.createTextNode(latex ? `\\(${latex}\\)` : ''))
  })
  return true
}

function extractSupportedMath(document: Document): { found: boolean; svgWithoutText: boolean } {
  let found = extractOfficeMath(document)
  let svgWithoutText = false

  // 1. Script math tags
  document.querySelectorAll('script[type^="math/tex"]').forEach(script => {
    found = true
    const latex = script.textContent?.trim() || ''
    script.replaceWith(document.createTextNode(latex ? `\\(${latex}\\)` : ''))
  })

  // 2. Data attributes
  document.querySelectorAll('[data-latex], [data-tex]').forEach(element => {
    const latex = element.getAttribute('data-latex') || element.getAttribute('data-tex') || ''
    if (!latex.trim()) return
    found = true
    element.replaceWith(document.createTextNode(`\\(${latex.trim()}\\)`))
  })

  // 3. KaTeX containers
  document.querySelectorAll('.katex').forEach(katexEl => {
    if (!katexEl.isConnected || katexEl.parentElement?.closest('.katex')) return
    const annotation = katexEl.querySelector('annotation[encoding*="tex"]')
    if (annotation?.textContent?.trim()) {
      found = true
      katexEl.replaceWith(document.createTextNode(`\\(${annotation.textContent.trim()}\\)`))
      return
    }
    const math = katexEl.querySelector('math')
    if (math) {
      found = true
      const latex = normalizeLatex(mathNodeToLatex(math))
      if (latex) {
        katexEl.replaceWith(document.createTextNode(`\\(${latex}\\)`))
        return
      }
    }
    // HTML mtable fallback inside KaTeX
    const mtable = katexEl.querySelector('.mtable')
    if (mtable) {
      const colAligns = Array.from(mtable.querySelectorAll('.col-align-c, .col-align-l, .col-align-r'))
      if (colAligns.length >= 2) {
        const cols = colAligns.map(col => {
          return Array.from(col.querySelectorAll('.vlist-t .vlist > span'))
            .filter(s => s.querySelector('.mord, .mbin, .mrel, .minner'))
            .map(s => (s.textContent || '').trim().replace(/[−–—]/g, '-'))
            .filter(Boolean)
        }).filter(c => c.length > 0)

        if (cols.length >= 2 && cols.every(c => c.length === cols[0].length)) {
          found = true
          const numRows = cols[0].length
          const rows: string[][] = []
          for (let r = 0; r < numRows; r++) {
            rows.push(cols.map(c => c[r]))
          }
          const open = katexEl.querySelector('.mopen')?.textContent?.trim()
          const env = open === '[' ? 'bmatrix' : open === '|' ? 'vmatrix' : 'pmatrix'
          const latexRows = rows.map(r => r.join(' & ')).join(' \\\\ ')
          katexEl.replaceWith(document.createTextNode(`\\(\\begin{${env}}${latexRows}\\end{${env}}\\)`))
          return
        }
      }
    }
  })

  // 4. MathJax containers
  document.querySelectorAll('mjx-container').forEach(container => {
    if (!container.isConnected) return
    found = true

    const math = container.querySelector('math')
    if (math) {
      const latex = normalizeLatex(mathNodeToLatex(math))
      if (latex) {
        container.replaceWith(document.createTextNode(`\\(${latex}\\)`))
        return
      }
    }

    const label = container.getAttribute('aria-label') || container.getAttribute('title') || ''
    if (label && /matrix|\[\s*[-+\d]|\\|\^|_/i.test(label)) {
      const converted = convertAccessibleMatrix(normalizeLatex(label))
      if (converted) {
        container.replaceWith(document.createTextNode(`\\(${converted}\\)`))
        return
      }
    }

    const mjxTable = container.querySelector('mjx-table, .mjx-mtable')
    if (mjxTable) {
      const rows = Array.from(mjxTable.querySelectorAll('mjx-row, .mjx-mtr'))
        .map(row => Array.from(row.querySelectorAll('mjx-cell, .mjx-mtd'))
          .map(cell => extractMjxCellText(cell))
          .filter(c => c.length > 0))
        .filter(r => r.length > 0)

      if (rows.length >= 2 && rows.every(r => r.length === rows[0].length)) {
        const openMo = container.querySelector('mjx-mo:first-child, .mjx-s4:first-child')?.textContent?.trim()
        const env = openMo === '[' ? 'bmatrix' : openMo === '|' ? 'vmatrix' : 'pmatrix'
        const latexRows = rows.map(r => r.map(c => c.replace(/[−–—]/g, '-')).join(' & ')).join(' \\\\ ')
        container.replaceWith(document.createTextNode(`\\(\\begin{${env}}${latexRows}\\end{${env}}\\)`))
        return
      }
    }
  })

  // 5. Standalone MathML
  document.querySelectorAll('math').forEach(math => {
    if (!math.isConnected) return
    if (math.parentElement?.closest('math')) return
    found = true
    const latex = normalizeLatex(mathNodeToLatex(math))
    const wrapper = mathWrapper(math)
    if (latex) wrapper.replaceWith(document.createTextNode(`\\(${latex}\\)`))
    else wrapper.replaceWith(document.createTextNode(math.textContent || ''))
  })

  // 6. Accessible math elements
  document.querySelectorAll('[role="math"][aria-label], [role="math"][aria-labelledby]').forEach(element => {
    if (!element.isConnected) return
    if (element.matches('svg') || element.querySelector('math, svg')) return
    const label = normalizeLatex(accessibleLabel(element, document))
    if (!label) return
    found = true
    const wrapper = mathWrapper(element)
    wrapper.replaceWith(document.createTextNode(`\\(${convertAccessibleMatrix(label)}\\)`))
  })

  // 7. SVG Math elements
  document.querySelectorAll('svg').forEach(svg => {
    if (!svg.isConnected) return
    const label = accessibleLabel(svg, document).trim()
    const isMathSvg = Boolean(
      svg.matches('[role="math"]')
      || svg.closest('mjx-container, .MathJax, [data-math], [role="math"]')
      || svg.querySelector('[data-mml-node]')
      || /[=^_√∑∫]|\b(?:matrix|equation|expression)\b|\[\s*[+-]?\d[^]]*;/i.test(label),
    )
    if (!isMathSvg) return
    found = true
    const wrapper = mathWrapper(svg)
    if (label.trim()) {
      wrapper.replaceWith(document.createTextNode(`\\(${convertAccessibleMatrix(normalizeLatex(label))}\\)`))
    } else {
      wrapper.remove()
      svgWithoutText = true
    }
  })

  // 8. HTML Matrix Tables
  extractHtmlMatrixTables(document)

  return { found, svgWithoutText }
}

function extractHtmlMatrixTables(document: Document): void {
  document.querySelectorAll('table').forEach(table => {
    const rows = Array.from(table.querySelectorAll('tr'))
      .filter(row => row.closest('table') === table)
      .map(row => Array.from(row.children)
        .filter(cell => cell.matches('td, th'))
        .map(cell => cell.textContent?.replace(/\s+/g, ' ').trim() || ''))
      .filter(row => row.length > 0)

    if (rows.length < 2 || rows.some(row => row.length !== rows[0].length || row.length < 1)) return
    if (rows.flat().some(cell => !/^[+\-−]?(?:\d+(?:\.\d+)?|[A-Za-z](?:[_^][A-Za-z0-9]+)?)(?:\s*[+\-−*/]\s*[+\-−]?(?:\d+(?:\.\d+)?|[A-Za-z](?:[_^][A-Za-z0-9]+)?))*$/.test(cell))) return

    const open = table.getAttribute('data-open') || table.getAttribute('data-delimiter-open')
    const close = table.getAttribute('data-close') || table.getAttribute('data-delimiter-close')
    const environment = open === '[' && close === ']'
      ? 'bmatrix'
      : open === '|' && close === '|'
        ? 'vmatrix'
        : 'pmatrix'
    const latexRows = rows.map(row => row.map(cell => cell.replace(/[−–—]/g, '-')).join(' & ')).join(' \\\\ ')
    table.replaceWith(document.createTextNode(`\\(\\begin{${environment}}${latexRows}\\end{${environment}}\\)`))
  })
}

/**
 * Ensures bare matrix environments like \begin{pmatrix} ... \end{pmatrix}
 * are wrapped in inline math delimiters \( ... \) so KaTeX can render them inline.
 */
export function ensureMathDelimiters(content: string): string {
  if (!content) return ''
  // If already inside \( \), \[ \], $ $, or $$ $$, do not re-wrap
  return content.replace(
    /(?:(\\begin\{(?:pmatrix|bmatrix|vmatrix|Vmatrix|matrix|Bmatrix)\}[\s\S]*?\\end\{(?:pmatrix|bmatrix|vmatrix|Vmatrix|matrix|Bmatrix)\}))/g,
    (match, env: string, offset: number, full: string) => {
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

const bareLatexPatterns = [
  /\\(?:d?frac|tfrac)\s*\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}\s*\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g,
  /\\sqrt(?:\[[^\]]+\])?\s*\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g,
  /\\(?:sin|cos|tan|cot|sec|csc|log|ln)\s*(?:\^\s*(?:\{[^{}]*\}|[A-Za-z0-9]))?\s*(?:\\left\s*[(\[][\s\S]*?\\right\s*[)\]]|\([^()\n]*\)|\{[^{}]*\}|[A-Za-z0-9])/g,
  /\\left\s*[(\[{|.][\s\S]*?\\right\s*[)\]}|.]/g,
  /\\begin\{(?:pmatrix|bmatrix|vmatrix|Vmatrix|matrix|Bmatrix|cases|aligned)\}[\s\S]*?\\end\{(?:pmatrix|bmatrix|vmatrix|matrix|Bmatrix|cases|aligned)\}/g,
  /[A-Za-z0-9]\s*[\^_]\s*(?:\{(?:[^{}]|\{[^{}]*\})*\}|[A-Za-z0-9]+)/g,
]

function isInsideMathDelimiters(value: string, offset: number): boolean {
  const prefix = value.slice(0, offset)
  const inlineOpen = prefix.lastIndexOf('\\(')
  const inlineClose = prefix.lastIndexOf('\\)')
  const displayOpen = prefix.lastIndexOf('\\[')
  const displayClose = prefix.lastIndexOf('\\]')
  const dollarCount = (prefix.match(/\$\$/g) || []).length
  const singleDollarCount = (prefix.match(/(?<!\$)\$(?!\$)/g) || []).length
  return inlineOpen > inlineClose
    || displayOpen > displayClose
    || dollarCount % 2 === 1
    || singleDollarCount % 2 === 1
}

function wrapBareLatexInText(value: string): string {
  const ranges: Array<{ start: number; end: number }> = []
  for (const pattern of bareLatexPatterns) {
    pattern.lastIndex = 0
    for (const match of value.matchAll(pattern)) {
      const start = match.index ?? 0
      if (isInsideMathDelimiters(value, start)) continue
      ranges.push({ start, end: start + match[0].length })
    }
  }

  ranges.sort((left, right) => left.start - right.start || right.end - left.end)
  const selected: Array<{ start: number; end: number }> = []
  for (const range of ranges) {
    const previous = selected[selected.length - 1]
    if (previous && range.start < previous.end) continue
    selected.push(range)
  }

  return selected.reverse().reduce(
    (result, range) => `${result.slice(0, range.start)}\\(${result.slice(range.start, range.end)}\\)${result.slice(range.end)}`,
    value,
  )
}

export function wrapBareLatexMath(root: ParentNode): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement?.closest('code, pre, .katex, .rich-question-equation')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT
    },
  })
  const nodes: Text[] = []
  let current: Node | null
  while ((current = walker.nextNode())) {
    if (current.nodeValue) nodes.push(current as Text)
  }
  nodes.forEach(node => {
    node.data = wrapBareLatexInText(node.data)
  })
}

export function sanitizeQuestionContent(content: string): string {
  let normalized = normalizeEscapedQuestionContent(content)
  normalized = reconstructDisconnectedMatrices(normalized)
  normalized = ensureMathDelimiters(normalized)

  if (/<\/?[a-z][^>]*>/i.test(normalized) || /role\s*=\s*["']?presentation|--tw-|box-sizing\s*:/i.test(normalized)) {
    const parsed = new DOMParser().parseFromString(normalized, 'text/html')
    parsed.querySelectorAll(
      'style, script, noscript, iframe, object, embed, nav, header, footer, aside, button, form, input, select, textarea, [role="navigation"], .advertisement, .ad-container',
    ).forEach(element => element.remove())
    normalized = parsed.body.innerHTML
  }

  const sanitized = DOMPurify.sanitize(normalized, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: allowedAttributes,
    ALLOWED_URI_REGEXP: /^(?:(?:https?):|\/)/i,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'svg'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick'],
    KEEP_CONTENT: true,
  })

  if (!/role\s*=\s*["']?presentation|--tw-|box-sizing\s*:/i.test(sanitized)) {
    return ensureMathDelimiters(sanitized)
  }

  const template = document.createElement('template')
  template.innerHTML = sanitized
  removeLeakedPresentationText(template.content)
  return ensureMathDelimiters(template.innerHTML)
}

export function preparePastedQuestionContent(html: string, text: string): string {
  return preparePastedQuestion(html, text).content
}

function extractClipboardTextFromHtml(document: Document): string {
  const blockTags = new Set(['address', 'article', 'blockquote', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'p', 'pre', 'tr'])
  const visit = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
    const content = Array.from(node.childNodes).map(visit).join('')
    if (node.nodeType === Node.ELEMENT_NODE && blockTags.has((node as Element).localName.toLowerCase())) {
      return `${content}\n`
    }
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).localName.toLowerCase() === 'br') {
      return '\n'
    }
    return content
  }

  return visit(document.body).replace(/\n{3,}/g, '\n\n').trim()
}

function normalizeFragmentedPasteText(text: string): { text: string; recovered: boolean } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const normalized: string[] = []
  let recovered = false

  for (let index = 0; index < lines.length;) {
    if (!lines[index].trim() || lines[index].trim().length > 16) {
      normalized.push(lines[index].trim())
      index += 1
      continue
    }

    const fragments: string[] = []
    let cursor = index
    let blankCount = 0
    while (cursor < lines.length) {
      const line = lines[cursor].trim()
      if (!line) {
        if (fragments.length && blankCount === 0 && cursor + 1 < lines.length && lines[cursor + 1].trim().length <= 16) {
          blankCount += 1
          cursor += 1
          continue
        }
        break
      }
      if (line.length > 16) break
      fragments.push(line)
      blankCount = 0
      cursor += 1
    }

    const hasStandaloneOperator = fragments.some(fragment => /^[=+\-*/^_<>≤≥×÷]$/.test(fragment))
    if (fragments.length >= 4 && hasStandaloneOperator) {
      normalized.push(fragments.join(' '))
      recovered = true
      index = cursor
      while (index < lines.length && !lines[index].trim()) index += 1
      continue
    }

    normalized.push(lines[index].trim())
    index += 1
  }

  return { text: normalized.join('\n').replace(/[ \t]+\n/g, '\n').trim(), recovered }
}

function normalizePlainTextMath(text: string): string {
  const superscripts: Record<string, string> = {
    '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
    '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
    '⁺': '+', '⁻': '-', '⁽': '(', '⁾': ')',
  }
  const subscripts: Record<string, string> = {
    '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
    '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
    '₊': '+', '₋': '-', '₍': '(', '₎': ')',
  }
  let normalized = text
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾]+/g, value => `^{${Array.from(value, character => superscripts[character]).join('')}}`)
    .replace(/[₀₁₂₃₄₅₆₇₈₉₊₋₍₎]+/g, value => `_{${Array.from(value, character => subscripts[character]).join('')}}`)

  const equation = /([A-Za-z][A-Za-z0-9'′]*(?:\s*\([^()\n]*\))?)\s*(=|≤|≥|≠|≈)\s*([^\n,;.!?]+?)(?=\s+\b(?:and|then)\b|[,;.!?]|$)/gi
  normalized = normalized.replace(equation, (match, _left: string, _operator: string, right: string) => {
    const hasMathExpression = /[()+\-*/^_{}×÷]/.test(right)
      || /\b(?:sin|cos|tan|cot|sec|csc|log|ln|sqrt)\b/i.test(right)
    if (match.includes('\\(') || match.includes('$$') || !hasMathExpression) return match
    const latex = match
      .replace(/([A-Za-z][A-Za-z0-9'′]*)\s+\(/g, '$1(')
      .replace(/([A-Za-z])(\d+)(?=$|[\s+\-*/),])/g, '$1^{$2}')
      .replace(/\b(sin|cos|tan|cot|sec|csc|log|ln|sqrt)\b/gi, (_fn, name: string) => `\\${name}`)
      .replace(/[×]/g, '\\times ')
      .replace(/[÷]/g, '\\div ')
    return `\\(${latex.trim()}\\)`
  })
  normalized = normalized.replace(
    /(\([^()\n]+\)|[A-Za-z0-9]+)\s*\/\s*(\([^()\n]+\)|[A-Za-z0-9]+)/g,
    (match, numerator: string, denominator: string, offset: number, source: string) => {
      const before = source.slice(0, offset)
      const inMath = before.lastIndexOf('\\(') > before.lastIndexOf('\\)')
        || before.lastIndexOf('\\[') > before.lastIndexOf('\\]')
        || (before.match(/\$\$/g)?.length ?? 0) % 2 === 1
      const fraction = `\\frac{${numerator}}{${denominator}}`
      return inMath ? fraction : `\\(${fraction}\\)`
    },
  )
  return normalized
}

export function preparePastedQuestion(html: string, text: string, imageAvailable = false): PreparedPaste {
  const parsed = html.trim()
    ? new DOMParser().parseFromString(normalizeEscapedQuestionContent(html), 'text/html')
    : null
  const clipboardText = text.trim() || (parsed ? extractClipboardTextFromHtml(parsed) : '')
  const normalizedText = normalizeFragmentedPasteText(clipboardText)
  const reconstructedText = normalizePlainTextMath(reconstructDisconnectedMatrices(normalizedText.text))
  const plainContent = sanitizeQuestionContent(reconstructedText)

  if (!parsed) {
    return {
      content: plainContent,
      warning: hasQuestionContent(plainContent)
        ? ''
        : 'Could not find readable question content in the clipboard.',
    }
  }

  const math = extractSupportedMath(parsed)
  const hasUnparsedVisualMath = math.svgWithoutText
    || (!math.found && /<(?:svg|canvas)\b|class\s*=\s*["'][^"']*(?:fraction|numerator|denominator|mathjax|katex)/i.test(html))
  const visualMathWarning = imageAvailable
    ? 'The copied equation has no editable math markup. Its source image is being attached to preserve the exact layout.'
    : 'The copied equation has no editable math markup. Copy it as MathML/LaTeX or attach its source image to preserve the exact layout.'
  parsed.querySelectorAll(
    'style, script, noscript, iframe, object, embed, nav, header, footer, aside, button, form, input, select, textarea, [role="navigation"], .advertisement, .ad-container',
  ).forEach(element => element.remove())

  const sanitizedHtml = sanitizeQuestionContent(parsed.body.innerHTML)
  const htmlContent = hasQuestionContent(sanitizedHtml)
  const plainTextHasMath = /\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/.test(plainContent)
  const htmlHasMathStructure = /<(?:math|mfrac|msqrt|mroot|msup|msub|msubsup|mfenced|mtable|mtr|mtd|sup|sub)\b|(?:data-latex|data-tex)\s*=|vertical-align\s*:\s*(?:super|sub)/i.test(sanitizedHtml)
  if (normalizedText.recovered && !math.found) {
    return {
      content: plainContent,
      warning: '',
    }
  }
  const htmlHasMatrix = /\\begin\{(?:pmatrix|bmatrix|vmatrix|Vmatrix|matrix|Bmatrix)\}/.test(sanitizedHtml)
  const textHasMatrix = /\\begin\{(?:pmatrix|bmatrix|vmatrix|Vmatrix|matrix|Bmatrix)\}/.test(plainContent)

  // If plain text recovered matrix structure while HTML extraction missed it, prefer plain text
  if (textHasMatrix && !htmlHasMatrix) {
    return {
      content: plainContent,
      warning: '',
    }
  }

  if (hasUnparsedVisualMath && hasQuestionContent(plainContent) && containsMathSignal(plainContent)) {
    return {
      content: plainContent,
      warning: imageAvailable
        ? 'The copied equation has no editable math markup. Plain text is being used for editing, and its source image is being attached as a visual reference.'
        : 'The copied equation has no editable math markup. The plain-text version was used; copy it as MathML/LaTeX or attach its source image to preserve the exact layout.',
    }
  }

  if (!math.found && plainTextHasMath && !htmlHasMathStructure) {
    return { content: plainContent, warning: '' }
  }

  if (htmlContent) {
    return {
      content: sanitizedHtml,
      warning: hasUnparsedVisualMath
        ? visualMathWarning
        : math.svgWithoutText
        ? (imageAvailable
            ? 'The equation was SVG-only; the clipboard image is being attached. Verify the image in the preview.'
            : 'A pasted equation was SVG-only and had no accessible math text. Copy the equation as text/MathML or paste it as an image.')
        : '',
    }
  }

  if (hasQuestionContent(plainContent)) {
    return { content: plainContent, warning: '' }
  }

  return {
    content: sanitizedHtml,
    warning: hasUnparsedVisualMath
      ? visualMathWarning
      : 'Could not extract valid question content from the clipboard. Verify the question before saving.',
  }
}

function containsMathSignal(value: string): boolean {
  return /<math\b|<svg\b|\\(?:begin\{|frac\b|sqrt\b|pmatrix\b|bmatrix\b)|\$\$|[=^_]|[√πΣΔθ]/i.test(value)
}

export function getClipboardMathDiagnostics(clipboard: DataTransfer): Record<string, boolean | string[]> {
  const html = clipboard.getData('text/html')
  const text = clipboard.getData('text/plain')
  return {
    formats: Array.from(clipboard.types),
    hasHtml: Boolean(html),
    hasText: Boolean(text),
    hasImage: Array.from(clipboard.items).some(item => item.type.startsWith('image/')),
    htmlHasMathML: /<math\b/i.test(html),
    htmlHasSvg: /<svg\b/i.test(html),
    htmlHasLatex: /\\(?:begin\{|frac\b|sqrt\b|pmatrix\b)|application\/x-tex/i.test(html),
    textHasMatrixLikeContent: /matrix|\[\s*[-+\d]/i.test(text),
  }
}

export function hasQuestionContent(content: string): boolean {
  if (!content.trim()) return false
  const document = new DOMParser().parseFromString(content, 'text/html')
  return Boolean(document.body.textContent?.trim() || document.body.querySelector('img, math'))
}

export function isRichQuestionContent(content: string): boolean {
  const normalized = normalizeEscapedQuestionContent(content)
  return /<\/?[a-z][\s\S]*?>/i.test(normalized)
    || /\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/.test(normalized)
    || /\\begin\{(?:pmatrix|bmatrix|vmatrix|Vmatrix|matrix|Bmatrix|aligned|align|gather)\}/.test(normalized)
    || /\\(?:d?frac|tfrac|sqrt|sin|cos|tan|cot|sec|csc|log|ln|left|right|begin)\b/.test(normalized)
    || /[A-Za-z0-9]\s*[\^_]\s*\{/.test(normalized)
}
