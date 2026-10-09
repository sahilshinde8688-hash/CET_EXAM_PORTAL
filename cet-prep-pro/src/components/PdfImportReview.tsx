import { useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Copy, Edit2,
  FileText, Trash2, Upload, X,
} from 'lucide-react'
import { MathRenderer } from '../lib/mathDisplay'
import type { PdfExtractResponse, PdfImportQuestion } from '../lib/api'

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F']
const DIFFICULTIES = ['Easy', 'Medium', 'Hard']

interface Props {
  questions: PdfImportQuestion[]
  meta: PdfExtractResponse['meta'] | null
  importing: boolean
  /** Called with the mutated list on every edit / reorder / selection change. */
  onChange: (questions: PdfImportQuestion[]) => void
  onImport: () => void
  onCancel: () => void
}

/**
 * Review screen for PDF question extraction. Every question can be edited,
 * removed, reordered, deselected or pointed at an existing duplicate before
 * anything is written to the question bank.
 */
export default function PdfImportReview({ questions, meta, importing, onChange, onImport, onCancel }: Props) {
  const [editing, setEditing] = useState<number | null>(null)
  const [showDuplicates, setShowDuplicates] = useState<string | null>(null) // questionNumber as string

  const stats = useMemo(() => ({
    total: questions.length,
    selected: questions.filter((q) => q.selected).length,
    duplicates: questions.filter((q) => q.duplicate).length,
    review: questions.filter((q) => q.needsReview).length,
    replaced: questions.filter((q) => q.selected && q.duplicateAction === 'replace').length,
    skipped: questions.filter((q) => q.selected && q.duplicateAction === 'skip').length,
  }), [questions])

  const update = (index: number, patch: Partial<PdfImportQuestion>) => {
    const next = [...questions]
    next[index] = { ...next[index], ...patch }
    onChange(next)
  }

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= questions.length) return
    const next = [...questions]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    onChange(next)
  }

  const remove = (index: number) => {
    onChange(questions.filter((_, i) => i !== index))
  }

  const toggleAll = () => {
    const allSelected = stats.selected === questions.length
    onChange(questions.map((q) => ({ ...q, selected: !allSelected })))
  }

  const addQuestion = () => {
    const nextNumber = questions.reduce((m, q) => Math.max(m, q.questionNumber), 0) + 1
    const blank: PdfImportQuestion = {
      questionNumber: nextNumber,
      question: '',
      options: { A: '', B: '', C: '', D: '' },
      correctAnswer: 'A',
      correctIndex: 0,
      subject: '',
      chapter: '',
      topic: '',
      difficulty: 'Medium',
      solution: '',
      confidence: 1,
      needsReview: false,
      reviewReason: '',
      warnings: [],
      duplicate: false,
      duplicateType: null,
      duplicateOfId: null,
      duplicateOfText: null,
      duplicateScore: 0,
      duplicateAction: 'import',
      selected: true,
    }
    onChange([...questions, blank])
    setEditing(questions.length)
  }

  return (
    <div className="qb-pir">
      {/* ── Header / summary ─────────────────────────────────────────── */}
      <div className="qb-pir-header">
        <div className="qb-pir-title">
          <FileText size={22} />
          <div>
            <h2>Review Extracted Questions</h2>
            <p className="qb-pir-subtitle">
              {meta?.fileName || 'PDF'} · {meta?.pages ?? '?'} pages
              {meta?.mode === 'ocr' ? ' · scanned PDF (OCR)' : ' · text layer'}
              {meta?.truncated ? ' · page limit reached' : ''}
            </p>
          </div>
        </div>
        <button className="qb-btn-icon" onClick={onCancel} title="Discard extraction"><X size={20} /></button>
      </div>

      <div className="qb-pir-stats">
        <span className="qb-pir-stat"><strong>{stats.total}</strong> extracted</span>
        <span className="qb-pir-stat ok"><strong>{stats.selected}</strong> selected</span>
        {stats.duplicates > 0 && <span className="qb-pir-stat warn"><strong>{stats.duplicates}</strong> duplicates</span>}
        {stats.review > 0 && <span className="qb-pir-stat danger"><strong>{stats.review}</strong> need review</span>}
        <button className="qb-pir-select-all" onClick={toggleAll}>
          {stats.selected === questions.length ? 'Deselect all' : 'Select all'}
        </button>
        <button className="qb-pir-add" onClick={addQuestion}>+ Add question</button>
      </div>

      {(meta?.warnings?.length || 0) > 0 && (
        <div className="qb-pir-doc-warnings">
          <AlertTriangle size={16} />
          <div>
            {meta!.warnings!.slice(0, 4).map((w, i) => <p key={i}>{w}</p>)}
            {(meta!.warnings?.length || 0) > 4 && <p>…and {meta!.warnings!.length - 4} more</p>}
          </div>
        </div>
      )}

      {/* ── Question cards ───────────────────────────────────────────── */}
      <div className="qb-pir-list">
        {questions.map((q, index) => {
          const isEditing = editing === index
          // In edit mode every option slot is editable; otherwise only the
          // filled ones are shown.
          const letters: string[] = isEditing
            ? OPTION_KEYS
            : OPTION_KEYS.filter((k) => (q.options?.[k] ?? '').length > 0)
          return (
            <div
              key={`${q.questionNumber}-${index}`}
              className={[
                'qb-pir-card',
                q.selected ? '' : 'qb-pir-card-off',
                q.needsReview ? 'qb-pir-card-review' : '',
                q.duplicate ? 'qb-pir-card-dup' : '',
              ].join(' ')}
            >
              <div className="qb-pir-card-head">
                <label className="qb-pir-check">
                  <input
                    type="checkbox"
                    checked={q.selected}
                    onChange={(e) => update(index, { selected: e.target.checked })}
                  />
                  <span className="qb-pir-num">#{q.questionNumber}</span>
                </label>

                <div className="qb-pir-badges">
                  <span className={`qb-pir-conf ${q.confidence >= 0.75 ? 'hi' : q.confidence >= 0.55 ? 'mid' : 'lo'}`} title="Extraction confidence">
                    {Math.round(q.confidence * 100)}%
                  </span>
                  <span className={`qb-pir-diff ${q.difficulty.toLowerCase()}`}>{q.difficulty}</span>
                  {q.sourcePage ? <span className="qb-pir-page">p.{q.sourcePage}</span> : null}
                  {q.duplicate && (
                    <span className={`qb-pir-dupbadge ${q.duplicateType === 'exact' ? 'exact' : 'similar'}`}>
                      <Copy size={12} />
                      {q.duplicateType === 'exact' ? 'Exact duplicate' : `Similar ${Math.round((q.duplicateScore || 0) * 100)}%`}
                    </span>
                  )}
                  {q.needsReview && (
                    <span className="qb-pir-reviewbadge" title={q.reviewReason}>
                      <AlertTriangle size={12} /> {q.reviewReason || 'Needs review'}
                    </span>
                  )}
                </div>

                <div className="qb-pir-actions">
                  <button className="qb-btn-icon" title="Edit question" onClick={() => setEditing(isEditing ? null : index)}>
                    <Edit2 size={16} />
                  </button>
                  <button className="qb-btn-icon" title="Move up" onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
                  <button className="qb-btn-icon" title="Move down" onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
                  <button className="qb-btn-icon danger" title="Remove from import" onClick={() => remove(index)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {/* Duplicate details + strategy */}
              {q.duplicate && (
                <div className="qb-pir-dupbox">
                  <div className="qb-pir-dupbox-head">
                    <span>Duplicate of an existing question{q.duplicateInBatch ? ' (also in this PDF)' : ''}:</span>
                    <button className="qb-pir-dup-toggle" onClick={() => setShowDuplicates(showDuplicates === String(q.questionNumber) ? null : String(q.questionNumber))}>
                      {showDuplicates === String(q.questionNumber) ? 'Hide' : 'Compare'}
                    </button>
                  </div>
                  {showDuplicates === String(q.questionNumber) && (
                    <div className="qb-pir-dup-compare">
                      <div>
                        <strong>Existing in bank</strong>
                        <p>{q.duplicateOfText || '—'}</p>
                      </div>
                      <div>
                        <strong>Extracted from PDF</strong>
                        <p>{q.question}</p>
                      </div>
                    </div>
                  )}
                  <div className="qb-pir-dup-actions" role="radiogroup" aria-label="Duplicate strategy">
                    {([
                      { key: 'skip', label: 'Skip (keep existing)' },
                      { key: 'import', label: 'Import anyway' },
                      { key: 'replace', label: 'Replace existing' },
                    ] as const).map((opt) => (
                      <label key={opt.key} className={`qb-pir-dup-opt ${q.duplicateAction === opt.key ? 'active' : ''}`}>
                        <input
                          type="radio"
                          name={`dup-${q.questionNumber}`}
                          checked={q.duplicateAction === opt.key}
                          onChange={() => update(index, { duplicateAction: opt.key })}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Question text */}
              {isEditing ? (
                <textarea
                  className="qb-pir-input"
                  rows={3}
                  value={q.question}
                  onChange={(e) => update(index, { question: e.target.value })}
                />
              ) : (
                <div className="qb-pir-text"><MathRenderer value={q.question} /></div>
              )}

              {/* Options + correct answer */}
              <div className="qb-pir-options">
                {letters.map((letter) => (
                  <div key={letter} className={`qb-pir-option ${q.correctAnswer === letter ? 'correct' : ''}`}>
                    <label className="qb-pir-option-pick" title="Mark as correct answer">
                      <input
                        type="radio"
                        name={`ans-${q.questionNumber}`}
                        checked={q.correctAnswer === letter}
                        onChange={() => update(index, { correctAnswer: letter, correctIndex: letters.indexOf(letter) })}
                      />
                      <span>{letter}</span>
                    </label>
                    {isEditing ? (
                      <input
                        className="qb-pir-input"
                        value={q.options[letter]}
                        onChange={(e) => update(index, { options: { ...q.options, [letter]: e.target.value } })}
                      />
                    ) : (
                      <div className="qb-pir-option-text"><MathRenderer value={q.options[letter]} /></div>
                    )}
                  </div>
                ))}
              </div>

              {/* Editable metadata */}
              <div className={`qb-pir-meta ${isEditing ? 'open' : ''}`}>
                <label>
                  Subject
                  <input
                    className="qb-pir-input"
                    value={q.subject}
                    placeholder="General"
                    onChange={(e) => update(index, { subject: e.target.value })}
                  />
                </label>
                <label>
                  Chapter
                  <input
                    className="qb-pir-input"
                    value={q.chapter}
                    onChange={(e) => update(index, { chapter: e.target.value })}
                  />
                </label>
                <label>
                  Topic
                  <input
                    className="qb-pir-input"
                    value={q.topic}
                    onChange={(e) => update(index, { topic: e.target.value })}
                  />
                </label>
                <label>
                  Difficulty
                  <select
                    className="qb-pir-input"
                    value={q.difficulty}
                    onChange={(e) => update(index, { difficulty: e.target.value as PdfImportQuestion['difficulty'] })}
                  >
                    {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </label>
              </div>
              {isEditing && (
                <label className="qb-pir-solution">
                  Solution (optional)
                  <textarea
                    className="qb-pir-input"
                    rows={2}
                    value={q.solution}
                    onChange={(e) => update(index, { solution: e.target.value })}
                  />
                </label>
              )}

              {(q.warnings?.length || 0) > 0 && (
                <div className="qb-pir-warnings">
                  {q.warnings.map((w, i) => <p key={i}><AlertTriangle size={12} /> {w}</p>)}
                </div>
              )}
            </div>
          )
        })}

        {questions.length === 0 && (
          <div className="qb-pir-empty">
            <p>No questions remain in this extraction.</p>
          </div>
        )}
      </div>

      {/* ── Import bar ───────────────────────────────────────────────── */}
      <div className="qb-pir-importbar">
        <div>
          <strong>{stats.selected}</strong> of {stats.total} selected
          {stats.replaced > 0 && <> · {stats.replaced} will replace existing</>}
          {stats.skipped > 0 && <> · {stats.skipped} will be skipped</>}
        </div>
        <div className="qb-pir-importbar-actions">
          <button className="qb-btn qb-btn-outline" onClick={onCancel} disabled={importing}><X size={16} /> Cancel</button>
          <button className="qb-btn qb-btn-primary" onClick={onImport} disabled={importing || stats.selected === 0}>
            <Upload size={16} /> {importing ? 'Importing…' : `Import ${stats.selected} question${stats.selected === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
      <p className="qb-pir-hint"><CheckCircle2 size={14} /> Imported questions go through the same validation and storage as the Excel importer.</p>
    </div>
  )
}
