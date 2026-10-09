/**
 * pptGenerator.ts
 * ----------------
 * Client-side PPT generation for CET questions (pptxgenjs).
 *
 * One shared generator serves both entry points of the PDF workflow:
 *   - the PDF import review screen (classified extractions, before import)
 *   - the question bank list toolbar (already persisted questions)
 *
 * Callers filter the question list first (subject / chapter / topic / CET
 * difficulty selectors); with no filters the full selection is exported, so
 * the one-click "whole PDF -> PPT" behaviour keeps working. Correct answers
 * and solutions are included by default and can be turned off.
 */
import PptxGenJS from 'pptxgenjs'

/** Minimal question shape shared by extracted (PDF) and stored (bank) questions. */
export interface PptQuestion {
  /** stored questions use `text`, extracted PDF questions use `question` */
  question?: string
  text?: string
  options: string[] | Record<string, string>
  correctIndex?: number | null
  solution?: string
  subject?: string
  chapter?: string
  topic?: string
  subTopic?: string
  questionType?: string
  cetDifficulty?: string
  cetRelevance?: string
  sourcePdf?: string
  sourcePage?: number | null
  questionNumber?: number | null
  sourceQuestionNumber?: number | null
}

export interface PptExportOptions {
  title?: string
  subject?: string
  chapter?: string
  topic?: string
  /** pdf import review passes the uploaded file name for source tracking */
  sourcePdf?: string
  /** mark the correct option + append answer key / solution slides (default true) */
  includeAnswers?: boolean
}

export interface PptExportResult {
  fileName: string
  slideCount: number
  questionCount: number
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

const PRIMARY = '7C3AED'
const DARK = '1F2937'
const MUTED = '6B7280'
const GREEN = '059669'
const LIGHT = 'F8F7FF'

const questionTextOf = (q: PptQuestion): string => String(q.question || q.text || '').trim()

const optionListOf = (q: PptQuestion): string[] => {
  if (Array.isArray(q.options)) return q.options.map((o) => String(o ?? ''))
  if (q.options && typeof q.options === 'object') {
    return Object.keys(q.options)
      .sort()
      .map((key) => String((q.options as Record<string, string>)[key] ?? ''))
  }
  return []
}

const sanitizeFileName = (value: string): string =>
  String(value || '')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)

const clamp = (value: string, max: number): string => {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Classification breadcrumb shown on every question slide. */
const breadcrumbOf = (q: PptQuestion): string =>
  [q.subject, q.chapter, q.topic, q.subTopic].filter(Boolean).join('  ›  ')

/** Source provenance line (PDF name, page, original question number). */
const sourceLineOf = (q: PptQuestion, index: number): string => {
  const parts: string[] = []
  const pdf = q.sourcePdf
  if (pdf) parts.push(`Source: ${pdf}`)
  if (q.sourcePage) parts.push(`Page ${q.sourcePage}`)
  const originalNumber = q.sourceQuestionNumber || q.questionNumber
  if (originalNumber && pdf) parts.push(`Q${originalNumber}`)
  return parts.length ? `${parts.join('  •  ')}  •  Slide Q${index + 1}` : `Slide Q${index + 1}`
}

/**
 * Generate and download a PPTX for the given (already filtered) questions.
 * Returns the file name and slide/question counts for the success toast.
 */
export async function generateQuestionsPpt(
  questions: PptQuestion[],
  opts: PptExportOptions = {},
): Promise<PptExportResult> {
  const list = (questions || []).filter((q) => questionTextOf(q))
  if (!list.length) {
    throw new Error('No questions match the selected filters — nothing to export.')
  }

  const includeAnswers = opts.includeAnswers !== false

  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'
  pptx.author = 'CET Prep Pro'
  pptx.company = 'CET Portal'
  pptx.title = opts.title || 'MHT-CET Question Bank'

  let slideCount = 0

  // ── Title slide ──────────────────────────────────────────────────────
  const title = pptx.addSlide()
  slideCount += 1
  title.background = { color: LIGHT }
  title.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.18, fill: { color: PRIMARY } })
  title.addText(opts.title || 'MHT-CET MCQ Presentation', {
    x: 0.6, y: 1.5, w: 8.8, h: 0.9,
    fontSize: 30, bold: true, color: DARK,
  })
  const scope = [opts.subject, opts.chapter, opts.topic].filter(Boolean).join('  ›  ') || 'All Subjects / Chapters'
  title.addText(scope, { x: 0.6, y: 2.5, w: 8.8, h: 0.4, fontSize: 15, color: PRIMARY, bold: true })
  const metaBits = [`${list.length} questions`, `Generated ${new Date().toLocaleDateString()}`]
  if (opts.sourcePdf) metaBits.unshift(`Source PDF: ${opts.sourcePdf}`)
  title.addText(metaBits.join('  •  '), { x: 0.6, y: 3.05, w: 8.8, h: 0.4, fontSize: 12, color: MUTED })
  if (!includeAnswers) {
    title.addText('Answers and solutions are not included in this export.', {
      x: 0.6, y: 3.5, w: 8.8, h: 0.35, fontSize: 11, color: MUTED, italic: true,
    })
  }
  title.addText('CET Portal — Admin Panel', { x: 0.6, y: 5.0, w: 8.8, h: 0.3, fontSize: 9, color: MUTED })

  // ── Question slides ──────────────────────────────────────────────────
  const answerKeyRuns: Array<{ text: string; options: { breakLine?: boolean; bold?: boolean; color?: string } }> = []
  const solved: Array<{ number: number; solution: string }> = []

  list.forEach((q, index) => {
    const slide = pptx.addSlide()
    slideCount += 1
    const options = optionListOf(q)
    const correctIndex = Number.isInteger(q.correctIndex) ? (q.correctIndex as number) : -1

    const crumb = breadcrumbOf(q)
    if (crumb) {
      slide.addText(crumb, { x: 0.5, y: 0.18, w: 9, h: 0.3, fontSize: 9, color: MUTED, align: 'right' })
    }

    slide.addText(`Q${index + 1}.  ${clamp(questionTextOf(q), 900)}`, {
      x: 0.5, y: 0.55, w: 9, h: 2.3,
      fontSize: 15, color: DARK, valign: 'top', fit: 'shrink',
    })

    if (options.length) {
      const runs = options.slice(0, 6).map((text, i) => {
        const isCorrect = includeAnswers && i === correctIndex
        return {
          text: `${isCorrect ? '✓ ' : ''}${LETTERS[i]}.  ${clamp(text, 300)}\n`,
          options: {
            breakLine: true,
            bold: isCorrect,
            color: isCorrect ? GREEN : DARK,
          },
        }
      })
      slide.addText(runs, { x: 0.5, y: 3.0, w: 9, h: 2.05, fontSize: 13, valign: 'top', fit: 'shrink' })
    }

    const footerBits = [sourceLineOf(q, index)]
    if (q.cetDifficulty) footerBits.push(q.cetDifficulty)
    if (q.questionType) footerBits.push(q.questionType)
    slide.addText(footerBits.join('  •  '), {
      x: 0.5, y: 5.22, w: 9, h: 0.3, fontSize: 8.5, color: MUTED,
    })

    if (includeAnswers && correctIndex >= 0 && correctIndex < options.length) {
      answerKeyRuns.push({
        text: `Q${index + 1} — ${LETTERS[correctIndex]}    `,
        options: { bold: true, color: PRIMARY },
      })
      if (q.solution && String(q.solution).trim()) {
        solved.push({ number: index + 1, solution: String(q.solution).trim() })
      }
    }
  })

  // ── Answer key slide ─────────────────────────────────────────────────
  if (includeAnswers && answerKeyRuns.length) {
    // break the key into rows of 8 entries for readability
    answerKeyRuns.forEach((run, i) => {
      if ((i + 1) % 8 === 0) run.options = { ...run.options, breakLine: true }
    })

    const keySlide = pptx.addSlide()
    slideCount += 1
    keySlide.background = { color: LIGHT }
    keySlide.addText('Answer Key', { x: 0.6, y: 0.4, w: 8.8, h: 0.5, fontSize: 22, bold: true, color: PRIMARY })
    keySlide.addText(answerKeyRuns, { x: 0.6, y: 1.2, w: 8.8, h: 3.8, fontSize: 14, color: DARK, valign: 'top' })
  }

  // ── Solution slides ──────────────────────────────────────────────────
  if (includeAnswers) {
    solved.forEach(({ number, solution }) => {
      const slide = pptx.addSlide()
      slideCount += 1
      slide.addText(`Solution — Q${number}`, { x: 0.5, y: 0.35, w: 9, h: 0.45, fontSize: 16, bold: true, color: PRIMARY })
      slide.addText(clamp(solution, 1800), {
        x: 0.5, y: 0.95, w: 9, h: 4.3, fontSize: 12, color: DARK, valign: 'top', fit: 'shrink',
      })
    })
  }

  const scopeName =
    [opts.subject, opts.chapter, opts.topic]
      .filter((s): s is string => Boolean(s))
      .map(sanitizeFileName)
      .join('_') || 'Questions'
  const fileName = `CET_${scopeName}_${list.length}Q.pptx`

  await pptx.writeFile({ fileName })

  return { fileName, slideCount, questionCount: list.length }
}
