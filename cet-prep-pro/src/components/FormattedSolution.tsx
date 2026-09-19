import React from 'react'
import katex from 'katex'

interface FormattedSolutionProps {
  content: string
  className?: string
}

function renderInlineMath(text: string): React.ReactNode[] {
  // Replace \[ ... \] or $$ ... $$ with display math, and \( ... \) or $ ... $ with inline math
  const parts: React.ReactNode[] = []
  const regex = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^\$\n]+?\$|\\\([^\)]+?\\\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    const raw = match[0]
    let latex = ''
    let displayMode = false

    if (raw.startsWith('$$') && raw.endsWith('$$')) {
      latex = raw.slice(2, -2).trim()
      displayMode = true
    } else if (raw.startsWith('\\[') && raw.endsWith('\\]')) {
      latex = raw.slice(2, -2).trim()
      displayMode = true
    } else if (raw.startsWith('\\(') && raw.endsWith('\\)')) {
      latex = raw.slice(2, -2).trim()
      displayMode = false
    } else if (raw.startsWith('$') && raw.endsWith('$')) {
      latex = raw.slice(1, -1).trim()
      displayMode = false
    }

    try {
      const html = katex.renderToString(latex, {
        throwOnError: false,
        displayMode,
      })
      parts.push(
        <span
          key={`${match.index}-${raw}`}
          dangerouslySetInnerHTML={{ __html: html }}
          style={displayMode ? { display: 'block', margin: '8px 0', overflowX: 'auto' } : {}}
        />
      )
    } catch {
      parts.push(<code key={`${match.index}-${raw}`}>{latex}</code>)
    }

    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}

function renderFormattedText(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const boldRegex = /\*\*(.+?)\*\*/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = boldRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(...renderInlineMath(text.slice(lastIndex, match.index)))
    }
    parts.push(<strong key={`${match.index}-${match[0]}`}>{renderInlineMath(match[1])}</strong>)
    lastIndex = boldRegex.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(...renderInlineMath(text.slice(lastIndex)))
  }

  return parts
}

export default function FormattedSolution({ content, className = '' }: FormattedSolutionProps) {
  if (!content) return null

  // Group multi-line display equations before rendering individual solution lines.
  const sourceLines = content.split('\n')
  const lines: Array<{ type: 'line' | 'displayMath'; value: string }> = []
  let displayMath: string[] | null = null

  sourceLines.forEach(line => {
    const trimmed = line.trim()
    const startsDisplayMath = trimmed === '\\[' || trimmed === '$$'
    const endsDisplayMath = trimmed === '\\]' || trimmed === '$$'

    if (displayMath) {
      if (endsDisplayMath) {
        lines.push({ type: 'displayMath', value: displayMath.join('\n') })
        displayMath = null
      } else {
        displayMath.push(line)
      }
    } else if (startsDisplayMath) {
      displayMath = []
    } else {
      lines.push({ type: 'line', value: line })
    }
  })

  if (displayMath) {
    lines.push({ type: 'displayMath', value: displayMath.join('\n') })
  }

  return (
    <div className={`formatted-solution-box ${className}`} style={{ fontSize: '14.5px', lineHeight: '1.7', color: '#1e293b' }}>
      {lines.map((block, idx) => {
        if (block.type === 'displayMath') {
          try {
            const html = katex.renderToString(block.value.trim(), {
              throwOnError: false,
              displayMode: true,
            })
            return (
              <div
                key={`display-${idx}`}
                style={{ maxWidth: '100%', overflowX: 'auto', margin: '8px 0' }}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            )
          } catch {
            return <pre key={`display-${idx}`} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{block.value}</pre>
          }
        }

        const trimmed = block.value.trim()
        if (!trimmed) {
          return <div key={idx} style={{ height: '8px' }} />
        }

        // Section Headers
        if (trimmed.startsWith('###') || trimmed.startsWith('##')) {
          const title = trimmed.replace(/^#+\s*/, '').replace(/^\*\*(.+)\*\*:?$/, '$1')
          const isTrap = /trap|mistake|incorrect/i.test(title)
          const isTip = /tip|shortcut|speed/i.test(title)
          const isFormula = /formula|concept/i.test(title)
          const isDerivation = /derivation|solution|step/i.test(title)

          let icon = 'auto_awesome'
          let bgColor = '#f1f5f9'
          let textColor = '#0f172a'
          let borderColor = '#cbd5e1'

          if (isTrap) {
            icon = 'warning'
            bgColor = '#fef2f2'
            textColor = '#991b1b'
            borderColor = '#fecaca'
          } else if (isTip) {
            icon = 'bolt'
            bgColor = '#fefce8'
            textColor = '#854d0e'
            borderColor = '#fde68a'
          } else if (isFormula) {
            icon = 'menu_book'
            bgColor = '#eff6ff'
            textColor = '#1e40af'
            borderColor = '#bfdbfe'
          } else if (isDerivation) {
            icon = 'calculate'
            bgColor = '#f0fdf4'
            textColor = '#166534'
            borderColor = '#bbf7d0'
          }

          return (
            <div
              key={idx}
              style={{
                marginTop: idx === 0 ? '0' : '16px',
                marginBottom: '8px',
                padding: '8px 12px',
                borderRadius: '8px',
                background: bgColor,
                border: `1px solid ${borderColor}`,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: 600,
                fontSize: '14px',
                color: textColor,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>{icon}</span>
              <span>{renderFormattedText(title)}</span>
            </div>
          )
        }

        // Numbered or Bullet list
        const isBullet = /^[-*•]\s/.test(trimmed)
        const isNumbered = /^\d+\.\s/.test(trimmed)

        if (isBullet || isNumbered) {
          const cleanText = trimmed.replace(/^[-*•\d+.]\s*/, '')
          return (
            <div key={idx} style={{ display: 'flex', gap: '8px', marginLeft: '12px', marginBottom: '4px' }}>
              <span style={{ color: '#3b82f6', fontWeight: 600 }}>{isNumbered ? trimmed.split(' ')[0] : '•'}</span>
              <div>{renderFormattedText(cleanText)}</div>
            </div>
          )
        }

        // Standard Paragraph
        return (
          <p key={idx} style={{ margin: '4px 0' }}>
            {renderFormattedText(trimmed)}
          </p>
        )
      })}
    </div>
  )
}
