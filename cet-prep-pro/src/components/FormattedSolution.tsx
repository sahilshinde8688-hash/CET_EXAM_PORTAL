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

export default function FormattedSolution({ content, className = '' }: FormattedSolutionProps) {
  if (!content) return null

  // Split into lines/blocks
  const lines = content.split('\n')

  return (
    <div className={`formatted-solution-box ${className}`} style={{ fontSize: '14.5px', lineHeight: '1.7', color: '#1e293b' }}>
      {lines.map((line, idx) => {
        const trimmed = line.trim()
        if (!trimmed) {
          return <div key={idx} style={{ height: '8px' }} />
        }

        // Section Headers
        if (trimmed.startsWith('###') || trimmed.startsWith('##')) {
          const title = trimmed.replace(/^#+\s*/, '')
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
              <span>{title}</span>
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
              <div>{renderInlineMath(cleanText)}</div>
            </div>
          )
        }

        // Standard Paragraph
        return (
          <p key={idx} style={{ margin: '4px 0' }}>
            {renderInlineMath(trimmed)}
          </p>
        )
      })}
    </div>
  )
}
