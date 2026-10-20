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

function extractSupportedMath(document: Document): { found: boolean; svgWithoutText: boolean } {
  let found = false
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

export function preparePastedQuestion(html: string, text: string, imageAvailable = false): PreparedPaste {
  const reconstructedText = reconstructDisconnectedMatrices(text)
  const plainContent = sanitizeQuestionContent(reconstructedText)

  if (!html.trim()) {
    return {
      content: plainContent,
      warning: hasQuestionContent(plainContent) ? '' : 'Could not find readable question content in the clipboard.',
    }
  }

  const parsed = new DOMParser().parseFromString(normalizeEscapedQuestionContent(html), 'text/html')
  const math = extractSupportedMath(parsed)
  parsed.querySelectorAll(
    'style, script, noscript, iframe, object, embed, nav, header, footer, aside, button, form, input, select, textarea, [role="navigation"], .advertisement, .ad-container',
  ).forEach(element => element.remove())

  const sanitizedHtml = sanitizeQuestionContent(parsed.body.innerHTML)
  const htmlContent = hasQuestionContent(sanitizedHtml)
  const htmlHasMatrix = /\\begin\{(?:pmatrix|bmatrix|vmatrix|Vmatrix|matrix|Bmatrix)\}/.test(sanitizedHtml)
  const textHasMatrix = /\\begin\{(?:pmatrix|bmatrix|vmatrix|Vmatrix|matrix|Bmatrix)\}/.test(plainContent)

  // If plain text recovered matrix structure while HTML extraction missed it, prefer plain text
  if (textHasMatrix && !htmlHasMatrix) {
    return {
      content: plainContent,
      warning: '',
    }
  }

  if (htmlContent) {
    return {
      content: sanitizedHtml,
      warning: math.svgWithoutText
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
    warning: 'Could not extract valid question content from the clipboard. Verify the question before saving.',
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
}
