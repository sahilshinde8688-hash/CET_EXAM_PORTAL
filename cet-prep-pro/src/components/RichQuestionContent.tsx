import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import katex from 'katex'
import '../lib/katexExtensions'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import { renderMathWithKaTeX } from '../lib/mathDisplay'
import {
  ensureMathDelimiters,
  reconstructDisconnectedMatrices,
  renderDelimitedMath,
  sanitizeQuestionContent,
  wrapBareLatexMath,
} from '../lib/questionContent'
import './rich-question-editor.css'

interface RichQuestionContentProps {
  content: string
  className?: string
}

interface LegacyMatrixGroup {
  start: number
  end: number
  value: string
}

function decodeMathEntities(value: string): string {
  const decoder = document.createElement('textarea')
  let decoded = value
  for (let pass = 0; pass < 3; pass += 1) {
    decoder.innerHTML = decoded
    if (decoder.value === decoded) break
    decoded = decoder.value
  }
  return decoded
}

function decodeMarkdownMathEntities(markdown: string): string {
  return markdown.replace(
    /\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g,
    expression => decodeMathEntities(expression),
  )
}

function findDisplayMathDelimiter(line: string, start: number): number {
  for (let index = start; index < line.length; index += 1) {
    if (line[index] === '`') {
      const run = line.slice(index).match(/^`+/)?.[0]
      if (run) {
        const close = line.indexOf(run, index + run.length)
        if (close !== -1) {
          index = close + run.length - 1
          continue
        }
      }
    }
    if (line.startsWith('$$', index)) return index
  }
  return -1
}

function normalizeDisplayMathBlocks(markdown: string): string {
  const output: string[] = []
  let fence: { marker: '`' | '~'; length: number } | null = null
  let displayMath: string[] | null = null

  for (const line of markdown.split(/\r?\n/)) {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (!displayMath && fenceMatch) {
      const marker = fenceMatch[1][0] as '`' | '~'
      if (!fence) {
        fence = { marker, length: fenceMatch[1].length }
      } else if (marker === fence.marker && fenceMatch[1].length >= fence.length && /^\s*$/.test(line.slice(fenceMatch[0].length))) {
        fence = null
      }
      output.push(line)
      continue
    }
    if (fence || (!displayMath && /^(?: {4}|\t)/.test(line))) {
      output.push(line)
      continue
    }

    let remaining = line
    let plainText = ''
    while (true) {
      const delimiter = findDisplayMathDelimiter(remaining, 0)
      if (delimiter === -1) {
        if (displayMath) displayMath.push(remaining)
        else plainText += remaining
        break
      }

      if (displayMath) {
        displayMath.push(remaining.slice(0, delimiter))
        output.push('')
        output.push(`$$\n${displayMath.join('\n')}\n$$`)
        output.push('')
        displayMath = null
      } else {
        plainText += remaining.slice(0, delimiter)
        if (plainText) output.push(plainText)
        plainText = ''
        displayMath = []
      }
      remaining = remaining.slice(delimiter + 2)
      if (!remaining) break
    }
    if (plainText) output.push(plainText)
  }

  if (displayMath) output.push(`$$${displayMath.join('\n')}`)
  return output.join('\n')
}

function matrixLatex(rows: string[][]): string {
  return `\\begin{pmatrix}${rows.map(row => row.join(' & ')).join(' \\\\ ')}\\end{pmatrix}`
}

function getLegacyMatrixGroups(line: string): Array<LegacyMatrixGroup & { latex?: string }> {
  const delimiters = [
    /\|{3}\s*([^|\r\n]+?)\s*\|{3}/g,
    /\|{2}\s*([^|\r\n]+?)\s*\|{2}/g,
    /\u2016\s*([^\u2016\r\n]+?)\s*\u2016/g,
    /\u2225\s*([^\u2225\r\n]+?)\s*\u2225/g,
  ]
  const groups = delimiters
    .flatMap(pattern => Array.from(line.matchAll(pattern), match => ({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      value: match[1].trim(),
    })))
    .sort((left, right) => left.start - right.start)
  const equalsIndex = line.indexOf('=')
  const vectorSize = equalsIndex < 0
    ? 0
    : groups
      .filter(group => group.end <= equalsIndex && /^[A-Za-z]{2,6}$/.test(group.value))
      .at(-1)?.value.length ?? 0

  return groups.map(group => {
    const value = group.value
    if (/^[A-Za-z]{2,6}$/.test(value) && groups.length > 1 && equalsIndex >= group.end) {
      return { ...group, latex: matrixLatex(Array.from(value, cell => [cell])) }
    }

    if (/^\d+$/.test(value)) {
      const dimension = Math.sqrt(value.length)
      if (Number.isInteger(dimension)) {
        const cells = Array.from(value)
        return {
          ...group,
          latex: matrixLatex(Array.from({ length: dimension }, (_, row) => cells.slice(row * dimension, (row + 1) * dimension))),
        }
      }

      if (group.start > equalsIndex && vectorSize > 0 && value.length % vectorSize === 0) {
        const cellWidth = value.length / vectorSize
        const cells = Array.from({ length: vectorSize }, (_, index) => value.slice(index * cellWidth, (index + 1) * cellWidth))
        return { ...group, latex: matrixLatex(cells.map(cell => [cell])) }
      }
    }

    const rows = value.split(/\s*;\s*|\r?\n/)
    const cells = rows.map(row => row.split(/\s*,\s*|\s*&\s*|\s{2,}/).map(cell => cell.trim()).filter(Boolean))
    if (cells.length > 1 && cells.every(row => row.length > 0)) {
      return { ...group, latex: matrixLatex(cells) }
    }

    return group
  })
}

function renderLegacyMatrices(container: HTMLDivElement) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      return parent?.closest('code, pre, .katex, .rich-question-matrix')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT
    },
  })
  const textNodes: Text[] = []
  let currentNode: Node | null
  while ((currentNode = walker.nextNode())) {
    if (currentNode.nodeValue) textNodes.push(currentNode as Text)
  }

  const combinedText = textNodes.map(node => node.data).join('')
  const ranges = getLegacyMatrixGroups(combinedText)
    .filter(group => group.latex)
    .map(group => ({ ...group }))

  for (const group of ranges.reverse()) {
    let offset = 0
    let startNode: Text | undefined
    let startOffset = 0
    let endNode: Text | undefined
    let endOffset = 0

    for (const textNode of textNodes) {
      const nodeStart = offset
      const nodeEnd = nodeStart + textNode.data.length
      if (!startNode && group.start >= nodeStart && group.start < nodeEnd) {
        startNode = textNode
        startOffset = group.start - nodeStart
      }
      if (group.end > nodeStart && group.end <= nodeEnd) {
        endNode = textNode
        endOffset = group.end - nodeStart
        break
      }
      offset = nodeEnd
    }
    if (!startNode || !endNode || !group.latex) continue

    const range = document.createRange()
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)
    range.deleteContents()

    const matrix = document.createElement('span')
    matrix.className = 'rich-question-matrix'
    matrix.innerHTML = renderMathWithKaTeX(group.latex)
    range.insertNode(matrix)
  }
}

function renderEquation(latex: string, display: boolean): HTMLElement {
  const equation = document.createElement(display ? 'div' : 'span')
  equation.className = `rich-question-rendered-equation${display ? ' rich-question-rendered-equation-block' : ''}`
  try {
    equation.innerHTML = katex.renderToString(decodeMathEntities(latex), {
      throwOnError: true,
      displayMode: display,
      output: 'htmlAndMathml',
      strict: false,
      trust: false,
    })
  } catch {
    equation.textContent = 'Equation could not be rendered.'
    equation.setAttribute('role', 'img')
    equation.setAttribute('aria-label', 'Equation could not be rendered')
  }
  return equation
}

export default function RichQuestionContent({ content, className = '' }: RichQuestionContentProps) {
  const isHtmlContent = /<\/?[a-z][\s\S]*>/i.test(content)
  const displayHtml = useMemo(() => {
    if (!content || !isHtmlContent) return ''
    const reconstructed = reconstructDisconnectedMatrices(content)
    const withDelimiters = ensureMathDelimiters(reconstructed)
    const sanitized = sanitizeQuestionContent(withDelimiters)
    const container = document.createElement('div')
    container.innerHTML = sanitized
    renderDelimitedMath(container, renderEquation)
    wrapBareLatexMath(container)
    renderLegacyMatrices(container)
    renderDelimitedMath(container, renderEquation)
    return container.innerHTML
  }, [content, isHtmlContent])

  const plainTextMathHtml = useMemo(() => {
    if (!content || isHtmlContent || !/\\\(|\\\[/.test(content)) return ''
    const container = document.createElement('div')
    container.textContent = content
    renderDelimitedMath(container, renderEquation)
    wrapBareLatexMath(container)
    renderDelimitedMath(container, renderEquation)
    return container.innerHTML
  }, [content, isHtmlContent])

  if (!content) return null

  return (
    <div className={`rich-question-content ${className}`.trim()}>
      {isHtmlContent
        ? <div dangerouslySetInnerHTML={{ __html: displayHtml }} />
        : plainTextMathHtml
          ? <div className="rich-question-content-plain" dangerouslySetInnerHTML={{ __html: plainTextMathHtml }} />
        : (
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {normalizeDisplayMathBlocks(decodeMarkdownMathEntities(content))}
          </ReactMarkdown>
        )}
    </div>
  )
}
