import katex from 'katex'

const greekSymbolMap: Record<string, string> = {
  alpha: '\\alpha',
  beta: '\\beta',
  gamma: '\\gamma',
  delta: '\\Delta',
  theta: '\\theta',
  lambda: '\\lambda',
  mu: '\\mu',
  omega: '\\omega',
  pi: '\\pi',
  sigma: '\\sigma',
  tau: '\\tau',
  phi: '\\phi',
  psi: '\\psi',
  epsilon: '\\epsilon',
}

const normalizePlainText = (value: string = '') => value.replace(/\r?\n/g, ' ')

const hasExplicitLatex = (value: string = '') => /\\(?:frac|sqrt|sum|int|prod|lim|log|ln|sin|cos|tan|sec|csc|cot|alpha|beta|gamma|delta|theta|lambda|mu|omega|pi|sigma|tau|phi|psi|epsilon)\b|\\\(|\\\[|\\begin\{|\\end\{|\$\$/.test(value)

const looksLikeSentence = (value: string = '') => /\b[a-z]{3,}\b/i.test(value) && /\s/.test(value)

const looksLikeFormula = (value: string = '') => {
  const compact = value.replace(/\s+/g, '')
  return compact.length > 0 && /[=<>^_+\-*/\[\]{}()]/.test(compact)
}

const applyGreekMapping = (value: string) => {
  let output = value

  Object.entries(greekSymbolMap).forEach(([word, latex]) => {
    output = output.replace(new RegExp(`\\b${word}\\b`, 'gi'), latex)
  })

  return output
}

const convertMathAliases = (value: string) => {
  let output = value

  output = output.replace(/\b(?:sqrt|√)\s*\(([^()]+)\)/gi, '\\sqrt{$1}')
  output = output.replace(/\bcuberoot\s*\(([^()]+)\)/gi, '\\sqrt[3]{$1}')
  output = output.replace(/\babs\s*\(([^()]+)\)/gi, '\\left|$1\\right|')
  output = output.replace(/\bvec\s*\(([^()]+)\)/gi, '\\vec{$1}')
  output = output.replace(/\bmatrix\s*\(([^()]+)\)/gi, '\\begin{matrix}$1\\end{matrix}')
  output = output.replace(/\bmu\b/gi, '\\mu')
  output = output.replace(/\bpi\b/gi, '\\pi')
  output = output.replace(/\btheta\b/gi, '\\theta')
  output = output.replace(/\balpha\b/gi, '\\alpha')
  output = output.replace(/\bbeta\b/gi, '\\beta')
  output = output.replace(/\bgamma\b/gi, '\\gamma')
  output = output.replace(/\bdelta\b/gi, '\\Delta')
  output = output.replace(/\blambda\b/gi, '\\lambda')
  output = output.replace(/\bomega\b/gi, '\\omega')
  output = output.replace(/\binfinity\b/gi, '\\infty')
  output = output.replace(/\bdegree\b/gi, '^\\circ')
  output = output.replace(/>=/g, '\\ge ')
  output = output.replace(/<=/g, '\\le ')
  output = output.replace(/!=/g, '\\ne ')
  output = output.replace(/\+-/g, '\\pm ')

  output = output.replace(/\(\s*([^()]+?)\s*\)\s*\/\s*\(\s*([^()]+?)\s*\)/g, '\\frac{$1}{$2}')
  output = output.replace(/([A-Za-z0-9^_\-\+]+)\s*\/\s*([A-Za-z0-9^_\-\+]+)/g, '\\frac{$1}{$2}')
  output = output.replace(/(\\pi|\\theta|\\alpha|\\beta|\\gamma|\\lambda|\\mu|\\omega)\s*\/\s*([0-9]+)/g, '\\frac{$1}{$2}')

  return output
}

const formatFallbackText = (value: string = '') => {
  if (!value) return ''

  let formatted = normalizePlainText(value)
  formatted = formatted.replace(/\bpi\b/gi, 'π')
  formatted = formatted.replace(/\btheta\b/gi, 'θ')
  formatted = formatted.replace(/\balpha\b/gi, 'α')
  formatted = formatted.replace(/\bbeta\b/gi, 'β')
  formatted = formatted.replace(/\bgamma\b/gi, 'γ')
  formatted = formatted.replace(/\blambda\b/gi, 'λ')
  formatted = formatted.replace(/\bmu\b/gi, 'μ')
  formatted = formatted.replace(/\bomega\b/gi, 'ω')
  formatted = formatted.replace(/\bdelta\b/gi, 'Δ')
  formatted = formatted.replace(/\binfinity\b/gi, '∞')
  formatted = formatted.replace(/>=/g, '≥')
  formatted = formatted.replace(/<=/g, '≤')
  formatted = formatted.replace(/!=/g, '≠')
  formatted = formatted.replace(/\+-/g, '±')
  formatted = formatted.replace(/\b\d+\s*\/\s*\d+\b/g, match => {
    const [a, b] = match.split('/')
    if (a.trim() === '1' && b.trim() === '2') return '½'
    if (a.trim() === '1' && b.trim() === '4') return '¼'
    return match
  })

  return formatted
}

export function shouldUseKaTeX(value: string = ''): boolean {
  const normalized = normalizePlainText(value).trim()
  if (!normalized) return false

  // Keep prose as prose so a single formula does not make the whole sentence unwrappable.
  if (looksLikeSentence(normalized)) return false
  if (hasExplicitLatex(normalized)) return true
  if (!looksLikeFormula(normalized)) return false

  const compact = normalized.replace(/\s+/g, '')
  return compact.length > 0 && /[=<>^_+\-*/\[\]{}()]/.test(compact)
}

export function renderMathWithKaTeX(value: string = ''): string {
  if (!value) return ''

  const latex = applyGreekMapping(convertMathAliases(value))

  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode: false,
      output: 'htmlAndMathml',
      strict: false,
      trust: false,
    })
  } catch {
    return formatFallbackText(value)
  }
}

export function MathRenderer({ value = '', className = '' }: { value?: string; className?: string }) {
  if (!value) return <span className={className} />

  if (shouldUseKaTeX(value)) {
    return (
      <span
        className={`math-renderer ${className}`.trim()}
        dangerouslySetInnerHTML={{ __html: renderMathWithKaTeX(value) }}
      />
    )
  }

  return <span className={`math-renderer ${className}`.trim()}>{formatFallbackText(value)}</span>
}

export const MathText = MathRenderer

