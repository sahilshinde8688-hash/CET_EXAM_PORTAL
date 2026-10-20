import { useLayoutEffect, useRef, useState, type ClipboardEvent, type FormEvent, type MouseEvent } from 'react'
import { Bold, Image as ImageIcon, Italic, List, ListOrdered, Subscript, Superscript, Underline } from 'lucide-react'
import { getClipboardMathDiagnostics, hasQuestionContent, isRichQuestionContent, preparePastedQuestion, sanitizeQuestionContent } from '../lib/questionContent'
import './rich-question-editor.css'

interface RichQuestionEditorProps {
  value: string
  onChange: (value: string) => void
  onPasteImage?: (file: File) => void | string | Promise<void | string>
  compact?: boolean
  editorLabel?: string
  placeholder?: string
}

function insertFragment(editor: HTMLDivElement, html: string) {
  const selection = window.getSelection()
  const range = selection?.rangeCount ? selection.getRangeAt(0) : document.createRange()
  if (!editor.contains(range.commonAncestorContainer)) {
    range.selectNodeContents(editor)
    range.collapse(false)
  }

  range.deleteContents()
  const template = document.createElement('template')
  template.innerHTML = sanitizeQuestionContent(html)
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

function readEditorContent(editor: HTMLDivElement): string {
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
  const [pasteWarning, setPasteWarning] = useState('')

  useLayoutEffect(() => {
    if (!editorRef.current || value === lastValueRef.current) return
    if (isRichQuestionContent(value)) {
      editorRef.current.innerHTML = sanitizeQuestionContent(value)
    } else {
      editorRef.current.replaceChildren(document.createTextNode(value))
    }
    lastValueRef.current = value
  }, [value])

  const updateContent = (event: FormEvent<HTMLDivElement>) => {
    const content = readEditorContent(event.currentTarget)
    lastValueRef.current = content
    onChange(content)
    if (pasteWarning) setPasteWarning('')
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
    if (image && !onPasteImage && !html && !text) return
    event.preventDefault()

    const editor = editorRef.current
    if (editor && (html || text)) {
      const prepared = preparePastedQuestion(html, text, Boolean(image))
      const pastedContent = prepared.content
      if (!hasQuestionContent(pastedContent)) {
        setPasteWarning(prepared.warning || 'Could not find readable question content in the clipboard. Copy the question text or HTML and try again.')
      } else {
        insertFragment(editor, isRichQuestionContent(pastedContent) ? pastedContent : plainTextToHtml(pastedContent))
        setPasteWarning(prepared.warning)
        const content = readEditorContent(editor)
        lastValueRef.current = content
        onChange(content)
      }
    }
    if (image && onPasteImage && editor) {
      const selection = window.getSelection()
      const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null
      void Promise.resolve(onPasteImage(image)).then(imageUrl => {
        if (!imageUrl || !editor.isConnected) return
        const currentSelection = window.getSelection()
        if (range && editor.contains(range.commonAncestorContainer)) {
          currentSelection?.removeAllRanges()
          currentSelection?.addRange(range)
        }
        insertFragment(editor, `<img src="${imageUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" alt="Pasted solution image">`)
        const content = readEditorContent(editor)
        lastValueRef.current = content
        onChange(content)
      })
    }
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

  const insertLatex = (display: boolean) => {
    const expression = window.prompt('Enter a LaTeX expression (without delimiters):', display ? '\\begin{bmatrix}a & b \\\\ c & d\\end{bmatrix}' : 'x^2 + y^2')
    if (expression === null || !editorRef.current) return
    const delimiter = display ? '$$' : '$'
    insertFragment(editorRef.current, `${delimiter}${expression}${delimiter}`)
    const content = readEditorContent(editorRef.current)
    lastValueRef.current = content
    onChange(content)
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
          <button type="button" title="Insert inline equation" onMouseDown={event => event.preventDefault()} onClick={() => insertLatex(false)}>𝑥²</button>
          <button type="button" title="Insert equation or matrix block" onMouseDown={event => event.preventDefault()} onClick={() => insertLatex(true)}>∑</button>
          <span className="rich-question-toolbar-hint">Paste rich text or an image with Ctrl+V</span>
        </div>
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
