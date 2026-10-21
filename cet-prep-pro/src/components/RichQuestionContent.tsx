import { useMemo } from 'react'
import renderMathInElement from 'katex/contrib/auto-render'
import { renderMathWithKaTeX } from '../lib/mathDisplay'
import {
  ensureMathDelimiters,
  isRichQuestionContent,
  reconstructDisconnectedMatrices,
  sanitizeQuestionContent,
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

export default function RichQuestionContent({ content, className = '' }: RichQuestionContentProps) {
  const displayHtml = useMemo(() => {
    if (!content) return ''
    const reconstructed = reconstructDisconnectedMatrices(content)
    const withDelimiters = ensureMathDelimiters(reconstructed)
    const sanitized = sanitizeQuestionContent(withDelimiters)
    const html = isRichQuestionContent(content) || /<\/?[a-z][\s\S]*>/i.test(sanitized)
      ? sanitized
      : sanitized.split(/\r?\n/).join('<br>')
    const container = document.createElement('div')
    container.innerHTML = html
    renderLegacyMatrices(container)
    renderMathInElement(container, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false },
        { left: '$', right: '$', display: false },
      ],
      throwOnError: false,
      strict: false,
      trust: false,
      ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
    })
    return container.innerHTML
  }, [content])

  if (!content) return null

  return (
    <div
      className={`rich-question-content ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: displayHtml }}
    />
  )
}
