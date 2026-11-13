import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BookOpen, Check, CheckCircle2,
  CircleHelp, Clock3, Eye, FileSpreadsheet, FileUp, ImagePlus, LoaderCircle,
  Plus, Save, Search, Settings2, Trash2, Upload, X,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import type { MockTest, Question } from '../lib/api'
import { mockTestAssignmentsAPI, mockTestsAPI, questionsAPI, session } from '../lib/api'
import RichQuestionContent from './RichQuestionContent'
import '../create-test.css'

type TestCategory =
  | 'Full Length Mock Test'
  | 'Subject-wise Test'
  | 'Chapter-wise Test'
  | 'Topic-wise Test'
  | 'Practice Test'
  | 'Previous Year Question Paper'
  | 'Custom Test'

type QuestionType =
  | 'Single Correct MCQ'
  | 'Multiple Correct MCQ'
  | 'Numerical Answer'
  | 'Assertion and Reason'
  | 'Match the Following'
  | 'Passage-Based Questions'
  | 'Image-Based Questions'

type TestSection = {
  id: string
  name: string
  subject: string
  questionIds: string[]
  duration: number | ''
  positiveMarks: number
  negativeMarks: number
}

type TestConfiguration = {
  version: 1
  revision: number
  versions: Array<{
    revision: number
    savedAt: string
    status: MockTest['status']
    questions: number
    marks: number
  }>
  description: string
  category: TestCategory
  targetClass: string
  targetCourse: string
  targetBatch: string
  instructions: string
  thumbnailUrl: string
  startsAt: string
  endsAt: string
  availability: 'all' | 'assigned'
  calculatorAllowed: boolean
  questionNavigation: boolean
  randomizeQuestions: boolean
  randomizeOptions: boolean
  showResultsImmediately: boolean
  allowReview: boolean
  sections: TestSection[]
}

type DraftForm = {
  title: string
  subject: string
  examinationType: string
  difficulty: Question['difficulty']
  duration: number
  maxAttempts: number
  config: TestConfiguration
}

type CreateTestWizardProps = {
  onClose: () => void
  onSaved: () => Promise<void> | void
  initialQuestionIds?: string[]
  initialTest?: MockTest | null
  duplicate?: boolean
}

const CATEGORIES: TestCategory[] = [
  'Full Length Mock Test', 'Subject-wise Test', 'Chapter-wise Test', 'Topic-wise Test',
  'Practice Test', 'Previous Year Question Paper', 'Custom Test',
]
const EXAMINATIONS = ['MHT-CET', 'JEE Main', 'NEET', 'Custom Examination']
const QUESTION_TYPES: QuestionType[] = [
  'Single Correct MCQ', 'Multiple Correct MCQ', 'Numerical Answer',
  'Assertion and Reason', 'Match the Following', 'Passage-Based Questions', 'Image-Based Questions',
]
const DIFFICULTIES: Question['difficulty'][] = ['Easy', 'Medium', 'Hard']
const DRAFT_KEY = `cetnova.create-test.draft.v1:${session.get<{ email?: string; _id?: string }>()?.email || 'admin'}`
const STEPS = ['Basics', 'Configuration', 'Sections & questions', 'Preview', 'Publish']
const createId = () => `section-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const createSection = (name = 'Section A'): TestSection => ({
  id: createId(),
  name,
  subject: '',
  questionIds: [],
  duration: '',
  positiveMarks: 4,
  negativeMarks: 1,
})

const createEmptyForm = (): DraftForm => ({
  title: '',
  subject: '',
  examinationType: 'MHT-CET',
  difficulty: 'Medium',
  duration: 180,
  maxAttempts: 1,
  config: {
    version: 1,
    revision: 1,
    versions: [],
    description: '',
    category: 'Full Length Mock Test',
    targetClass: '',
    targetCourse: '',
    targetBatch: '',
    instructions: '',
    thumbnailUrl: '',
    startsAt: '',
    endsAt: '',
    availability: 'all',
    calculatorAllowed: false,
    questionNavigation: true,
    randomizeQuestions: false,
    randomizeOptions: false,
    showResultsImmediately: true,
    allowReview: true,
    sections: [createSection()],
  },
})

const formatDate = (value: string) => {
  if (!value) return 'Not scheduled'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

const getQuestionType = (question: Question): QuestionType => {
  const type = QUESTION_TYPES.find(item => item.toLowerCase() === question.questionType?.toLowerCase())
  return type || (question.imageUrl ? 'Image-Based Questions' : 'Single Correct MCQ')
}

const getSpreadsheetValue = (row: Record<string, unknown>, ...keys: string[]) => {
  const normalized = new Map(Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ''), value]))
  for (const key of keys) {
    const value = normalized.get(key.toLowerCase().replace(/[^a-z0-9]/g, ''))
    if (value !== undefined && String(value).trim()) return String(value).trim()
  }
  return ''
}

function isDraftForm(value: unknown): value is DraftForm {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<DraftForm>
  return typeof candidate.title === 'string'
    && typeof candidate.subject === 'string'
    && typeof candidate.config?.version === 'number'
    && Array.isArray(candidate.config.sections)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

const formFromTest = (test: MockTest, duplicate: boolean): DraftForm => {
  const empty = createEmptyForm()
  const config = isRecord(test.config) ? test.config : {}
  const sections: TestSection[] = Array.isArray(config.sections) ? config.sections.flatMap((item, index) => {
    if (!isRecord(item)) return []
    return [{
      id: typeof item.id === 'string' ? item.id : createId(),
      name: typeof item.name === 'string' ? item.name : `Section ${String.fromCharCode(65 + index)}`,
      subject: typeof item.subject === 'string' ? item.subject : '',
      questionIds: Array.isArray(item.questionIds) ? item.questionIds.filter((id): id is string => typeof id === 'string') : [],
      duration: typeof item.duration === 'number' ? item.duration : '' as const,
      positiveMarks: Number(item.positiveMarks) > 0 ? Number(item.positiveMarks) : 4,
      negativeMarks: Number(item.negativeMarks) >= 0 ? Number(item.negativeMarks) : 1,
    }]
  }) : []
  const category = CATEGORIES.find(value => value === config.category) || empty.config.category
  const examinationType = EXAMINATIONS.find(value => value === test.examType) || 'MHT-CET'
  return {
    title: duplicate ? `Copy of ${test.title}` : test.title,
    subject: test.subject,
    examinationType,
    difficulty: DIFFICULTIES.find(value => value === test.difficulty) || 'Medium',
    duration: test.duration,
    maxAttempts: test.maxAttempts || 1,
    config: {
      ...empty.config,
      revision: duplicate ? 1 : Number.isInteger(config.revision) && Number(config.revision) > 0 ? Number(config.revision) : 1,
      versions: duplicate || !Array.isArray(config.versions)
        ? []
        : config.versions.filter(isRecord).flatMap(item => {
          const status = (['active', 'scheduled', 'draft'] as const).find(value => value === item.status)
          if (!Number.isInteger(item.revision) || typeof item.savedAt !== 'string' || !status) return []
          return [{
            revision: Number(item.revision),
            savedAt: item.savedAt,
            status,
            questions: Number(item.questions) || 0,
            marks: Number(item.marks) || 0,
          }]
        }),
      description: typeof config.description === 'string' ? config.description : '',
      category,
      targetClass: typeof config.targetClass === 'string' ? config.targetClass : '',
      targetCourse: typeof config.targetCourse === 'string' ? config.targetCourse : '',
      targetBatch: typeof config.targetBatch === 'string' ? config.targetBatch : '',
      instructions: typeof config.instructions === 'string' ? config.instructions : '',
      thumbnailUrl: typeof config.thumbnailUrl === 'string' ? config.thumbnailUrl : '',
      availability: config.availability === 'assigned' ? 'assigned' : 'all',
      calculatorAllowed: config.calculatorAllowed === true,
      questionNavigation: config.questionNavigation !== false,
      randomizeQuestions: config.randomizeQuestions === true,
      randomizeOptions: config.randomizeOptions === true,
      showResultsImmediately: config.showResultsImmediately !== false,
      allowReview: config.allowReview !== false,
      sections: sections.length
        ? sections
        : [{ ...empty.config.sections[0], questionIds: test.questionIds || [] }],
    },
  }
}

export default function CreateTestWizard({ onClose, onSaved, initialQuestionIds = [], initialTest = null, duplicate = false }: CreateTestWizardProps) {
  const [form, setForm] = useState<DraftForm>(() => initialTest ? formFromTest(initialTest, duplicate) : createEmptyForm())
  const [step, setStep] = useState(0)
  const [questions, setQuestions] = useState<Question[]>([])
  const [questionsLoading, setQuestionsLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedTestId, setSavedTestId] = useState(() => initialTest && !duplicate ? initialTest._id : '')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [subjectFilter, setSubjectFilter] = useState('')
  const [chapterFilter, setChapterFilter] = useState('')
  const [topicFilter, setTopicFilter] = useState('')
  const [difficultyFilter, setDifficultyFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [marksFilter, setMarksFilter] = useState('')
  const [questionMode, setQuestionMode] = useState<'bank' | 'manual' | 'import'>('bank')
  const [activeSectionId, setActiveSectionId] = useState('')
  const [previewQuestion, setPreviewQuestion] = useState<Question | null>(null)
  const [examDevice, setExamDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [previewStarted, setPreviewStarted] = useState(false)
  const [previewSubmitted, setPreviewSubmitted] = useState(false)
  const [examQuestionIndex, setExamQuestionIndex] = useState(0)
  const [examAnswers, setExamAnswers] = useState<Record<string, number>>({})
  const [examMarked, setExamMarked] = useState<Record<string, boolean>>({})
  const [examTimeRemaining, setExamTimeRemaining] = useState(form.duration * 60)
  const [manualQuestion, setManualQuestion] = useState({
    text: '',
    subject: '',
    chapter: '',
    topic: '',
    difficulty: 'Medium' as Question['difficulty'],
    type: 'Single Correct MCQ' as QuestionType,
    options: ['', '', '', ''],
    correctIndex: 0,
    solution: '',
    marks: 4,
    negativeMarks: 1,
    imageUrl: '',
  })
  const importInputRef = useRef<HTMLInputElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)
  const thumbnailInputRef = useRef<HTMLInputElement>(null)
  const questionImageInputRef = useRef<HTMLInputElement>(null)
  const initialLoaded = useRef(false)

  const selectedIds = useMemo(() => new Set(form.config.sections.flatMap(section => section.questionIds)), [form.config.sections])
  const selectedQuestions = useMemo(() => questions.filter(question => selectedIds.has(question._id)), [questions, selectedIds])
  const totalQuestions = selectedIds.size
  const totalMarks = form.config.sections.reduce((sum, section) => sum + section.questionIds.length * section.positiveMarks, 0)
  const currentSection = form.config.sections.find(section => section.id === activeSectionId) || form.config.sections[0]
  const filteredQuestions = useMemo(() => questions.filter(question => {
    const query = search.trim().toLowerCase()
    return (!query || `${question.text} ${question.topic} ${question.chapter || ''} ${question._id}`.toLowerCase().includes(query))
      && (!currentSection?.subject || currentSection.subject === 'Mixed' || question.subject === currentSection.subject)
      && (!subjectFilter || question.subject === subjectFilter)
      && (!chapterFilter || question.chapter === chapterFilter)
      && (!topicFilter || question.topic === topicFilter)
      && (!difficultyFilter || question.difficulty === difficultyFilter)
      && (!typeFilter || getQuestionType(question) === typeFilter)
      && (!marksFilter || Number(question.marks) === Number(marksFilter))
  }), [questions, search, subjectFilter, chapterFilter, topicFilter, difficultyFilter, typeFilter, marksFilter, currentSection?.subject])

  const selectedBySubject = useMemo(() => selectedQuestions.reduce<Record<string, number>>((summary, question) => {
    summary[question.subject || 'Other'] = (summary[question.subject || 'Other'] || 0) + 1
    return summary
  }, {}), [selectedQuestions])
  const selectedByDifficulty = useMemo(() => selectedQuestions.reduce<Record<string, number>>((summary, question) => {
    summary[question.difficulty || 'Medium'] = (summary[question.difficulty || 'Medium'] || 0) + 1
    return summary
  }, {}), [selectedQuestions])
  const currentSectionQuestions = currentSection
    ? questions.filter(question => currentSection.questionIds.includes(question._id))
    : []
  const previewQuestions = useMemo(() => form.config.sections.flatMap(section =>
    section.questionIds
      .map(id => questions.find(question => question._id === id))
      .filter((question): question is Question => Boolean(question)),
  ), [form.config.sections, questions])

  const updateForm = (updates: Partial<DraftForm>) => setForm(previous => ({ ...previous, ...updates }))
  const updateConfig = (updates: Partial<TestConfiguration>) => setForm(previous => ({
    ...previous,
    config: { ...previous.config, ...updates },
  }))
  const updateSection = (id: string, updates: Partial<TestSection>) => updateConfig({
    sections: form.config.sections.map(section => section.id === id ? { ...section, ...updates } : section),
  })

  useEffect(() => {
    let active = true
    questionsAPI.getAllAdmin({ isActive: true })
      .then(items => {
        if (!active) return
        setQuestions(items)
        if (initialQuestionIds.length) {
          setForm(previous => ({
            ...previous,
            config: {
              ...previous.config,
              sections: previous.config.sections.map(section => ({ ...section, questionIds: initialQuestionIds })),
            },
          }))
        }
      })
      .catch(loadError => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load the question bank.')
      })
      .finally(() => { if (active) setQuestionsLoading(false) })

    try {
      const saved = window.localStorage.getItem(DRAFT_KEY)
      if (saved && !initialQuestionIds.length && !initialTest) {
        const parsed: unknown = JSON.parse(saved)
        if (isDraftForm(parsed)) {
          setForm(parsed)
          setNotice('Recovered your most recent autosaved test draft.')
          setDraftSavedAt(Date.now())
        }
      }
    } catch (loadError) {
      console.error('Could not recover the saved test draft:', loadError)
      setError('A saved test draft could not be recovered. You can continue with a new test.')
    }
    initialLoaded.current = true
    return () => { active = false }
  }, [initialQuestionIds, initialTest])

  useEffect(() => {
    if (!initialLoaded.current) return
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(form))
        setDraftSavedAt(Date.now())
      } catch (saveError) {
        console.error('Could not autosave the test draft:', saveError)
        setError('Autosave is unavailable in this browser session. Keep this page open until you save the test.')
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [form])

  useEffect(() => {
    if (form.config.sections.length && !form.config.sections.some(section => section.id === activeSectionId)) {
      setActiveSectionId(form.config.sections[0].id)
    }
  }, [form.config.sections, activeSectionId])

  useEffect(() => {
    setPreviewStarted(false)
    setPreviewSubmitted(false)
    setExamQuestionIndex(0)
    setExamAnswers({})
    setExamMarked({})
    setExamTimeRemaining(form.duration * 60)
  }, [step, form.duration])

  useEffect(() => {
    if (step !== 3 || !previewStarted || previewSubmitted || examTimeRemaining <= 0) return
    const timer = window.setInterval(() => setExamTimeRemaining(previous => Math.max(0, previous - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [step, previewStarted, previewSubmitted, examTimeRemaining])

  useEffect(() => {
    if (step === 3 && previewStarted && examTimeRemaining === 0) setPreviewSubmitted(true)
  }, [step, previewStarted, examTimeRemaining])

  const assignQuestion = (question: Question) => {
    if (!currentSection || selectedIds.has(question._id)) return
    const subject = currentSection.subject || question.subject
    updateSection(currentSection.id, {
      subject,
      questionIds: [...currentSection.questionIds, question._id],
    })
  }

  const removeQuestion = (questionId: string) => updateConfig({
    sections: form.config.sections.map(section => ({
      ...section,
      questionIds: section.questionIds.filter(id => id !== questionId),
    })),
  })

  const selectFilteredQuestions = (selected: boolean) => {
    if (!currentSection) return
    const ids = filteredQuestions.filter(question => !selectedIds.has(question._id)).map(question => question._id)
    updateSection(currentSection.id, {
      questionIds: selected
        ? [...currentSection.questionIds, ...ids]
        : currentSection.questionIds.filter(id => !ids.includes(id)),
    })
  }

  const readImage = async (file: File, target: 'thumbnail' | 'question') => {
    if (file.size > 10 * 1024 * 1024) {
      setError('Images must be 10 MB or smaller.')
      return
    }
    try {
      const { imageUrl } = await questionsAPI.uploadQuestionImage(file)
      if (target === 'thumbnail') updateConfig({ thumbnailUrl: imageUrl })
      else setManualQuestion(previous => ({ ...previous, imageUrl }))
      setError('')
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'The image could not be uploaded.')
    }
  }

  const createBankQuestion = async (question: Omit<Question, '_id' | 'createdAt'>) => {
    const created = await questionsAPI.create(question)
    setQuestions(previous => [created, ...previous])
    assignQuestion(created)
  }

  const saveManualQuestion = async () => {
    if (!manualQuestion.text.trim()) {
      setError('Enter the question statement before adding it.')
      return
    }
    const rawOptions = manualQuestion.options.map(option => option.trim())
    const lastOptionIndex = rawOptions.reduce((last, option, index) => option ? index : last, -1)
    const options = manualQuestion.type === 'Numerical Answer' ? [] : rawOptions.slice(0, lastOptionIndex + 1)
    if (manualQuestion.type !== 'Numerical Answer' && options.length < 2) {
      setError('Add at least two answer options.')
      return
    }
    if (options.some(option => !option)) {
      setError('Fill in each option or remove empty options before saving.')
      return
    }
    if (options.length && manualQuestion.correctIndex >= options.length) {
      setError('Choose a correct answer that has an option.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await createBankQuestion({
        subject: manualQuestion.subject || form.subject || 'General',
        chapter: manualQuestion.chapter,
        topic: manualQuestion.topic || 'General',
        text: manualQuestion.text.trim(),
        imageUrl: manualQuestion.imageUrl,
        options,
        solution: manualQuestion.solution,
        correctIndex: manualQuestion.correctIndex,
        marks: Number(manualQuestion.marks),
        negativeMarks: Number(manualQuestion.negativeMarks),
        difficulty: manualQuestion.difficulty,
        questionType: manualQuestion.type,
        isActive: true,
      })
      setManualQuestion({
        text: '', subject: '', chapter: '', topic: '', difficulty: 'Medium',
        type: 'Single Correct MCQ', options: ['', '', '', ''], correctIndex: 0,
        solution: '', marks: 4, negativeMarks: 1, imageUrl: '',
      })
      setQuestionMode('bank')
      setNotice('Question saved to the question bank and added to this section.')
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'The question could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const saveImportedQuestion = async (question: Omit<Question, '_id' | 'createdAt'>) => createBankQuestion(question)

  const importSpreadsheet = async (file: File) => {
    setSaving(true)
    setError('')
    setNotice('')
    let imported = 0
    const failures: string[] = []
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]
        const text = getSpreadsheetValue(row, 'question', 'question statement', 'text')
        const options = [
          getSpreadsheetValue(row, 'option a', 'option1', 'a'),
          getSpreadsheetValue(row, 'option b', 'option2', 'b'),
          getSpreadsheetValue(row, 'option c', 'option3', 'c'),
          getSpreadsheetValue(row, 'option d', 'option4', 'd'),
        ].filter(Boolean)
        if (!text || options.length < 2) {
          failures.push(`Row ${index + 2}: provide a question and at least two options.`)
          continue
        }
        const answer = getSpreadsheetValue(row, 'correct answer', 'answer', 'correct option')
        const answerLabel = /^([a-d])$/i.exec(answer)?.[1]?.toUpperCase()
        const answerNumber = /^\d+$/.test(answer) ? Number(answer) - 1 : -1
        const answerIndex = options.findIndex(option => option.toLowerCase() === answer.toLowerCase())
        const resolvedAnswerIndex = answerIndex >= 0
          ? answerIndex
          : answerLabel ? answerLabel.charCodeAt(0) - 65
            : answerNumber
        if (resolvedAnswerIndex < 0 || resolvedAnswerIndex >= options.length) {
          failures.push(`Row ${index + 2}: the correct answer must match one of the options.`)
          continue
        }
        try {
          await saveImportedQuestion({
            subject: getSpreadsheetValue(row, 'subject') || form.subject || 'General',
            chapter: getSpreadsheetValue(row, 'chapter'),
            topic: getSpreadsheetValue(row, 'topic') || 'General',
            text,
            options,
            correctIndex: resolvedAnswerIndex,
            solution: getSpreadsheetValue(row, 'solution', 'explanation'),
            marks: Number(getSpreadsheetValue(row, 'marks')) || 4,
            negativeMarks: Number(getSpreadsheetValue(row, 'negative marks', 'negativeMarks')) || 0,
            difficulty: (DIFFICULTIES.find(item => item.toLowerCase() === getSpreadsheetValue(row, 'difficulty').toLowerCase()) || 'Medium'),
            questionType: getSpreadsheetValue(row, 'type', 'question type') || 'Single Correct MCQ',
            isActive: true,
          })
          imported += 1
        } catch (importError) {
          failures.push(`Row ${index + 2}: ${importError instanceof Error ? importError.message : 'import failed'}`)
        }
      }
      setNotice(`${imported} question${imported === 1 ? '' : 's'} imported and added to the active section.`)
      if (failures.length) setError(failures.slice(0, 5).join(' '))
      setQuestionMode('bank')
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'The spreadsheet could not be read.')
    } finally {
      setSaving(false)
    }
  }

  const importPdf = async (file: File) => {
    setSaving(true)
    setError('')
    setNotice('Extracting questions from the PDF…')
    let imported = 0
    const failures: string[] = []
    try {
      const result = await questionsAPI.extractPdf(file)
      for (const extracted of result.questions) {
        const options = Object.entries(extracted.options || {})
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([, value]) => value)
          .filter(Boolean)
        try {
          await saveImportedQuestion({
            subject: extracted.subject || form.subject || 'General',
            chapter: extracted.chapter || '',
            topic: extracted.topic || 'General',
            text: extracted.question,
            options,
            correctIndex: Number(extracted.correctIndex) || 0,
            solution: extracted.solution || '',
            marks: 4,
            negativeMarks: 1,
            difficulty: extracted.difficulty || 'Medium',
            questionType: extracted.questionType || 'Single Correct MCQ',
            imageUrl: extracted.imageUrl || '',
            isActive: true,
          })
          imported += 1
        } catch (importError) {
          failures.push(`Question ${extracted.questionNumber}: ${importError instanceof Error ? importError.message : 'import failed'}`)
        }
      }
      setNotice(`${imported} question${imported === 1 ? '' : 's'} extracted and added to the active section.`)
      if (failures.length) setError(failures.slice(0, 5).join(' '))
      setQuestionMode('bank')
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'The PDF could not be processed.')
    } finally {
      setSaving(false)
    }
  }

  const handleFile = (event: ChangeEvent<HTMLInputElement>, callback: (file: File) => void) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void callback(file)
  }

  const validateStep = () => {
    if (step === 0) {
      if (!form.title.trim() || !form.subject.trim()) return 'Enter a test title and choose a subject.'
      if (!form.config.category || !form.examinationType) return 'Choose a test category and examination type.'
    }
    if (step === 1) {
      if (!Number.isInteger(form.duration) || form.duration < 1) return 'Duration must be a whole number greater than zero.'
      if (!Number.isInteger(form.maxAttempts) || form.maxAttempts < 1) return 'Maximum attempts must be at least one.'
      if (form.config.startsAt && form.config.endsAt
        && new Date(form.config.endsAt).getTime() <= new Date(form.config.startsAt).getTime()) {
        return 'The end date must be later than the start date.'
      }
    }
    if (step === 2) {
      if (!form.config.sections.length) return 'Add at least one section.'
      if (form.config.sections.some(section => !section.name.trim())) return 'Give every section a name.'
      if (form.config.sections.some(section => section.positiveMarks <= 0 || section.negativeMarks < 0)) {
        return 'Section marks must be positive and negative marks cannot be below zero.'
      }
    }
    setError('')
    return ''
  }

  const goNext = () => {
    const validation = validateStep()
    if (validation) {
      setError(validation)
      return
    }
    setStep(previous => Math.min(STEPS.length - 1, previous + 1))
  }

  const saveTest = async (status: MockTest['status']) => {
    setError('')
    if (!form.title.trim() || !form.subject.trim()) {
      setStep(0)
      setError('A test title and subject are required before saving.')
      return
    }
    if (status !== 'draft' && totalQuestions < 1) {
      setStep(2)
      setError('Add at least one question before publishing or scheduling.')
      return
    }
    if (!Number.isInteger(form.duration) || form.duration < 1 || !Number.isInteger(form.maxAttempts) || form.maxAttempts < 1) {
      setStep(1)
      setError('Set a valid duration and maximum attempt count.')
      return
    }
    if (status === 'scheduled') {
      if (!form.config.startsAt || new Date(form.config.startsAt).getTime() <= Date.now()) {
        setStep(1)
        setError('Choose a future start date and time for a scheduled test.')
        return
      }
      if (form.config.endsAt && new Date(form.config.endsAt).getTime() <= new Date(form.config.startsAt).getTime()) {
        setStep(1)
        setError('The test end date must be later than its start date.')
        return
      }
    }
    if (status === 'active' && form.config.startsAt && new Date(form.config.startsAt).getTime() > Date.now()) {
      setStep(1)
      setError('This test has a future start time. Use Schedule for later or clear the start date to publish now.')
      return
    }
    if (form.config.availability === 'assigned'
      && (!Number.isInteger(Number(form.config.targetBatch)) || !form.config.targetBatch.trim())) {
      setStep(0)
      setError('Enter a valid batch number to assign this test to a student group.')
      return
    }
    const assignmentStartsAt = status === 'scheduled' ? new Date(form.config.startsAt) : new Date()
    const assignmentEndsAt = form.config.endsAt
      ? new Date(form.config.endsAt)
      : new Date(assignmentStartsAt.getTime() + 365 * 24 * 60 * 60 * 1000)
    if (form.config.availability === 'assigned' && status !== 'draft'
      && (assignmentEndsAt.getTime() <= assignmentStartsAt.getTime() || assignmentEndsAt.getTime() <= Date.now())) {
      setStep(1)
      setError('The assignment end time must be in the future and later than the start time.')
      return
    }

    setSaving(true)
    try {
      const savedConfig: TestConfiguration = {
        ...form.config,
        revision: savedTestId ? form.config.revision + 1 : form.config.revision,
        versions: savedTestId
          ? [...form.config.versions, {
            revision: form.config.revision,
            savedAt: new Date().toISOString(),
            status,
            questions: totalQuestions,
            marks: totalMarks,
          }]
          : form.config.versions,
      }
      const payload = {
        title: form.title.trim(),
        subject: form.subject.trim(),
        examType: form.examinationType,
        difficulty: form.difficulty,
        questions: totalQuestions,
        duration: form.duration,
        maxAttempts: form.maxAttempts,
        questionIds: [...selectedIds],
        status,
        scheduledDate: status === 'scheduled' ? new Date(form.config.startsAt).toISOString() : undefined,
        createdBy: 'Administrator',
        config: savedConfig,
      }
      const savedTest = savedTestId
        ? await mockTestsAPI.update(savedTestId, payload)
        : await mockTestsAPI.create(payload)
      setSavedTestId(savedTest._id)
      setForm(previous => ({ ...previous, config: savedConfig }))
      if (form.config.availability === 'assigned' && status !== 'draft') {
        await mockTestAssignmentsAPI.create({
          mockTestId: savedTest._id,
          assignedTo: 'batch',
          batchId: Number(form.config.targetBatch),
          startDateTime: assignmentStartsAt.toISOString(),
          endDateTime: assignmentEndsAt.toISOString(),
          duration: form.duration,
          attemptLimit: form.maxAttempts,
          timeZone: 'Asia/Kolkata',
          visibility: assignmentStartsAt.getTime() > Date.now() ? 'scheduled' : 'available',
          resultVisibility: form.config.showResultsImmediately ? 'immediate' : 'after_close',
          randomizeQuestions: form.config.randomizeQuestions,
          randomizeOptions: form.config.randomizeOptions,
          allowBackNavigation: form.config.questionNavigation,
          allowResume: true,
        })
      }
      window.localStorage.removeItem(DRAFT_KEY)
      setNotice(status === 'draft' ? 'Draft saved successfully.' : status === 'scheduled' ? 'Test scheduled successfully.' : 'Test published successfully.')
      await onSaved()
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The test could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const addSection = () => {
    const section = createSection(`Section ${String.fromCharCode(65 + form.config.sections.length)}`)
    updateConfig({ sections: [...form.config.sections, section] })
    setActiveSectionId(section.id)
  }

  const moveSection = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= form.config.sections.length) return
    const sections = [...form.config.sections]
    ;[sections[index], sections[target]] = [sections[target], sections[index]]
    updateConfig({ sections })
  }

  const renderBasics = () => (
    <div className="ctw-grid ctw-grid--two">
      <label className="ctw-field ctw-field--wide">Test title <span aria-hidden="true">*</span>
        <input autoFocus value={form.title} maxLength={140} onChange={event => updateForm({ title: event.target.value })} placeholder="e.g. MHT-CET Full Length Mock 01" />
      </label>
      <label className="ctw-field ctw-field--wide">Description
        <textarea value={form.config.description} rows={3} onChange={event => updateConfig({ description: event.target.value })} placeholder="Set expectations and context for students" />
      </label>
      <label className="ctw-field">Test category
        <select value={form.config.category} onChange={event => updateConfig({ category: event.target.value as TestCategory })}>
          {CATEGORIES.map(category => <option key={category}>{category}</option>)}
        </select>
      </label>
      <label className="ctw-field">Examination type
        <select value={form.examinationType} onChange={event => updateForm({ examinationType: event.target.value })}>
          {EXAMINATIONS.map(exam => <option key={exam}>{exam}</option>)}
        </select>
      </label>
      <label className="ctw-field">Target class
        <select value={form.config.targetClass} onChange={event => updateConfig({ targetClass: event.target.value })}>
          <option value="">All classes</option><option>11</option><option>12</option><option>11 &amp; 12</option>
        </select>
      </label>
      <label className="ctw-field">Target course
        <select value={form.config.targetCourse} onChange={event => updateConfig({ targetCourse: event.target.value })}>
          <option value="">All courses</option><option>Engineering</option><option>Medical</option><option>Pharmacy</option><option>Other</option>
        </select>
      </label>
      <label className="ctw-field">Target batch
        <input type="number" step={1} value={form.config.targetBatch} onChange={event => updateConfig({ targetBatch: event.target.value })} placeholder="e.g. 2026" />
      </label>
      <label className="ctw-field">Subject <span aria-hidden="true">*</span>
        <select value={form.subject} onChange={event => updateForm({ subject: event.target.value })}>
          <option value="">Select a subject</option>
          {[...new Set([...questions.map(question => question.subject), 'Physics', 'Chemistry', 'Mathematics', 'Biology'])].filter(Boolean).map(subject => <option key={subject}>{subject}</option>)}
          <option>Mixed</option>
        </select>
      </label>
      <label className="ctw-field">Difficulty
        <select value={form.difficulty} onChange={event => updateForm({ difficulty: event.target.value as Question['difficulty'] })}>
          {DIFFICULTIES.map(difficulty => <option key={difficulty}>{difficulty}</option>)}
        </select>
      </label>
      <label className="ctw-field ctw-field--wide">Test instructions
        <textarea rows={4} value={form.config.instructions} onChange={event => updateConfig({ instructions: event.target.value })} placeholder="Explain the rules students need to know before starting." />
      </label>
      <div className="ctw-field ctw-field--wide">
        <span>Test thumbnail <small>(optional)</small></span>
        <div className="ctw-upload-row">
          <button type="button" className="ctw-button ctw-button--subtle" onClick={() => thumbnailInputRef.current?.click()}><ImagePlus size={16} />{form.config.thumbnailUrl ? 'Replace image' : 'Upload image'}</button>
          {form.config.thumbnailUrl && <img className="ctw-thumbnail" src={form.config.thumbnailUrl} alt="Test thumbnail preview" />}
          <input ref={thumbnailInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => handleFile(event, file => readImage(file, 'thumbnail'))} />
        </div>
      </div>
    </div>
  )

  const renderConfiguration = () => (
    <div className="ctw-config-layout">
      <div className="ctw-grid ctw-grid--two">
        <label className="ctw-field">Duration (minutes)
          <input type="number" min={1} value={form.duration} onChange={event => updateForm({ duration: Number(event.target.value) })} />
        </label>
        <label className="ctw-field">Maximum attempts
          <input type="number" min={1} step={1} value={form.maxAttempts} onChange={event => updateForm({ maxAttempts: Number(event.target.value) })} />
        </label>
        <label className="ctw-field">Start date &amp; time <small>(schedule later)</small>
          <input type="datetime-local" value={form.config.startsAt} onChange={event => updateConfig({ startsAt: event.target.value })} />
        </label>
        <label className="ctw-field">End date &amp; time
          <input type="datetime-local" value={form.config.endsAt} onChange={event => updateConfig({ endsAt: event.target.value })} />
        </label>
      </div>
      <div className="ctw-settings-list">
        <h3>Exam behavior</h3>
        {([
          ['calculatorAllowed', 'Calculator available', 'Allow an on-screen calculator during the exam.'],
          ['questionNavigation', 'Question navigation', 'Let students move between questions.'],
          ['randomizeQuestions', 'Randomize questions', 'Use a different question order for each student.'],
          ['randomizeOptions', 'Randomize answer options', 'Shuffle choices for each student.'],
          ['showResultsImmediately', 'Show results immediately', 'Display the result after submission.'],
          ['allowReview', 'Allow review after submission', 'Let students revisit submitted answers.'],
        ] as const).map(([key, label, description]) => (
          <label className="ctw-switch-row" key={key}>
            <span><strong>{label}</strong><small>{description}</small></span>
            <input type="checkbox" checked={form.config[key]} onChange={event => updateConfig({ [key]: event.target.checked })} />
          </label>
        ))}
        <label className="ctw-field ctw-field--inline">Test availability
          <select value={form.config.availability} onChange={event => updateConfig({ availability: event.target.value as TestConfiguration['availability'] })}>
            <option value="all">All eligible students</option>
            <option value="assigned">Assigned students only</option>
          </select>
        </label>
      </div>
    </div>
  )

  const renderSectionsAndQuestions = () => (
    <div className="ctw-question-layout">
      <div className="ctw-sections-panel">
        <div className="ctw-panel-heading"><h3>Sections</h3><button type="button" className="ctw-icon-button" onClick={addSection} aria-label="Add section"><Plus size={17} /></button></div>
        {form.config.sections.map((section, index) => (
          <div className={`ctw-section-item${currentSection?.id === section.id ? ' is-active' : ''}`} key={section.id}>
            <button type="button" className="ctw-section-select" onClick={() => setActiveSectionId(section.id)}>
              <span>{section.name || `Section ${index + 1}`}</span><small>{section.questionIds.length} questions</small>
            </button>
            <div className="ctw-section-actions">
              <button type="button" className="ctw-icon-button" onClick={() => moveSection(index, -1)} aria-label="Move section up" disabled={!index}><ArrowUp size={14} /></button>
              <button type="button" className="ctw-icon-button" onClick={() => moveSection(index, 1)} aria-label="Move section down" disabled={index === form.config.sections.length - 1}><ArrowDown size={14} /></button>
              <button type="button" className="ctw-icon-button ctw-icon-button--danger" aria-label="Delete section" disabled={form.config.sections.length === 1} onClick={() => updateConfig({ sections: form.config.sections.filter(item => item.id !== section.id) })}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
        {currentSection && (
          <div className="ctw-section-settings">
            <label className="ctw-field">Section name<input value={currentSection.name} onChange={event => updateSection(currentSection.id, { name: event.target.value })} /></label>
            <label className="ctw-field">Subject
              <select value={currentSection.subject} onChange={event => updateSection(currentSection.id, { subject: event.target.value })}>
                <option value="">Choose subject</option>{[...new Set(questions.map(question => question.subject).filter(Boolean))].map(subject => <option key={subject}>{subject}</option>)}
                <option>Mixed</option>
              </select>
            </label>
            <div className="ctw-grid ctw-grid--two">
              <label className="ctw-field">Positive marks<input type="number" min={0.25} step={0.25} value={currentSection.positiveMarks} onChange={event => updateSection(currentSection.id, { positiveMarks: Number(event.target.value) })} /></label>
              <label className="ctw-field">Negative marks<input type="number" min={0} step={0.25} value={currentSection.negativeMarks} onChange={event => updateSection(currentSection.id, { negativeMarks: Number(event.target.value) })} /></label>
            </div>
            <label className="ctw-field">Section duration (minutes)<input type="number" min={1} value={currentSection.duration} onChange={event => updateSection(currentSection.id, { duration: event.target.value ? Number(event.target.value) : '' })} placeholder="Use full test duration" /></label>
            <div className="ctw-section-total"><span>{currentSection.questionIds.length} questions</span><strong>{currentSection.questionIds.length * currentSection.positiveMarks} marks</strong></div>
          </div>
        )}
      </div>
      <div className="ctw-bank-panel">
        <div className="ctw-mode-tabs" role="tablist" aria-label="Question source">
          <button type="button" className={questionMode === 'bank' ? 'is-active' : ''} onClick={() => setQuestionMode('bank')}><BookOpen size={16} />Question bank</button>
          <button type="button" className={questionMode === 'manual' ? 'is-active' : ''} onClick={() => setQuestionMode('manual')}><Plus size={16} />New question</button>
          <button type="button" className={questionMode === 'import' ? 'is-active' : ''} onClick={() => setQuestionMode('import')}><Upload size={16} />Import</button>
        </div>
        {questionMode === 'bank' && (
          <>
            <div className="ctw-filter-grid">
              <label className="ctw-search"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search questions, topics or IDs" /></label>
              <select aria-label="Filter by subject" value={subjectFilter} onChange={event => { setSubjectFilter(event.target.value); setChapterFilter(''); setTopicFilter('') }}>
                <option value="">All subjects</option>{[...new Set(questions.map(question => question.subject).filter(Boolean))].map(subject => <option key={subject}>{subject}</option>)}
              </select>
              <select aria-label="Filter by chapter" value={chapterFilter} onChange={event => { setChapterFilter(event.target.value); setTopicFilter('') }}>
                <option value="">All chapters</option>{[...new Set(questions.filter(question => !subjectFilter || question.subject === subjectFilter).map(question => question.chapter).filter(Boolean))].map(chapter => <option key={chapter}>{chapter}</option>)}
              </select>
              <select aria-label="Filter by topic" value={topicFilter} onChange={event => setTopicFilter(event.target.value)}>
                <option value="">All topics</option>{[...new Set(questions.filter(question => (!subjectFilter || question.subject === subjectFilter) && (!chapterFilter || question.chapter === chapterFilter)).map(question => question.topic).filter(Boolean))].map(topic => <option key={topic}>{topic}</option>)}
              </select>
              <select aria-label="Filter by difficulty" value={difficultyFilter} onChange={event => setDifficultyFilter(event.target.value)}><option value="">All difficulties</option>{DIFFICULTIES.map(value => <option key={value}>{value}</option>)}</select>
              <select aria-label="Filter by type" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}><option value="">All types</option>{QUESTION_TYPES.map(value => <option key={value}>{value}</option>)}</select>
              <select aria-label="Filter by marks" value={marksFilter} onChange={event => setMarksFilter(event.target.value)}><option value="">Any marks</option>{[1, 2, 3, 4, 5, 6].map(value => <option key={value} value={value}>{value} marks</option>)}</select>
            </div>
            <div className="ctw-selection-toolbar"><span>{filteredQuestions.length} questions · {currentSection?.questionIds.length || 0} in this section</span><button type="button" className="ctw-text-button" disabled={!filteredQuestions.length} onClick={() => selectFilteredQuestions(true)}>Select all filtered</button></div>
            {questionsLoading ? <div className="ctw-empty"><LoaderCircle className="ctw-spin" />Loading the active question bank…</div>
              : filteredQuestions.length ? <div className="ctw-question-list">
                {filteredQuestions.map(question => {
                  const selected = selectedIds.has(question._id)
                  return <article className={`ctw-question-card${selected ? ' is-selected' : ''}`} key={question._id}>
                    <label className="ctw-question-check"><input type="checkbox" checked={selected} disabled={selected} onChange={() => assignQuestion(question)} /><span>{question.subject} · {question.chapter || 'Unclassified'} · {question.difficulty}</span></label>
                    <div className="ctw-question-statement"><RichQuestionContent content={question.text} /></div>
                    <div className="ctw-question-meta"><span>{getQuestionType(question)}</span><span>{question.marks} marks</span><button type="button" className="ctw-text-button" onClick={() => setPreviewQuestion(question)}><Eye size={14} />Preview</button>
                      {!selected && <button type="button" className="ctw-text-button" onClick={() => assignQuestion(question)}>Add</button>}
                    </div>
                  </article>
                })}
              </div> : <div className="ctw-empty"><CircleHelp size={20} />No active questions match these filters.</div>}
            {currentSectionQuestions.length > 0 && <div className="ctw-current-section-list"><strong>Selected in {currentSection?.name}</strong>{currentSectionQuestions.map((question, index) => <div key={question._id}><span>{index + 1}. {question.text.slice(0, 90)}</span><button type="button" aria-label="Remove question" onClick={() => removeQuestion(question._id)}><X size={14} /></button></div>)}</div>}
          </>
        )}
        {questionMode === 'manual' && (
          <div className="ctw-manual-form">
            <label className="ctw-field ctw-field--wide">Question statement<textarea rows={4} value={manualQuestion.text} onChange={event => setManualQuestion(previous => ({ ...previous, text: event.target.value }))} placeholder="Enter the question. Math notation and plain text are supported." /></label>
            <div className="ctw-grid ctw-grid--two">
              <label className="ctw-field">Question type<select value={manualQuestion.type} onChange={event => setManualQuestion(previous => ({ ...previous, type: event.target.value as QuestionType }))}>{QUESTION_TYPES.map(type => <option key={type}>{type}</option>)}</select></label>
              <label className="ctw-field">Difficulty<select value={manualQuestion.difficulty} onChange={event => setManualQuestion(previous => ({ ...previous, difficulty: event.target.value as Question['difficulty'] }))}>{DIFFICULTIES.map(value => <option key={value}>{value}</option>)}</select></label>
              <label className="ctw-field">Subject<input value={manualQuestion.subject} onChange={event => setManualQuestion(previous => ({ ...previous, subject: event.target.value }))} placeholder={form.subject || 'Physics'} /></label>
              <label className="ctw-field">Chapter<input value={manualQuestion.chapter} onChange={event => setManualQuestion(previous => ({ ...previous, chapter: event.target.value }))} /></label>
              <label className="ctw-field">Topic<input value={manualQuestion.topic} onChange={event => setManualQuestion(previous => ({ ...previous, topic: event.target.value }))} /></label>
              <label className="ctw-field">Marks<input type="number" min={0.25} step={0.25} value={manualQuestion.marks} onChange={event => setManualQuestion(previous => ({ ...previous, marks: Number(event.target.value) }))} /></label>
              <label className="ctw-field">Negative marks<input type="number" min={0} step={0.25} value={manualQuestion.negativeMarks} onChange={event => setManualQuestion(previous => ({ ...previous, negativeMarks: Number(event.target.value) }))} /></label>
            </div>
            {manualQuestion.type !== 'Numerical Answer' &&             <div className="ctw-options-editor"><strong>Answer options</strong>{manualQuestion.options.map((option, index) => <div key={index}><input value={option} onChange={event => setManualQuestion(previous => ({ ...previous, options: previous.options.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} placeholder={`Option ${String.fromCharCode(65 + index)}`} /><label><input type="radio" name="ctw-correct-answer" checked={manualQuestion.correctIndex === index} onChange={() => setManualQuestion(previous => ({ ...previous, correctIndex: index }))} />Correct</label><button type="button" className="ctw-icon-button" aria-label="Remove option" disabled={manualQuestion.options.length <= 2} onClick={() => setManualQuestion(previous => ({ ...previous, options: previous.options.filter((_, optionIndex) => optionIndex !== index), correctIndex: previous.correctIndex > index ? previous.correctIndex - 1 : Math.min(previous.correctIndex, previous.options.length - 2) }))}><Trash2 size={14} /></button></div>)}<button type="button" className="ctw-text-button" onClick={() => setManualQuestion(previous => ({ ...previous, options: [...previous.options, ''] }))}><Plus size={14} />Add option</button></div>}
            <label className="ctw-field ctw-field--wide">Detailed solution<textarea rows={3} value={manualQuestion.solution} onChange={event => setManualQuestion(previous => ({ ...previous, solution: event.target.value }))} /></label>
            <div className="ctw-upload-row"><button type="button" className="ctw-button ctw-button--subtle" onClick={() => questionImageInputRef.current?.click()}><ImagePlus size={16} />Attach question image</button>{manualQuestion.imageUrl && <img className="ctw-thumbnail" src={manualQuestion.imageUrl} alt="Question attachment preview" />}<input ref={questionImageInputRef} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => handleFile(event, file => readImage(file, 'question'))} /></div>
            <button type="button" className="ctw-button ctw-button--primary" disabled={saving} onClick={() => void saveManualQuestion()}>{saving ? <LoaderCircle className="ctw-spin" size={16} /> : <Save size={16} />}Save question and add to section</button>
          </div>
        )}
        {questionMode === 'import' && (
          <div className="ctw-import-options">
            <div className="ctw-import-card"><FileSpreadsheet size={22} /><h3>Excel or CSV</h3><p>Import questions with columns for question, subject, chapter, topic, options A–D, correct answer, marks, difficulty and solution.</p><button type="button" className="ctw-button ctw-button--subtle" disabled={saving} onClick={() => importInputRef.current?.click()}><Upload size={16} />Choose spreadsheet</button></div>
            <div className="ctw-import-card"><FileUp size={22} /><h3>Question paper PDF</h3><p>Use the existing PDF extraction service to read questions and answer options into the question bank.</p><button type="button" className="ctw-button ctw-button--subtle" disabled={saving} onClick={() => pdfInputRef.current?.click()}><Upload size={16} />Choose PDF</button></div>
            <input ref={importInputRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={event => handleFile(event, importSpreadsheet)} />
            <input ref={pdfInputRef} type="file" accept=".pdf" hidden onChange={event => handleFile(event, importPdf)} />
            {saving && <p className="ctw-import-progress"><LoaderCircle className="ctw-spin" size={16} />{notice || 'Importing questions…'}</p>}
          </div>
        )}
      </div>
    </div>
  )

  const renderPreview = () => (
    <div className="ctw-preview-layout">
      <div className="ctw-preview-controls">
        <div><strong>Student exam preview</strong><small>Interactive preview with configured instructions, timer and question palette.</small></div>
        <div className="ctw-device-switch">
          <button type="button" className={examDevice === 'desktop' ? 'is-active' : ''} onClick={() => setExamDevice('desktop')}>Desktop</button>
          <button type="button" className={examDevice === 'mobile' ? 'is-active' : ''} onClick={() => setExamDevice('mobile')}>Mobile</button>
        </div>
      </div>
      <div className={`ctw-exam-shell ctw-exam-shell--${examDevice}`}>
        <header>
          <span>{form.title || 'Untitled examination'}</span>
          <strong><Clock3 size={15} />{String(Math.floor(examTimeRemaining / 60)).padStart(2, '0')}:{String(examTimeRemaining % 60).padStart(2, '0')}</strong>
        </header>
        {previewStarted && previewQuestions.length > 0 && !previewSubmitted ? (() => {
          const currentQuestion = previewQuestions[examQuestionIndex] || previewQuestions[0]
          const section = form.config.sections.find(item => item.questionIds.includes(currentQuestion._id))
          return (
            <div className="ctw-exam-body">
              <nav aria-label="Question palette">
                {previewQuestions.map((question, index) => (
                  <button
                    type="button"
                    key={question._id}
                    onClick={() => setExamQuestionIndex(index)}
                    className={`${examQuestionIndex === index ? 'is-active ' : ''}${examMarked[question._id] ? 'is-marked ' : ''}${examAnswers[question._id] !== undefined ? 'is-answered' : ''}`.trim()}
                  >{index + 1}</button>
                ))}
              </nav>
              <article>
                <small>{section?.name || 'Section'} · Question {examQuestionIndex + 1}</small>
                <RichQuestionContent content={currentQuestion.text} />
                {currentQuestion.imageUrl && <img className="ctw-exam-question-image" src={currentQuestion.imageUrl} alt={currentQuestion.imageAltText || 'Question illustration'} />}
                {currentQuestion.options.map((option, index) => (
                  <label key={index}>
                    <input
                      type="radio"
                      name={`ctw-preview-answer-${currentQuestion._id}`}
                      checked={examAnswers[currentQuestion._id] === index}
                      onChange={() => setExamAnswers(previous => ({ ...previous, [currentQuestion._id]: index }))}
                    />
                    <RichQuestionContent content={option} />
                  </label>
                ))}
                <div className="ctw-exam-actions">
                  <button type="button" className="ctw-button ctw-button--subtle" disabled={examQuestionIndex === 0} onClick={() => setExamQuestionIndex(index => Math.max(0, index - 1))}><ArrowLeft size={15} />Previous</button>
                  <button type="button" className={`ctw-button ${examMarked[currentQuestion._id] ? 'ctw-button--marked' : 'ctw-button--subtle'}`} onClick={() => setExamMarked(previous => ({ ...previous, [currentQuestion._id]: !previous[currentQuestion._id] }))}>{examMarked[currentQuestion._id] ? 'Marked for review' : 'Mark for review'}</button>
                  {examQuestionIndex < previewQuestions.length - 1
                    ? <button type="button" className="ctw-button ctw-button--primary" onClick={() => setExamQuestionIndex(index => Math.min(previewQuestions.length - 1, index + 1))}>Save &amp; next<ArrowRight size={15} /></button>
                    : <button type="button" className="ctw-button ctw-button--primary" onClick={() => setPreviewSubmitted(true)}>Submit preview<Check size={15} /></button>}
                </div>
              </article>
            </div>
          )
        })() : previewSubmitted ? (
          <div className="ctw-preview-instructions">
            <CheckCircle2 size={26} color="#27805a" /><h2>Preview submitted</h2><p>This was a local preview. No student result was recorded.</p>
            <div className="ctw-preview-stats">
              <span><strong>{Object.keys(examAnswers).length}</strong>Answered</span>
              <span><strong>{previewQuestions.length - Object.keys(examAnswers).length}</strong>Unanswered</span>
              <span><strong>{Object.values(examMarked).filter(Boolean).length}</strong>For review</span>
            </div>
            <button type="button" className="ctw-button ctw-button--subtle" onClick={() => { setPreviewSubmitted(false); setPreviewStarted(false) }}>Return to instructions</button>
          </div>
        ) : (
          <div className="ctw-preview-instructions">
            <span className="ctw-preview-brand">CETNova · {form.examinationType}</span>
            <h2>{form.title || 'Your test title'}</h2>
            <p>{form.config.description || 'Review these instructions before you begin.'}</p>
            <div className="ctw-instructions-copy">{form.config.instructions || `• The test has a fixed time limit.
• Check your answers before submitting.
• Your progress is saved as you move between questions.`}</div>
            <div className="ctw-preview-stats">
              <span><strong>{totalQuestions}</strong>Questions</span>
              <span><strong>{totalMarks}</strong>Marks</span>
              <span><strong>{form.duration}</strong>Minutes</span>
            </div>
            {previewQuestions.length
              ? <button type="button" className="ctw-button ctw-button--primary" onClick={() => setPreviewStarted(true)}>Begin examination<ArrowRight size={15} /></button>
              : <p>Add questions to preview the exam navigation.</p>}
          </div>
        )}
      </div>
    </div>
  )

  const renderPublish = () => (
    <div className="ctw-publish">
      <div className="ctw-publish-intro"><CheckCircle2 size={22} /><div><h3>Everything ready?</h3><p>Review the examination details before saving, publishing or scheduling it.</p></div></div>
      <div className="ctw-publish-summary">
        <div><small>Test · Version {form.config.revision}</small><strong>{form.title || 'Untitled test'}</strong><span>{form.config.category} · {form.examinationType}</span></div>
        <div><small>Questions &amp; marks</small><strong>{totalQuestions} questions · {totalMarks} marks</strong><span>{form.config.sections.length} section{form.config.sections.length === 1 ? '' : 's'}</span></div>
        <div><small>Duration</small><strong>{form.duration} minutes</strong><span>{form.maxAttempts} attempt{form.maxAttempts === 1 ? '' : 's'}</span></div>
        <div><small>Schedule</small><strong>{form.config.startsAt ? formatDate(form.config.startsAt) : 'Available immediately'}</strong><span>{form.config.endsAt ? `Closes ${formatDate(form.config.endsAt)}` : 'No closing date'}</span></div>
        <div><small>Target students</small><strong>{[form.config.targetClass && `Class ${form.config.targetClass}`, form.config.targetCourse, form.config.targetBatch && `Batch ${form.config.targetBatch}`].filter(Boolean).join(' · ') || 'All eligible students'}</strong><span>{form.config.availability === 'assigned' ? 'Assigned students only' : 'Open to eligible students'}</span></div>
        <div className="ctw-publish-sections"><small>Sections</small>{form.config.sections.map(section => <span key={section.id}><strong>{section.name}</strong> · {section.subject || 'Mixed subject'} · {section.questionIds.length} questions · {section.questionIds.length * section.positiveMarks} marks</span>)}</div>
      </div>
      <div className="ctw-publish-actions"><button type="button" className="ctw-button ctw-button--subtle" disabled={saving} onClick={() => void saveTest('draft')}><Save size={16} />Save as draft</button><button type="button" className="ctw-button ctw-button--subtle" disabled={saving} onClick={() => void saveTest('scheduled')}><Clock3 size={16} />Schedule for later</button><button type="button" className="ctw-button ctw-button--primary" disabled={saving} onClick={() => void saveTest('active')}>{saving ? <LoaderCircle className="ctw-spin" size={16} /> : <Check size={16} />}Publish immediately</button></div>
    </div>
  )

  const stepContent = [renderBasics, renderConfiguration, renderSectionsAndQuestions, renderPreview, renderPublish][step]()

  return (
    <div className="ctw-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose() }}>
      <section className="ctw-dialog" role="dialog" aria-modal="true" aria-labelledby="ctw-title">
        <header className="ctw-header"><div><span className="ctw-eyebrow">CETNova · EXAM BUILDER</span><h1 id="ctw-title">Create a test</h1></div><div className="ctw-header-actions"><span className="ctw-autosave">{draftSavedAt ? `Autosaved ${new Date(draftSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Autosaving…'}</span><button type="button" className="ctw-icon-button" aria-label="Close test builder" disabled={saving} onClick={onClose}><X size={20} /></button></div></header>
        <div className="ctw-stepper" aria-label="Test creation progress">{STEPS.map((label, index) => <button type="button" key={label} className={`ctw-step${step === index ? ' is-active' : ''}${step > index ? ' is-complete' : ''}`} onClick={() => { if (index < step) setStep(index); else if (index === step + 1) goNext() }}><span>{step > index ? <Check size={14} /> : index + 1}</span><small>{label}</small></button>)}</div>
        <main className="ctw-main"><div className="ctw-content"><div className="ctw-step-heading"><span>STEP {step + 1} OF {STEPS.length} · VERSION {form.config.revision}</span><h2>{STEPS[step]}</h2><p>{['Name your test and decide who it is for.', 'Set timing, marking and the student experience.', 'Organize sections and build your question set.', 'See the configured experience before publishing.', 'Confirm test details and choose how to release it.'][step]}</p></div>
          {error && <div className="ctw-alert ctw-alert--error" role="alert">{error}</div>}
          {notice && !error && <div className="ctw-alert ctw-alert--success" role="status">{notice}</div>}
          {stepContent}
          <div className="ctw-mobile-summary"><strong>{totalQuestions} questions</strong><span>{totalMarks} marks</span><span>{form.duration} min</span></div>
          <div className="ctw-footer"><button type="button" className="ctw-button ctw-button--subtle" onClick={step ? () => setStep(previous => previous - 1) : onClose}>{step ? <><ArrowLeft size={16} />Back</> : 'Cancel'}</button><div className="ctw-footer-right">{step < STEPS.length - 1 && <button type="button" className="ctw-button ctw-button--primary" onClick={goNext}>Continue<ArrowRight size={16} /></button>}{step === STEPS.length - 1 && saving && <span className="ctw-saving"><LoaderCircle className="ctw-spin" size={16} />Saving test…</span>}</div></div>
        </div>
        <aside className="ctw-summary"><div className="ctw-summary-card"><div className="ctw-summary-heading"><span><Settings2 size={16} />Live summary</span><span className="ctw-live-dot" /></div><h3>{form.title || 'Untitled test'}</h3><p>{form.subject || 'Choose a subject'} · {form.examinationType}</p><div className="ctw-summary-metrics"><span><strong>{totalQuestions}</strong>Questions</span><span><strong>{totalMarks}</strong>Marks</span><span><strong>{form.duration}</strong>Minutes</span></div><div className="ctw-summary-sections">{form.config.sections.map(section => <div key={section.id}><span>{section.name || 'Section'}</span><strong>{section.questionIds.length} Q · {section.questionIds.length * section.positiveMarks} marks</strong></div>)}</div><div className="ctw-summary-distribution"><strong>Subject distribution</strong>{Object.entries(selectedBySubject).map(([subject, count]) => <span key={subject}>{subject}<b>{count}</b></span>)}{!Object.keys(selectedBySubject).length && <small>Add questions to see the breakdown.</small>}</div><div className="ctw-summary-distribution"><strong>Difficulty</strong>{Object.entries(selectedByDifficulty).map(([difficulty, count]) => <span key={difficulty}>{difficulty}<b>{count}</b></span>)}{!Object.keys(selectedByDifficulty).length && <small>Difficulty breakdown appears as questions are added.</small>}</div><div className="ctw-summary-footer"><span><Clock3 size={14} />{form.config.startsAt ? formatDate(form.config.startsAt) : 'Available immediately'}</span><span>{form.maxAttempts} attempt{form.maxAttempts === 1 ? '' : 's'}</span></div></div></aside></main>
      </section>
      {previewQuestion && <div className="ctw-preview-modal" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPreviewQuestion(null) }}><section role="dialog" aria-modal="true" aria-labelledby="ctw-question-preview"><header><h2 id="ctw-question-preview">Question preview</h2><button type="button" className="ctw-icon-button" onClick={() => setPreviewQuestion(null)} aria-label="Close question preview"><X size={18} /></button></header><RichQuestionContent content={previewQuestion.text} />{previewQuestion.imageUrl && <img src={previewQuestion.imageUrl} alt={previewQuestion.imageAltText || 'Question illustration'} />}{previewQuestion.options.map((option, index) => <div className="ctw-preview-option" key={index}>{String.fromCharCode(65 + index)}. <RichQuestionContent content={option} /></div>)}{previewQuestion.solution && <details><summary>Solution</summary><RichQuestionContent content={previewQuestion.solution} /></details>}</section></div>}
    </div>
  )
}
