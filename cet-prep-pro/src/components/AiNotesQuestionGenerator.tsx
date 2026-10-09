import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle, Check, CheckSquare, FileText, LoaderCircle, RefreshCw,
  Save, Sparkles, Trash2, UploadCloud, X,
} from 'lucide-react'
import {
  questionsAPI,
  type NotesGeneratedQuestion,
  type NotesGenerationConfig,
  type NotesGenerationResult,
} from '../lib/api'

type GeneratorProps = {
  onClose: () => void
  onCreateTest: (questionIds: string[]) => void
}

type ReviewQuestion = NotesGeneratedQuestion & { localId: string; generationIndex: number }

const mixedLevels = ['Medium', 'Hard', 'Very Hard'] as const
const allowedCounts = [5, 10, 20, 30, 50, 100]

const parseCustomDistribution = (value: string): Record<string, number> => {
  const parsed: Record<string, number> = {}
  value.split('\n').map(line => line.trim()).filter(Boolean).forEach((line) => {
    const match = line.match(/^(.+?)\s*(?:=|:)\s*(\d+(?:\.\d+)?)\s*%?$/)
    if (!match) throw new Error(`Use one topic and percentage per line, e.g. "Cell Division: 40".`)
    parsed[match[1].trim()] = Number(match[2])
  })
  if (!Object.keys(parsed).length) throw new Error('Enter at least one topic and percentage for a custom distribution.')
  const total = Object.values(parsed).reduce((sum, value) => sum + value, 0)
  if (Math.abs(total - 100) > 0.01) throw new Error('Custom topic percentages must add up to 100%.')
  return parsed
}

const mapGeneratedQuestion = (question: NotesGeneratedQuestion, index: number): ReviewQuestion => ({
  ...question,
  localId: `${index}-${question.sourcePage}-${Date.now()}`,
  generationIndex: index,
})

export default function AiNotesQuestionGenerator({ onClose, onCreateTest }: GeneratorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [subject, setSubject] = useState('')
  const [countPreset, setCountPreset] = useState('10')
  const [customCount, setCustomCount] = useState(15)
  const [difficulty, setDifficulty] = useState<NotesGenerationConfig['difficulty']>('Mixed')
  const [mixedDifficulty, setMixedDifficulty] = useState<Record<typeof mixedLevels[number], number>>({
    Medium: 20, Hard: 50, 'Very Hard': 30,
  })
  const [generateExplanations, setGenerateExplanations] = useState(true)
  const [includeNumericalQuestions, setIncludeNumericalQuestions] = useState(true)
  const [topicMode, setTopicMode] = useState<'automatic' | 'equal' | 'custom'>('automatic')
  const [customTopics, setCustomTopics] = useState('')
  const [questions, setQuestions] = useState<ReviewQuestion[]>([])
  const [topics, setTopics] = useState<NotesGenerationResult['topics']>([])
  const [detectedSubjects, setDetectedSubjects] = useState<string[]>([])
  const [jobId, setJobId] = useState('')
  const [progress, setProgress] = useState(0)
  const [stage, setStage] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [validatingId, setValidatingId] = useState<string | null>(null)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [savedIds, setSavedIds] = useState<string[]>([])
  const [savedQuestionLocalIds, setSavedQuestionLocalIds] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    void questionsAPI.getSubjectsAndChapters()
      .then((result) => {
        if (result.subjects.length) setSubject(previous => previous || result.subjects[0])
      })
      .catch((requestError: unknown) => {
        setError(requestError instanceof Error ? `Could not load question-bank subjects: ${requestError.message}` : 'Could not load question-bank subjects.')
      })
  }, [])

  const selectedCount = countPreset === 'custom' ? customCount : Number(countPreset)
  const approvedQuestions = questions.filter(question =>
    question.approved && question.selected && !savedQuestionLocalIds.includes(question.localId),
  )

  const selectFile = (candidate?: File) => {
    setError('')
    setWarning('')
    if (!candidate) return
    if (!/\.(pdf|pptx)$/i.test(candidate.name)) {
      setError('Choose a PDF or PowerPoint (.pptx) file.')
      return
    }
    if (candidate.size > 25 * 1024 * 1024) {
      setError('This file is larger than 25 MB. Split it into smaller notes files and try again.')
      return
    }
    setFile(candidate)
  }

  const generate = async () => {
    if (!file) return setError('Upload a PDF or PPTX notes file first.')
    if (!subject.trim()) return setError('Enter or select a subject for the new questions.')
    if (!Number.isInteger(selectedCount) || selectedCount < 1 || selectedCount > 100) return setError('Choose between 1 and 100 questions.')
    if (difficulty === 'Mixed' && (mixedLevels.some(level =>
      !Number.isFinite(mixedDifficulty[level]) || mixedDifficulty[level] < 0 || mixedDifficulty[level] > 100,
    ) || Math.abs(mixedLevels.reduce((sum, level) => sum + mixedDifficulty[level], 0) - 100) > 0.01)) {
      return setError('Mixed difficulty percentages must add up to 100%.')
    }

    try {
      const values = topicMode === 'custom' ? parseCustomDistribution(customTopics) : undefined
      setBusy(true)
      setProgress(0)
      setStage('Starting')
      setError('')
      setWarning('')
      setQuestions([])
      setTopics([])
      setDetectedSubjects([])
      setDetectedSubjects([])
      setSavedIds([])
      setSavedQuestionLocalIds([])
      const result = await questionsAPI.generateFromNotes(file, {
        subject: subject.trim(),
        count: selectedCount,
        difficulty,
        ...(difficulty === 'Mixed' ? { mixedDifficulty } : {}),
        generateExplanations,
        includeNumericalQuestions,
        topicDistribution: { mode: topicMode, ...(values ? { values } : {}) },
      }, (percent, nextStage) => {
        setProgress(percent)
        setStage(nextStage || 'Processing notes')
      })
      setJobId(result.jobId)
      setQuestions(result.questions.map(mapGeneratedQuestion))
      setTopics(result.topics)
      setDetectedSubjects(result.detectedSubjects || [])
      setWarning(result.warnings.join(' '))
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'Question generation failed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const updateQuestion = (localId: string, update: Partial<ReviewQuestion>) => {
    if (validatingId === localId) return
    setQuestions(previous => previous.map(question =>
      question.localId === localId ? { ...question, ...update } : question,
    ))
  }

  const approveSelected = () => {
    if (editingId || validatingId) return setError('Finish and validate the current edit before approving questions.')
    const selected = questions.filter(question => question.selected)
    if (!selected.length) return setError('Select at least one question to approve.')
    if (selected.some(question => question.validationIssues.length)) {
      return setError('Questions with validation warnings cannot be approved. Regenerate or remove them first.')
    }
    setQuestions(previous => previous.map(question =>
      question.selected ? { ...question, approved: true } : question,
    ))
    setError('')
  }

  const approveAll = () => {
    if (editingId || validatingId) return setError('Finish and validate the current edit before approving questions.')
    if (questions.some(question => question.validationIssues.length)) {
      return setError('Questions with validation warnings cannot be approved. Regenerate or remove them first.')
    }
    setQuestions(previous => previous.map(question => ({
      ...question,
      selected: true,
      approved: true,
    })))
    setError('')
  }

  const toggleSelected = (question: ReviewQuestion) => {
    updateQuestion(question.localId, { selected: !question.selected, approved: false })
  }

  const regenerate = async (question: ReviewQuestion) => {
    if (!jobId) return
    setRegeneratingId(question.localId)
    setError('')
    try {
      const result = await questionsAPI.regenerateNotesQuestion(jobId, question.generationIndex)
      setQuestions(previous => previous.map(item => item.localId === question.localId
        ? { ...result.question, localId: question.localId, generationIndex: question.generationIndex }
        : item,
      ))
    } catch (regenerateError) {
      setError(regenerateError instanceof Error ? regenerateError.message : 'Could not regenerate this question.')
    } finally {
      setRegeneratingId(null)
    }
  }

  const regenerateSelected = async () => {
    const selected = questions.filter(question => question.selected)
    if (!jobId || !selected.length) return setError('Select at least one question to regenerate.')
    setError('')
    const failures: string[] = []
    for (const question of selected) {
      setRegeneratingId(question.localId)
      try {
        const result = await questionsAPI.regenerateNotesQuestion(jobId, question.generationIndex)
        setQuestions(previous => previous.map(item => item.localId === question.localId
          ? { ...result.question, localId: question.localId, generationIndex: question.generationIndex }
          : item,
        ))
      } catch (regenerateError) {
        failures.push(regenerateError instanceof Error ? regenerateError.message : 'A selected question could not be regenerated.')
      }
    }
    setRegeneratingId(null)
    if (failures.length) setError(`${failures.length} question(s) could not be regenerated. ${failures[0]}`)
  }

  const saveApproved = async () => {
    if (!approvedQuestions.length) return setError('Approve at least one question before saving.')
    if (approvedQuestions.some(question => question.validationIssues.length)) {
      return setError('Questions with validation warnings cannot be saved. Regenerate or remove them first.')
    }
    setSaving(true)
    setError('')
    const ids: string[] = []
    const savedLocalIds: string[] = []
    const failures: string[] = []
    for (const question of approvedQuestions) {
      try {
        const saved = await questionsAPI.create({
          subject: question.subject,
          chapter: question.chapter,
          topic: question.topic,
          subTopic: question.subTopic,
          text: question.text,
          options: question.options,
          solution: question.solution,
          correctIndex: question.correctIndex,
          marks: question.marks,
          negativeMarks: question.negativeMarks,
          difficulty: question.difficulty,
          cetDifficulty: question.requestedDifficulty,
          isActive: true,
          sourcePdf: question.sourceDocument,
          sourcePage: question.sourcePage,
        })
        ids.push(saved._id)
        savedLocalIds.push(question.localId)
      } catch (saveError) {
        failures.push(`${question.text.slice(0, 50)}: ${saveError instanceof Error ? saveError.message : 'save failed'}`)
      }
    }
    setSavedIds(previous => [...previous, ...ids])
    setSavedQuestionLocalIds(previous => [...previous, ...savedLocalIds])
    setSaving(false)
    if (failures.length) setError(`Saved ${ids.length} of ${approvedQuestions.length}. ${failures.slice(0, 2).join(' | ')}`)
    else setWarning(`Saved ${ids.length} approved questions into the existing Question Bank.`)
  }

  const beginEdit = (question: ReviewQuestion) => {
    setEditingId(question.localId)
    updateQuestion(question.localId, { approved: false })
  }

  const finishEditing = async (question: ReviewQuestion) => {
    if (!jobId) return setError('This generation session expired. Generate the question again before editing it.')
    setValidatingId(question.localId)
    setError('')
    try {
      const result = await questionsAPI.validateNotesQuestion(jobId, question.generationIndex, {
        subject: question.subject,
        topic: question.topic,
        subTopic: question.subTopic,
        text: question.text,
        options: question.options,
        solution: question.solution,
        correctIndex: question.correctIndex,
        requestedDifficulty: question.requestedDifficulty,
      })
      setQuestions(previous => previous.map(item => item.localId === question.localId
        ? { ...result.question, localId: item.localId, generationIndex: item.generationIndex }
        : item,
      ))
      if (result.question.validationIssues.length) {
        setError('The edited question did not pass validation. Correct the warnings or regenerate it.')
      } else {
        setEditingId(null)
      }
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : 'Could not validate the edited question.')
    } finally {
      setValidatingId(null)
    }
  }

  return (
    <section className="qb-ai-generator" aria-label="Generate questions from notes">
      <div className="qb-ai-header">
        <div>
          <div className="qb-ai-heading"><Sparkles size={21} /><h2>Generate Questions from Notes</h2></div>
          <p>Upload course notes to create source-grounded MCQs for your existing Question Bank.</p>
        </div>
        <button type="button" className="qb-btn qb-btn-outline" onClick={onClose} disabled={busy}>
          <X size={16} /> Back to bulk creation
        </button>
      </div>

      {!questions.length && (
        <div className="qb-ai-config">
          <div className="qb-ai-drop" onClick={() => fileInputRef.current?.click()} onDragOver={event => event.preventDefault()}
            onDrop={event => { event.preventDefault(); selectFile(event.dataTransfer.files[0]) }}>
            <UploadCloud size={30} />
            <strong>{file ? file.name : 'Choose PDF or PowerPoint notes'}</strong>
            <span>{file ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : 'Drag a file here or browse · up to 25 MB'}</span>
            <input ref={fileInputRef} type="file" accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              onChange={event => { selectFile(event.target.files?.[0]); event.target.value = '' }} hidden />
          </div>
          <div className="qb-ai-fields">
            <label>Subject
              <input value={subject} onChange={event => setSubject(event.target.value)} placeholder="e.g. Biology" maxLength={80} />
            </label>
            <label>Number of questions
              <select value={countPreset} onChange={event => setCountPreset(event.target.value)}>
                {allowedCounts.map(count => <option key={count} value={count}>{count}</option>)}
                <option value="custom">Custom</option>
              </select>
            </label>
            {countPreset === 'custom' && <label>Custom count
              <input type="number" min={1} max={100} value={customCount} onChange={event => setCustomCount(Number(event.target.value))} />
            </label>}
            <label>Difficulty
              <select value={difficulty} onChange={event => setDifficulty(event.target.value as NotesGenerationConfig['difficulty'])}>
                {['Medium', 'Hard', 'Very Hard', 'Mixed'].map(value => <option key={value}>{value}</option>)}
              </select>
            </label>
          </div>
          {difficulty === 'Mixed' && <div className="qb-ai-mixed">
            <strong>Mixed difficulty percentages</strong>
            <div>{mixedLevels.map(level => <label key={level}>{level}
              <input type="number" min={0} max={100} value={mixedDifficulty[level]} onChange={event =>
                setMixedDifficulty(previous => ({ ...previous, [level]: Number(event.target.value) }))
              } />%
            </label>)}</div>
            <small>Total: {mixedLevels.reduce((sum, level) => sum + mixedDifficulty[level], 0)}% (must equal 100%)</small>
          </div>}
          <div className="qb-ai-generation-options">
            <label>Generate explanations
              <select value={generateExplanations ? 'on' : 'off'} onChange={event => setGenerateExplanations(event.target.value === 'on')}>
                <option value="on">On</option>
                <option value="off">Off (concise rationale only)</option>
              </select>
            </label>
            <label>Include numerical questions
              <select value={includeNumericalQuestions ? 'on' : 'off'} onChange={event => setIncludeNumericalQuestions(event.target.value === 'on')}>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </label>
          </div>
          <p className="qb-ai-note">A concise answer rationale is always included; numerical solutions show their calculation steps.</p>
          <fieldset className="qb-ai-topic-choice">
            <legend>Topic coverage</legend>
            {(['automatic', 'equal', 'custom'] as const).map(mode => <label key={mode}>
              <input type="radio" name="topic-distribution" checked={topicMode === mode} onChange={() => setTopicMode(mode)} />
              {mode === 'automatic' ? 'Automatic (based on note coverage)' : mode === 'equal' ? 'Equal across detected topics' : 'Custom'}
            </label>)}
            {topicMode === 'custom' && <textarea value={customTopics} onChange={event => setCustomTopics(event.target.value)}
              placeholder={'Enter topics from your notes, one per line:\nCell Division: 40\nGenetics: 60'} rows={3} />}
          </fieldset>
          <p className="qb-ai-note"><AlertCircle size={16} /> The system analyzes document topics first. It won’t fill gaps with outside facts; generation may return fewer questions than requested.</p>
          <button type="button" className="qb-btn qb-btn-primary qb-ai-generate" onClick={() => void generate()} disabled={busy}>
            {busy ? <LoaderCircle className="qb-ai-spinner" size={17} /> : <Sparkles size={17} />}
            {busy ? 'Analyzing notes and generating…' : 'Analyze notes & generate MCQs'}
          </button>
          {busy && <div className="qb-ai-progress">
            <div className="qb-ai-progress-label"><span>{stage}</span><span>{progress}%</span></div>
            <div className="qb-ai-progress-track"><div style={{ width: `${progress}%` }} /></div>
          </div>}
        </div>
      )}

      {error && <div className="qb-ai-alert qb-ai-alert-error" role="alert"><AlertCircle size={17} />{error}</div>}
      {warning && <div className="qb-ai-alert qb-ai-alert-info">{warning}</div>}

      {questions.length > 0 && <>
        <div className="qb-ai-summary">
          <div><strong>{questions.length}</strong><span>generated</span></div>
          <div><strong>{questions.filter(question => !question.validationIssues.length).length}</strong><span>passed automatic validation</span></div>
          <div><strong>{approvedQuestions.length}</strong><span>approved</span></div>
          {savedIds.length > 0 && <div><strong>{savedIds.length}</strong><span>saved to Question Bank</span></div>}
          <button type="button" className="qb-btn qb-btn-outline" onClick={() => {
            setQuestions([])
            setTopics([])
            setJobId('')
            setSavedIds([])
            setSavedQuestionLocalIds([])
            setWarning('')
            setError('')
          }}>New document</button>
        </div>
        {(topics.length > 0 || detectedSubjects.length > 0) && <div className="qb-ai-topics">
          {detectedSubjects.length > 0 && <><strong>Detected subject:</strong> {detectedSubjects.join(' · ')}<br /></>}
          {topics.length > 0 && <><strong>Detected topics:</strong> {topics.map(topic => topic.name).join(' · ')}</>}
        </div>}
        <div className="qb-ai-review-actions">
          <button type="button" onClick={approveAll}><CheckSquare size={15} /> Approve All</button>
          <button type="button" onClick={approveSelected}><Check size={15} /> Approve Selected</button>
          <button type="button" onClick={() => void regenerateSelected()} disabled={regeneratingId !== null}>
            {regeneratingId ? <LoaderCircle className="qb-ai-spinner" size={15} /> : <RefreshCw size={15} />} Regenerate Selected
          </button>
          <button type="button" onClick={() => setQuestions(previous => previous.filter(question => !question.selected))}><Trash2 size={15} /> Delete Selected</button>
          <button type="button" className="qb-ai-save" onClick={() => void saveApproved()} disabled={saving || !approvedQuestions.length}>
            {saving ? <LoaderCircle className="qb-ai-spinner" size={15} /> : <Save size={15} />}
            {saving ? 'Saving…' : 'Save approved to Question Bank'}
          </button>
        </div>
        <div className="qb-ai-question-list">
          {questions.map((question, index) => (
            <article key={question.localId} className={`qb-ai-question ${question.validationIssues.length ? 'has-issues' : ''}`}>
              <div className="qb-ai-question-top">
                <label className="qb-ai-check"><input type="checkbox" checked={question.selected} onChange={() => toggleSelected(question)} /> Select</label>
                <span className={`qb-ai-badge ${question.validationIssues.length ? 'warning' : 'valid'}`}>
                  {question.validationIssues.length ? 'Review required' : question.approved ? 'Approved' : 'Validated'}
                </span>
                <span className="qb-ai-source">{question.sourceDocument} · {question.sourceType === 'slide' ? 'Slide' : 'Page'} {question.sourcePage}</span>
              </div>
              {question.validationIssues.length > 0 && <ul className="qb-ai-issues">{question.validationIssues.map((issue, issueIndex) => <li key={issueIndex}>{issue}</li>)}</ul>}
              {editingId === question.localId ? <>
                <label className="qb-ai-edit-label">Question<textarea value={question.text} onChange={event => updateQuestion(question.localId, { text: event.target.value })} rows={3} /></label>
                {question.options.map((option, optionIndex) => <label className="qb-ai-edit-label" key={optionIndex}>Option {String.fromCharCode(65 + optionIndex)}
                  <input value={option} onChange={event => updateQuestion(question.localId, {
                    options: question.options.map((item, index) => index === optionIndex ? event.target.value : item),
                  })} />
                </label>)}
                <label className="qb-ai-edit-label">Correct answer
                  <select value={question.correctIndex} onChange={event => updateQuestion(question.localId, { correctIndex: Number(event.target.value) })}>
                    {question.options.map((_, optionIndex) => <option key={optionIndex} value={optionIndex}>Option {String.fromCharCode(65 + optionIndex)}</option>)}
                  </select>
                </label>
                <label className="qb-ai-edit-label">Subject<input value={question.subject} onChange={event => updateQuestion(question.localId, { subject: event.target.value })} /></label>
                <label className="qb-ai-edit-label">Topic<input value={question.topic} onChange={event => updateQuestion(question.localId, { topic: event.target.value })} /></label>
                <label className="qb-ai-edit-label">Subtopic<input value={question.subTopic} onChange={event => updateQuestion(question.localId, { subTopic: event.target.value })} /></label>
                <label className="qb-ai-edit-label">Difficulty
                  <select value={question.requestedDifficulty} onChange={event => {
                    const requestedDifficulty = event.target.value as NotesGeneratedQuestion['requestedDifficulty']
                    updateQuestion(question.localId, {
                      requestedDifficulty,
                      difficulty: requestedDifficulty === 'Very Hard' ? 'Hard' : requestedDifficulty,
                    })
                  }}>
                    {['Medium', 'Hard', 'Very Hard'].map(value => <option key={value}>{value}</option>)}
                  </select>
                </label>
                <label className="qb-ai-edit-label">Explanation<textarea value={question.solution} onChange={event => updateQuestion(question.localId, { solution: event.target.value })} rows={2} /></label>
              </> : <>
                <h3>{index + 1}. {question.text}</h3>
                <div className="qb-ai-options">{question.options.map((option, optionIndex) =>
                  <div key={optionIndex} className={question.correctIndex === optionIndex ? 'correct' : ''}>
                    <b>{String.fromCharCode(65 + optionIndex)}.</b> {option} {question.correctIndex === optionIndex && <em>Correct</em>}
                  </div>,
                )}</div>
                <p className="qb-ai-explanation"><strong>Explanation:</strong> {question.solution || 'No explanation supplied.'}</p>
                <p className="qb-ai-meta"><strong>{question.requestedDifficulty}</strong> · {question.topic}{question.subTopic ? ` / ${question.subTopic}` : ''} · confidence {Math.round(question.confidence * 100)}%</p>
                {question.evidence && <blockquote>“{question.evidence}”</blockquote>}
              </>}
              <div className="qb-ai-card-actions">
                {editingId === question.localId
                  ? <button type="button" onClick={() => void finishEditing(question)} disabled={validatingId !== null}>
                    {validatingId === question.localId ? <LoaderCircle className="qb-ai-spinner" size={15} /> : <Check size={15} />}
                    Validate & finish editing
                  </button>
                  : <button type="button" onClick={() => beginEdit(question)}>Edit</button>}
                <button type="button" onClick={() => void regenerate(question)} disabled={regeneratingId !== null}>
                  {regeneratingId === question.localId ? <LoaderCircle className="qb-ai-spinner" size={14} /> : <RefreshCw size={14} />}
                  Regenerate
                </button>
                <button type="button" className="danger" onClick={() => setQuestions(previous => previous.filter(item => item.localId !== question.localId))}>
                  <Trash2 size={14} /> Delete
                </button>
                {!question.approved && <button type="button" disabled={editingId !== null || validatingId !== null} onClick={() => {
                  if (question.validationIssues.length) {
                    setError('This question has validation warnings. Regenerate or remove it before approval.')
                    return
                  }
                  updateQuestion(question.localId, { approved: true, selected: true })
                  setError('')
                }}>
                  <Check size={14} /> Approve
                </button>}
              </div>
            </article>
          ))}
        </div>
        {savedIds.length > 0 && <div className="qb-ai-create-test">
          <div><strong>Questions are in your Question Bank</strong><span>Continue with the existing test creation workflow.</span></div>
          <button type="button" className="qb-btn qb-btn-primary" onClick={() => onCreateTest(savedIds)}>
            <FileText size={16} /> Create Test
          </button>
        </div>}
      </>}
    </section>
  )
}
