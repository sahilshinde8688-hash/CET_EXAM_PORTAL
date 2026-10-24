import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type FormEvent, type MouseEvent } from 'react'
import katex from 'katex'
import 'mathlive'
import 'mathlive/fonts.css'
import type { MathfieldElement } from 'mathlive'
import { Bold, Image as ImageIcon, Italic, List, ListOrdered, Sigma, Subscript, Superscript, Underline, X } from 'lucide-react'
import { getClipboardMathDiagnostics, hasQuestionContent, normalizeEscapedQuestionContent, preparePastedQuestion, sanitizeQuestionContent, wrapBareLatexMath } from '../lib/questionContent'
import './rich-question-editor.css'

interface RichQuestionEditorProps {
  value: string
  onChange: (value: string) => void
  onPasteImage?: (file: File) => void | string | Promise<void | string>
  compact?: boolean
  editorLabel?: string
  placeholder?: string
}

type EquationCategory =
  | 'Fractions' | 'Scripts' | 'Radicals' | 'Integrals' | 'Operators'
  | 'Brackets' | 'Functions' | 'Accents' | 'Matrices' | 'Symbols' | 'Templates'

type EquationInputMode = 'visual' | 'latex'

const EQUATION_TEMPLATES: Record<EquationCategory, Array<{ label: string; latex: string }>> = {
  Fractions: [
    { label: 'Fraction', latex: '\\frac{\\placeholder{}}{\\placeholder{}}' },
    { label: 'Inline fraction', latex: '\\tfrac{\\placeholder{}}{\\placeholder{}}' },
    { label: 'Complex fraction', latex: '\\frac{\\frac{a}{b}}{\\frac{c}{d}}' },
  ],
  Scripts: [
    { label: 'Superscript', latex: 'x^{\\placeholder{}}' },
    { label: 'Subscript', latex: 'a_{\\placeholder{}}' },
    { label: 'Sub + superscript', latex: 'x_{\\placeholder{}}^{\\placeholder{}}' },
  ],
  Radicals: [
    { label: 'Square root', latex: '\\sqrt{\\placeholder{}}' },
    { label: 'Cube root', latex: '\\sqrt[3]{\\placeholder{}}' },
    { label: 'Nth root', latex: '\\sqrt[\\placeholder{}]{\\placeholder{}}' },
  ],
  Integrals: [
    { label: 'Integral', latex: '\\int \\placeholder{}\\,dx' },
    { label: 'Definite integral', latex: '\\int_{a}^{b}\\placeholder{}\\,dx' },
    { label: 'Double integral', latex: '\\iint_{D}\\placeholder{}\\,dA' },
    { label: 'Line integral', latex: '\\oint_{C}\\placeholder{}\\,ds' },
  ],
  Operators: [
    { label: 'Summation', latex: '\\sum_{n=1}^{\\infty}\\placeholder{}' },
    { label: 'Product', latex: '\\prod_{i=1}^{n}\\placeholder{}' },
    { label: 'Limit', latex: '\\lim_{x\\to a}\\placeholder{}' },
    { label: 'Derivative', latex: '\\frac{d\\placeholder{}}{dx}' },
  ],
  Brackets: [
    { label: '( )', latex: '\\left(\\placeholder{}\\right)' },
    { label: '[ ]', latex: '\\left[\\placeholder{}\\right]' },
    { label: '{ }', latex: '\\left\\{\\placeholder{}\\right\\}' },
    { label: '| |', latex: '\\left|\\placeholder{}\\right|' },
  ],
  Functions: [
    { label: 'sin', latex: '\\sin\\left(\\placeholder{}\\right)' },
    { label: 'cos', latex: '\\cos\\left(\\placeholder{}\\right)' },
    { label: 'tan', latex: '\\tan\\left(\\placeholder{}\\right)' },
    { label: 'log', latex: '\\log_{\\placeholder{}}\\left(\\placeholder{}\\right)' },
    { label: 'ln', latex: '\\ln\\left(\\placeholder{}\\right)' },
  ],
  Accents: [
    { label: 'Vector', latex: '\\vec{\\placeholder{}}' },
    { label: 'Arrow', latex: '\\overrightarrow{\\placeholder{}}' },
    { label: 'Hat', latex: '\\hat{\\placeholder{}}' },
    { label: 'Bar', latex: '\\overline{\\placeholder{}}' },
    { label: 'Dot', latex: '\\dot{\\placeholder{}}' },
  ],
  Matrices: [
    { label: '2 × 2 matrix', latex: '\\begin{pmatrix}\\placeholder{} & \\placeholder{} \\\\ \\placeholder{} & \\placeholder{}\\end{pmatrix}' },
    { label: '3 × 3 matrix', latex: '\\begin{pmatrix}\\placeholder{} & \\placeholder{} & \\placeholder{} \\\\ \\placeholder{} & \\placeholder{} & \\placeholder{} \\\\ \\placeholder{} & \\placeholder{} & \\placeholder{}\\end{pmatrix}' },
    { label: 'Determinant', latex: '\\begin{vmatrix}\\placeholder{} & \\placeholder{} \\\\ \\placeholder{} & \\placeholder{}\\end{vmatrix}' },
    { label: 'Aligned equations', latex: '\\begin{aligned}\\placeholder{} &= \\placeholder{} \\\\ \\placeholder{} &= \\placeholder{}\\end{aligned}' },
  ],
  Symbols: [
    { label: 'α', latex: '\\alpha ' }, { label: 'β', latex: '\\beta ' },
    { label: 'θ', latex: '\\theta ' }, { label: 'π', latex: '\\pi ' },
    { label: '∞', latex: '\\infty ' }, { label: '±', latex: '\\pm ' },
    { label: '≤', latex: '\\le ' }, { label: '≥', latex: '\\ge ' },
    { label: '≠', latex: '\\ne ' }, { label: '°', latex: '^\\circ ' },
  ],
  Templates: [
    { label: 'Quadratic formula', latex: 'x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}' },
    { label: 'Binomial', latex: '(a+b)^n=\\sum_{k=0}^{n}\\binom{n}{k}a^{n-k}b^k' },
    { label: 'Derivative', latex: '\\frac{dy}{dx}=\\lim_{h\\to0}\\frac{f(x+h)-f(x)}{h}' },
    { label: 'Pythagorean theorem', latex: 'a^2+b^2=c^2' },
  ],
}

const EQUATION_CATEGORIES = Object.keys(EQUATION_TEMPLATES) as EquationCategory[]
const MATH_DELIMITERS = /\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g

function createEquationToken(latex: string, display: boolean): HTMLSpanElement {
  const token = document.createElement('span')
  token.className = `rich-question-equation${display ? ' rich-question-equation-block' : ''}`
  token.contentEditable = 'false'
  token.dataset.latex = latex
  token.dataset.display = display ? 'true' : 'false'
  token.setAttribute('role', 'button')
  token.setAttribute('aria-label', `Edit equation: ${latex}`)
  token.title = 'Click to edit equation'
  try {
    token.innerHTML = katex.renderToString(latex, {
      throwOnError: false,
      displayMode: display,
      output: 'htmlAndMathml',
      strict: false,
      trust: false,
    })
  } catch (error) {
    console.error('Failed to render equation in editor:', error)
    token.textContent = latex
  }
  return token
}

function renderMathTokens(root: ParentNode) {
  wrapBareLatexMath(root)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement?.closest('code, pre, .rich-question-equation')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT
    },
  })
  const nodes: Text[] = []
  let current: Node | null
  while ((current = walker.nextNode())) {
    if (current.nodeValue) nodes.push(current as Text)
  }

  for (const node of nodes) {
    const source = node.data
    MATH_DELIMITERS.lastIndex = 0
    const matches = Array.from(source.matchAll(MATH_DELIMITERS))
    if (!matches.length || !node.parentNode) continue
    const fragment = document.createDocumentFragment()
    let offset = 0
    for (const match of matches) {
      const start = match.index ?? 0
      const latex = match[1] ?? match[2] ?? match[3] ?? match[4] ?? ''
      const display = match[1] !== undefined || match[2] !== undefined
      if (start > offset) fragment.append(document.createTextNode(source.slice(offset, start)))
      fragment.append(createEquationToken(latex, display))
      offset = start + match[0].length
    }
    if (offset < source.length) fragment.append(document.createTextNode(source.slice(offset)))
    node.replaceWith(fragment)
  }
}

function serializeEditorContent(editor: HTMLDivElement): string {
  const copy = editor.cloneNode(true) as HTMLDivElement
  copy.querySelectorAll<HTMLElement>('.rich-question-equation[data-latex]').forEach(token => {
    const latex = token.dataset.latex || ''
    const delimiter = token.dataset.display === 'true' ? '$$' : '\\('
    const close = token.dataset.display === 'true' ? '$$' : '\\)'
    token.replaceWith(document.createTextNode(`${delimiter}${latex}${close}`))
  })
  return sanitizeQuestionContent(copy.innerHTML)
}

function insertFragment(editor: HTMLDivElement, html: string, rangeOverride?: Range | null) {
  const selection = window.getSelection()
  const range = rangeOverride?.cloneRange()
    || (selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : document.createRange())
  if (!editor.contains(range.commonAncestorContainer)) {
    range.selectNodeContents(editor)
    range.collapse(false)
  }

  range.deleteContents()
  const template = document.createElement('template')
  template.innerHTML = sanitizeQuestionContent(html)
  renderMathTokens(template.content)
  const fragment = template.content
  const lastNode = fragment.lastChild
  range.insertNode(fragment)
  if (lastNode) {
    range.setStartAfter(lastNode)
    range.collapse(true)
    selection?.removeAllRanges()
    selection?.addRange(range)
  }
  editor.focus()
}

function plainTextToHtml(text: string): string {
  return text
    .split(/\r?\n/)
    .map(line => line ? `<div>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>` : '<div><br></div>')
    .join('')
}

function hasHtmlMarkup(content: string): boolean {
  return /<\/?[a-z][\s\S]*?>/i.test(normalizeEscapedQuestionContent(content))
}

function readEditorContent(editor: HTMLDivElement): string {
  if (editor.querySelector('.rich-question-equation')) return serializeEditorContent(editor)
  const html = editor.innerHTML
  if (/<\/?(?:p|br|div|span|b|strong|i|em|u|s|sub|sup|ul|ol|li|blockquote|table|thead|tbody|tr|th|td|hr|img|h[1-6]|pre|code|math|mrow|mi|mn|mo|mfrac|msqrt|mroot|msup|msub|msubsup|mfenced|mtable|mtr|mtd|mtext|mspace|mstyle|semantics)\b/i.test(html)) {
    return sanitizeQuestionContent(html)
  }
  return sanitizeQuestionContent(editor.innerText.replace(/\r\n?/g, '\n'))
}

export default function RichQuestionEditor({
  value,
  onChange,
  onPasteImage,
  compact = false,
  editorLabel = compact ? 'Answer option' : 'Question text',
  placeholder = compact ? 'Enter answer option' : 'Paste or type the question here…',
}: RichQuestionEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const lastValueRef = useRef<string | null>(null)
  const savedRangeRef = useRef<Range | null>(null)
  const editingEquationRef = useRef<HTMLElement | null>(null)
  const mathFieldRef = useRef<MathfieldElement | null>(null)
  const equationInitialValueRef = useRef('')
  const equationPanelRef = useRef<HTMLDivElement>(null)
  const [pasteWarning, setPasteWarning] = useState('')
  const [showEquationEditor, setShowEquationEditor] = useState(false)
  const [equationDraft, setEquationDraft] = useState('')
  const [equationMode, setEquationMode] = useState<'inline' | 'block'>('inline')
  const [equationInputMode, setEquationInputMode] = useState<EquationInputMode>('visual')
  const [equationError, setEquationError] = useState('')
  const [equationCategory, setEquationCategory] = useState<EquationCategory>('Fractions')

  useLayoutEffect(() => {
    if (!editorRef.current || value === lastValueRef.current) return
    if (hasHtmlMarkup(value)) {
      editorRef.current.innerHTML = sanitizeQuestionContent(value)
    } else {
      editorRef.current.innerHTML = plainTextToHtml(sanitizeQuestionContent(value))
    }
    renderMathTokens(editorRef.current)
    lastValueRef.current = value
  }, [value])

  useEffect(() => {
    if (!showEquationEditor || !equationPanelRef.current) return
    const mathField = document.createElement('math-field') as MathfieldElement
    mathFieldRef.current = mathField
    mathField.value = equationInitialValueRef.current
    mathField.smartMode = true
    mathField.smartFence = true
    mathField.mathVirtualKeyboardPolicy = 'auto'
    mathField.setAttribute('virtual-keyboard-mode', 'onfocus')
    mathField.setAttribute('aria-label', 'Equation builder')
    mathField.className = 'rich-question-mathfield'
    const handleInput = () => setEquationDraft(mathField.value)
    mathField.addEventListener('input', handleInput)
    equationPanelRef.current.replaceChildren(mathField)
    mathField.focus()

    return () => {
      mathField.removeEventListener('input', handleInput)
      mathField.remove()
      mathFieldRef.current = null
    }
  }, [showEquationEditor])

  const updateContent = (event: FormEvent<HTMLDivElement>) => {
    const content = readEditorContent(event.currentTarget)
    lastValueRef.current = content
    onChange(content)
    if (pasteWarning) setPasteWarning('')
  }

  const rememberSelection = () => {
    const selection = window.getSelection()
    if (selection?.rangeCount && editorRef.current?.contains(selection.anchorNode)) {
      savedRangeRef.current = selection.getRangeAt(0).cloneRange()
    }
  }

  const openEquationEditor = (latex = '', display = false, existing?: HTMLElement) => {
    rememberSelection()
    editingEquationRef.current = existing || null
    equationInitialValueRef.current = latex
    setEquationDraft(latex)
    setEquationMode(display ? 'block' : 'inline')
    setEquationInputMode('visual')
    setEquationError('')
    setShowEquationEditor(true)
  }

  const pasteContent = (event: ClipboardEvent<HTMLDivElement>) => {
    const clipboard = event.clipboardData
    const html = clipboard.getData('text/html')
    const text = clipboard.getData('text/plain')
    const image = Array.from(clipboard.items)
      .find(item => item.type.startsWith('image/'))
      ?.getAsFile()
      || Array.from(clipboard.files).find(file => file.type.startsWith('image/'))

    if (import.meta.env.DEV) {
      console.debug('[question-paste:clipboard]', getClipboardMathDiagnostics(clipboard))
    }

    if (!html && !text && !image) return
    if (!html && !text && image && !onPasteImage) return
    event.preventDefault()

    const editor = editorRef.current
    const pasteRange = window.getSelection()?.rangeCount
      ? window.getSelection()?.getRangeAt(0).cloneRange()
      : null
    if (editor && (html || text)) {
      const prepared = preparePastedQuestion(html, text, Boolean(image))
      const pastedContent = prepared.content
      if (!hasQuestionContent(pastedContent)) {
        setPasteWarning(prepared.warning || 'Could not find readable question content in the clipboard. Copy the question text or HTML and try again.')
      } else {
        insertFragment(editor, hasHtmlMarkup(pastedContent) ? pastedContent : plainTextToHtml(pastedContent), pasteRange)
        setPasteWarning(prepared.warning)
        const content = readEditorContent(editor)
        lastValueRef.current = content
        onChange(content)
      }
    }
    if (image && onPasteImage && editor) {
      void Promise.resolve(onPasteImage(image)).then(imageUrl => {
        if (!imageUrl || !editor.isConnected) return
        insertFragment(editor, `<img src="${imageUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" alt="Pasted solution image">`, pasteRange)
        const content = readEditorContent(editor)
        lastValueRef.current = content
        onChange(content)
      })
    }
  }

  const handleEquationClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const token = target.closest<HTMLElement>('.rich-question-equation[data-latex]')
    if (!token) return
    event.preventDefault()
    openEquationEditor(token.dataset.latex || '', token.dataset.display === 'true', token)
  }

  const insertEquation = () => {
    const editor = editorRef.current
    const latex = (equationInputMode === 'latex' ? equationDraft : mathFieldRef.current?.value || equationDraft).trim()
    if (!editor || !latex) return

    const display = equationMode === 'block'
    try {
      katex.renderToString(latex, {
        throwOnError: true,
        displayMode: display,
        output: 'htmlAndMathml',
        strict: false,
        trust: false,
      })
    } catch (error) {
      setEquationError(error instanceof Error ? error.message : 'Enter valid LaTeX before inserting the equation.')
      return
    }

    setEquationError('')
    const token = createEquationToken(latex, display)
    const existing = editingEquationRef.current
    if (existing && editor.contains(existing)) {
      existing.replaceWith(token)
      const range = document.createRange()
      range.setStartAfter(token)
      range.collapse(true)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      editor.focus()
    } else {
      insertFragment(editor, display ? `$$${latex}$$` : `\\(${latex}\\)`, savedRangeRef.current)
    }

    editingEquationRef.current = null
    savedRangeRef.current = null
    const content = readEditorContent(editor)
    lastValueRef.current = content
    onChange(content)
    setShowEquationEditor(false)
  }

  const insertMathTemplate = (latex: string) => {
    const mathField = mathFieldRef.current
    if (equationInputMode === 'latex') {
      setEquationDraft(current => `${current}${latex}`)
      return
    }
    if (!mathField) return
    mathField.insert(latex, { selectionMode: 'placeholder' })
    setEquationDraft(mathField.value)
    mathField.focus()
  }

  const closeEquationEditor = () => {
    setShowEquationEditor(false)
    editingEquationRef.current = null
  }

  const runCommand = (event: MouseEvent<HTMLButtonElement>, command: string, value?: string) => {
    event.preventDefault()
    editorRef.current?.focus()
    document.execCommand(command, false, value)
    if (editorRef.current) {
      const content = readEditorContent(editorRef.current)
      lastValueRef.current = content
      onChange(content)
    }
  }

  const uploadImageFromPicker = (file: File, range: Range | null) => {
    const editor = editorRef.current
    if (!editor || !onPasteImage) return
    void Promise.resolve(onPasteImage(file)).then(imageUrl => {
      if (!imageUrl || !editor.isConnected) return
      const selection = window.getSelection()
      if (range && editor.contains(range.commonAncestorContainer)) {
        selection?.removeAllRanges()
        selection?.addRange(range)
      }
      insertFragment(editor, `<img src="${imageUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" alt="Pasted solution image">`)
      const content = readEditorContent(editor)
      lastValueRef.current = content
      onChange(content)
    })
  }

  let equationPreview = ''
  let equationPreviewError = ''
  if (equationInputMode === 'latex' && equationDraft.trim()) {
    try {
      equationPreview = katex.renderToString(equationDraft.trim(), {
        throwOnError: true,
        displayMode: equationMode === 'block',
        output: 'htmlAndMathml',
        strict: false,
        trust: false,
      })
    } catch (error) {
      equationPreviewError = error instanceof Error ? error.message : 'This LaTeX could not be rendered.'
    }
  }

  return (
    <div className={`rich-question-editor${compact ? ' rich-question-editor-compact' : ''}`}>
      {!compact && (
        <div className="rich-question-toolbar" role="toolbar" aria-label={`${editorLabel} formatting`}>
          <button type="button" title="Bold" aria-label="Bold" onMouseDown={event => runCommand(event, 'bold')}><Bold size={16} /></button>
          <button type="button" title="Italic" aria-label="Italic" onMouseDown={event => runCommand(event, 'italic')}><Italic size={16} /></button>
          <button type="button" title="Underline" aria-label="Underline" onMouseDown={event => runCommand(event, 'underline')}><Underline size={16} /></button>
          <button type="button" title="Superscript" aria-label="Superscript" onMouseDown={event => runCommand(event, 'superscript')}><Superscript size={16} /></button>
          <button type="button" title="Subscript" aria-label="Subscript" onMouseDown={event => runCommand(event, 'subscript')}><Subscript size={16} /></button>
          <button type="button" title="Bulleted list" aria-label="Bulleted list" onMouseDown={event => runCommand(event, 'insertUnorderedList')}><List size={16} /></button>
          <button type="button" title="Numbered list" aria-label="Numbered list" onMouseDown={event => runCommand(event, 'insertOrderedList')}><ListOrdered size={16} /></button>
          <button
            type="button"
            className="rich-question-equation-trigger"
            aria-expanded={showEquationEditor}
            onMouseDown={event => {
              rememberSelection()
              event.preventDefault()
            }}
            onClick={() => openEquationEditor()}
          ><Sigma size={16} /> Equation</button>
          <span className="rich-question-toolbar-hint">Paste rich text or an image with Ctrl+V</span>
        </div>
      )}
      {compact && (
        <div className="rich-question-compact-equation">
          <button
            type="button"
            className="rich-question-equation-trigger"
            aria-expanded={showEquationEditor}
            onMouseDown={event => {
              rememberSelection()
              event.preventDefault()
            }}
            onClick={() => openEquationEditor()}
          ><Sigma size={15} /> Equation</button>
        </div>
      )}
      {showEquationEditor && (
        <section className="rich-question-equation-panel" aria-label="Equation editor">
          <div className="rich-question-equation-panel-heading">
            <strong>{editingEquationRef.current ? 'Edit equation' : 'Insert equation'}</strong>
            <button type="button" aria-label="Close equation editor" onClick={closeEquationEditor}><X size={17} /></button>
          </div>
          <div className="rich-question-equation-mode">
            <label htmlFor={`equation-mode-${editorLabel.replace(/\W/g, '-')}`}>Display</label>
            <select
              id={`equation-mode-${editorLabel.replace(/\W/g, '-')}`}
              value={equationMode}
              onChange={event => setEquationMode(event.target.value as 'inline' | 'block')}
            >
              <option value="inline">Inline</option>
              <option value="block">Block</option>
            </select>
            <div className="rich-question-equation-input-modes" role="group" aria-label="Equation input mode">
              <button
                type="button"
                aria-pressed={equationInputMode === 'visual'}
                className={equationInputMode === 'visual' ? 'active' : ''}
                onClick={() => {
                  if (mathFieldRef.current) mathFieldRef.current.value = equationDraft
                  setEquationError('')
                  setEquationInputMode('visual')
                }}
              >Visual editor</button>
              <button
                type="button"
                aria-pressed={equationInputMode === 'latex'}
                className={equationInputMode === 'latex' ? 'active' : ''}
                onClick={() => {
                  if (mathFieldRef.current?.value) setEquationDraft(mathFieldRef.current.value)
                  setEquationError('')
                  setEquationInputMode('latex')
                }}
              >LaTeX source</button>
            </div>
            <button type="button" onClick={() => mathFieldRef.current?.executeCommand('undo')}>Undo</button>
            <button type="button" onClick={() => mathFieldRef.current?.executeCommand('redo')}>Redo</button>
            <button type="button" onClick={() => {
              if (mathFieldRef.current) mathFieldRef.current.value = ''
              setEquationDraft('')
              setEquationError('')
            }}>Clear</button>
          </div>
          <div
            ref={equationPanelRef}
            className="rich-question-mathfield-container"
            hidden={equationInputMode !== 'visual'}
          />
          {equationInputMode === 'latex' && (
            <div className="rich-question-latex-editor">
              <label htmlFor={`latex-source-${editorLabel.replace(/\W/g, '-')}`}>LaTeX source</label>
              <textarea
                id={`latex-source-${editorLabel.replace(/\W/g, '-')}`}
                value={equationDraft}
                onChange={event => {
                  setEquationDraft(event.target.value)
                  setEquationError('')
                }}
                onPaste={event => {
                  const pasted = event.clipboardData.getData('text/plain')
                  if (!pasted) return
                  event.preventDefault()
                  const textarea = event.currentTarget
                  const start = textarea.selectionStart
                  const end = textarea.selectionEnd
                  const next = `${equationDraft.slice(0, start)}${pasted}${equationDraft.slice(end)}`
                  setEquationDraft(next)
                  setEquationError('')
                  requestAnimationFrame(() => {
                    textarea.selectionStart = start + pasted.length
                    textarea.selectionEnd = start + pasted.length
                  })
                }}
                rows={3}
                spellCheck={false}
                placeholder="Paste or type LaTeX, e.g. \\frac{a}{b} or \\sin^2(x)"
              />
              <div className="rich-question-latex-preview" aria-live="polite">
                <strong>Live preview</strong>
                {equationDraft.trim()
                  ? equationPreview
                    ? <div dangerouslySetInnerHTML={{ __html: equationPreview }} />
                    : <p role="alert">{equationPreviewError}</p>
                  : <p>Enter LaTeX to preview the equation.</p>}
              </div>
            </div>
          )}
          <div className="rich-question-equation-categories" role="tablist" aria-label="Equation templates">
            {EQUATION_CATEGORIES.map(category => (
              <button
                type="button"
                role="tab"
                aria-selected={equationCategory === category}
                className={equationCategory === category ? 'active' : ''}
                key={category}
                onMouseDown={event => event.preventDefault()}
                onClick={() => setEquationCategory(category)}
              >{category}</button>
            ))}
          </div>
          <div className="rich-question-equation-templates">
            {EQUATION_TEMPLATES[equationCategory].map(template => (
              <button
                type="button"
                key={`${template.label}-${template.latex}`}
                title={template.label}
                onMouseDown={event => event.preventDefault()}
                onClick={() => insertMathTemplate(template.latex)}
              >{template.label}</button>
            ))}
          </div>
          <div className="rich-question-equation-actions">
            <span>Use Tab or arrow keys to move between placeholders.</span>
            {equationError && <span className="rich-question-equation-error" role="alert">{equationError}</span>}
            <button type="button" onClick={closeEquationEditor}>Cancel</button>
            <button type="button" className="primary" onClick={insertEquation}>{editingEquationRef.current ? 'Update equation' : 'Insert equation'}</button>
          </div>
        </section>
      )}
      {pasteWarning && <div className="rich-question-paste-warning" role="alert">{pasteWarning}</div>}
      <div
        ref={editorRef}
        className="rich-question-editor-surface"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={editorLabel}
        data-placeholder={placeholder}
        onInput={updateContent}
        onPaste={pasteContent}
        onClick={handleEquationClick}
      />
      {onPasteImage && !compact && (
        <button type="button" className="rich-question-paste-image" onClick={() => {
          const selection = window.getSelection()
          const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = 'image/*'
          input.onchange = () => {
            const file = input.files?.[0]
            if (file) uploadImageFromPicker(file, range)
          }
          input.click()
        }}>
          <ImageIcon size={15} /> Upload image
        </button>
      )}
    </div>
  )
}
