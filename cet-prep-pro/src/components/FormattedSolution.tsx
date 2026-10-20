import React from 'react'
import katex from 'katex'
import RichQuestionContent from './RichQuestionContent'
import { isRichQuestionContent, sanitizeQuestionContent } from '../lib/questionContent'
import './formatted-solution.css'

interface FormattedSolutionProps {
  content: string
  className?: string
}

type SolutionBlock =
  | { type: 'heading'; value: string; final?: boolean }
  | { type: 'paragraph'; value: string }
  | { type: 'math'; value: string }
  | { type: 'list'; value: string; marker: string }

const mathOptions = {
  throwOnError: false,
  output: 'htmlAndMathml' as const,
  strict: false,
  trust: false,
}

function renderMath(value: string, displayMode: boolean): string {
  return katex.renderToString(value, { ...mathOptions, displayMode })
}

function renderInlineMath(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const mathPattern = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]+?\$|\\begin\{(?:bmatrix|pmatrix|matrix|vmatrix|Vmatrix|cases)\}[\s\S]*?\\end\{(?:bmatrix|pmatrix|matrix|vmatrix|Vmatrix|cases)\}|\\(?:d?frac|tfrac)\{(?:[^{}]|\{[^{}]*\})*\}\{(?:[^{}]|\{[^{}]*\})*\}|\\sqrt(?:\[[^\]]+\])?\{(?:[^{}]|\{[^{}]*\})*\}|\\(?:times|cdot|neq|approx|leq|geq|pi|alpha|beta|gamma|theta)\b)/g
  let cursor = 0

  for (const match of text.matchAll(mathPattern)) {
    const raw = match[0]
    const index = match.index ?? 0
    if (index > cursor) parts.push(text.slice(cursor, index))

    const displayMode = raw.startsWith('$$') || raw.startsWith('\\[') || raw.startsWith('\\begin{')
    const latex = raw.startsWith('$$') ? raw.slice(2, -2)
      : raw.startsWith('\\[') ? raw.slice(2, -2)
        : raw.startsWith('\\(') ? raw.slice(2, -2)
          : raw.startsWith('$') ? raw.slice(1, -1)
            : raw

    parts.push(
      <span
        key={`math-${index}`}
        className={displayMode ? 'formatted-solution-math-inline-display' : undefined}
        dangerouslySetInnerHTML={{ __html: renderMath(latex.trim(), displayMode) }}
      />
    )
    cursor = index + raw.length
  }

  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

function splitLegacyEquationLines(value: string): string[] {
  const lines: string[] = []
  const equationNumber = /\s*(?:\.{2,}\s*)?\(\d+\)\s*/g
  let start = 0
  let match: RegExpExecArray | null

  while ((match = equationNumber.exec(value)) !== null) {
    const beforeMarker = value.slice(start, match.index).trim()
    if (!beforeMarker.includes('=')) continue
    lines.push(`${beforeMarker} ${match[0].trim()}`.trim())
    start = equationNumber.lastIndex
  }

  const remainder = value.slice(start).trim()
  if (remainder) lines.push(remainder)
  if (lines.length < 2) return [value.trim()]

  return lines.flatMap(line => {
    const chunks: string[] = []
    const repeatedEquationStart = /\s+(?=(?:[A-Za-z][A-Za-z\d]*|[\d]*[A-Za-z][A-Za-z\d]*)\s*(?:=|\\neq\b|\\approx\b|[<>]))/g
    let equationStart = 0
    let boundary: RegExpExecArray | null
    while ((boundary = repeatedEquationStart.exec(line)) !== null) {
      chunks.push(line.slice(equationStart, boundary.index).trim())
      equationStart = repeatedEquationStart.lastIndex
    }
    const tail = line.slice(equationStart).trim()
    if (tail) chunks.push(tail)
    return chunks
  })
}

function splitChainedEquations(value: string): string[] {
  const chunks: string[] = []
  const repeatedEquationStart = /\s+(?=(?:[A-Za-z][A-Za-z\d]*|[\d]*[A-Za-z][A-Za-z\d]*)\s*(?:=|\\neq\b|\\approx\b|[<>]))/g
  let start = 0
  let match: RegExpExecArray | null

  while ((match = repeatedEquationStart.exec(value)) !== null) {
    chunks.push(value.slice(start, match.index).trim())
    start = repeatedEquationStart.lastIndex
  }
  const tail = value.slice(start).trim()
  if (tail) chunks.push(tail)
  return chunks.length > 1 ? chunks : [value.trim()]
}

function normalizeLegacySections(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*Given\s*,\s*/i, 'Given:\n')
    .replace(/\s+(?=Comparing corresponding elements\b)/gi, '\n')
    .replace(/Comparing corresponding elements(?:\s+of\s+the\s+matrices)?[,.:]?\s*/gi, '\nStep 1: Compare corresponding elements\n')
    .replace(/\s+(?=From equation\s*\(\d+\))/gi, '\n')
    .replace(/From equation\s*\(\d+\)\s*[,.:]?\s*/gi, '\nStep 2: Solve the equations\n')
    .replace(/\s+Therefore[,.:]?\s*/gi, '\nStep 3: Calculate the required value\n')
    .replace(/\s+Final Answer\s*:\s*/gi, '\nFinal Answer:\n')
}

function normalizePlainTextMatrices(value: string): string {
  return value.replace(/(?<!\\)\[([^\n]+?)(?<!\\)\]/g, (match, content: string) => {
    if (content.includes('[') || content.includes(']')) return match
    const trimmed = content.trim()
    const cells = /\s{2,}/.test(trimmed)
      ? trimmed.split(/\s{2,}/).map(cell => cell.trim())
      : /^[+-]?\d+(?:\s+[+-]?\d+)+$/.test(trimmed)
        ? trimmed.split(/\s+/)
        : []

    if (cells.length < 2 || cells.some(cell => !cell)) return match
    return `\\begin{bmatrix}${cells.join(' & ')}\\end{bmatrix}`
  })
}

function isMathLine(value: string): boolean {
  if (/\$|\\\(|\\\[/.test(value)) return false
  if (/\\(?:frac|sqrt|sum|int|prod|times|cdot|neq|approx|leq|geq|begin)\b/.test(value)) {
    return !/[.!?]\s+[A-Za-z]/.test(value)
  }
  return /(?:=|≠|≈|≤|≥|\\neq|\\approx|\\leq|\\geq|[\^_])/.test(value)
    && !/\b(?:Given|Therefore|Comparing|From|Final|where|because|since)\b/i.test(value)
}

function createBlocks(content: string): SolutionBlock[] {
  const normalized = normalizePlainTextMatrices(normalizeLegacySections(content))
  const sourceLines = normalized.split('\n')
  const blocks: SolutionBlock[] = []
  let displayMath: string[] | null = null

  for (const sourceLine of sourceLines) {
    const trimmed = sourceLine.trim()
    if (displayMath) {
      if (trimmed === '\\]' || trimmed === '$$') {
        blocks.push({ type: 'math', value: displayMath.join('\n') })
        displayMath = null
      } else {
        displayMath.push(sourceLine)
      }
      continue
    }

    if (trimmed === '\\[' || trimmed === '$$') {
      displayMath = []
      continue
    }
    if (!trimmed) continue

    const clean = trimmed.replace(/^#{1,3}\s*/, '').replace(/^\*\*(.+)\*\*:?\s*$/, '$1')
    if (/^(final answer)\s*:?\s*$/i.test(clean)) {
      blocks.push({ type: 'heading', value: 'Final Answer', final: true })
      continue
    }
    if (/^(given)\s*:?\s*$/i.test(clean) || /^step\s+\d+\s*:/i.test(clean)) {
      blocks.push({ type: 'heading', value: clean.replace(/:$/, '') })
      continue
    }

    const bullet = trimmed.match(/^([-*•]|\d+\.)\s+(.+)$/)
    if (bullet) {
      blocks.push({ type: 'list', marker: bullet[1], value: bullet[2] })
      continue
    }

    const numberedLines = splitLegacyEquationLines(trimmed)
    for (const line of numberedLines) {
      for (const equation of splitChainedEquations(line)) {
        if (isMathLine(equation)) {
          blocks.push({ type: 'math', value: equation })
        } else {
          blocks.push({ type: 'paragraph', value: equation })
        }
      }
    }
  }

  if (displayMath) blocks.push({ type: 'math', value: displayMath.join('\n') })
  return blocks
}

function getRichSolutionSections(content: string): Array<{ html: string; final: boolean }> {
  const template = document.createElement('template')
  template.innerHTML = sanitizeQuestionContent(content)
  const sections: Array<{ html: string; final: boolean }> = []
  let sectionHtml = ''
  let finalSection = false

  const flush = () => {
    if (sectionHtml.trim()) sections.push({ html: sectionHtml, final: finalSection })
    sectionHtml = ''
  }

  for (const node of Array.from(template.content.childNodes)) {
    const text = node.textContent?.trim() || ''
    const isHeading = /^(?:given|step\s+\d+|final answer)\s*:?\s*$/i.test(text)
    if (isHeading) {
      flush()
      finalSection = /^final answer/i.test(text)
      if (finalSection) continue
    }

    const container = document.createElement('div')
    container.append(node.cloneNode(true))
    sectionHtml += container.innerHTML
  }
  flush()
  return sections
}

export default function FormattedSolution({ content, className = '' }: FormattedSolutionProps) {
  if (!content?.trim()) return null

  if (isRichQuestionContent(content)) {
    return (
      <div className={`formatted-solution ${className}`.trim()}>
        {getRichSolutionSections(content).map((section, index) => section.final ? (
          <section key={`rich-solution-${index}`} className="formatted-solution-rich-final">
            <h5 className="formatted-solution-final-heading">Final Answer</h5>
            <RichQuestionContent content={section.html} className="formatted-solution-rich-final-content" />
          </section>
        ) : (
          <RichQuestionContent key={`rich-solution-${index}`} content={section.html} />
        ))}
      </div>
    )
  }

  let inFinalAnswer = false
  return (
    <div className={`formatted-solution ${className}`.trim()}>
      {createBlocks(content).map((block, index) => {
        if (block.type === 'heading') {
          inFinalAnswer = block.final === true
          return (
            <h5 key={`heading-${index}`} className={block.final ? 'formatted-solution-final-heading' : 'formatted-solution-heading'}>
              {block.value}
            </h5>
          )
        }

        if (block.type === 'math') {
          return (
            <div key={`math-${index}`} className={`formatted-solution-equation${inFinalAnswer ? ' formatted-solution-final-equation' : ''}`}>
              <div dangerouslySetInnerHTML={{ __html: renderMath(block.value.trim(), true) }} />
            </div>
          )
        }

        if (block.type === 'list') {
          return (
            <div key={`list-${index}`} className="formatted-solution-list-item">
              <span aria-hidden="true">{block.marker}</span>
              <div>{renderInlineMath(block.value)}</div>
            </div>
          )
        }

        const ContentTag = inFinalAnswer ? 'div' : 'p'
        return (
          <ContentTag key={`paragraph-${index}`} className={inFinalAnswer ? 'formatted-solution-final-answer' : undefined}>
            {renderInlineMath(block.value)}
          </ContentTag>
        )
      })}
    </div>
  )
}
