import { useState, useEffect } from 'react'
import {
  Plus, Search, Edit, Trash2, Eye, PlayCircle, Settings,
  Clock, Users, FileText, CheckCircle, X, Calendar, BarChart3,
  ChevronLeft, ChevronRight, Info, HelpCircle, Lock, ClipboardList, UserCheck
} from 'lucide-react'
import { mockTestsAPI, mockTestAssignmentsAPI, MockTest, questionsAPI, testsAPI, usersAPI, session, type AuthUser, type Question, type TestResult } from '../lib/api'
import RichQuestionContent from './RichQuestionContent'
import { supabase } from '../lib/supabaseClient'
import AdminMockTestAssignments from './AdminMockTestAssignments'
import { dateTimeToUtc } from '../lib/timeZone'

type TabType = 'all' | 'active' | 'scheduled' | 'draft'

type AdminMockTestsProps = {
  initialQuestionIds?: string[]
  onInitialQuestionSelectionConsumed?: () => void
}

export default function AdminMockTests({ initialQuestionIds = [], onInitialQuestionSelectionConsumed }: AdminMockTestsProps) {
  const [mockTests, setMockTests] = useState<MockTest[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabType>('all')
  const [search, setSearch] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [currentStep, setCurrentStep] = useState(1)
  const [availableSubjects, setAvailableSubjects] = useState<string[]>([])
  const [availableChaptersBySubject, setAvailableChaptersBySubject] = useState<Record<string, string[]>>({})
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [selectedTest, setSelectedTest] = useState<MockTest | null>(null)
  const [testAttempts, setTestAttempts] = useState<TestResult[]>([])
  const [attemptsLoading, setAttemptsLoading] = useState(false)
  const [editingTest, setEditingTest] = useState<MockTest | null>(null)
  const [settingsTest, setSettingsTest] = useState<MockTest | null>(null)
  const [availableQuestionCount, setAvailableQuestionCount] = useState(0)
  const [questionCounts, setQuestionCounts] = useState<Record<string, number>>({})
  const [questionCountError, setQuestionCountError] = useState('')
  const [createError, setCreateError] = useState('')
  const [questionSubjectFilter, setQuestionSubjectFilter] = useState('Mixed')
  const [availableQuestions, setAvailableQuestions] = useState<Question[]>([])
  const [questionDifficultyFilter, setQuestionDifficultyFilter] = useState('All Difficulties')
  const [questionChapterFilter, setQuestionChapterFilter] = useState('All Chapters')
  const [questionSearch, setQuestionSearch] = useState('')
  const [questionPage, setQuestionPage] = useState(0)
  const [showAssignmentManagement, setShowAssignmentManagement] = useState(false)

  // Assigned-visibility student picker state
  const [allStudents, setAllStudents] = useState<AuthUser[]>([])
  const [studentsLoading, setStudentsLoading] = useState(false)
  const [studentsLoadError, setStudentsLoadError] = useState('')
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([])
  const [studentSearch, setStudentSearch] = useState('')

  const [formData, setFormData] = useState({
    // Step 1: Basic Information
    title: '',
    description: '',
    category: 'PCM',
    subject: 'Physics',
    difficulty: 'Medium',

    // Step 2: Test Settings
    totalQuestions: 150,
    totalMarks: 600,
    duration: 180,
    negativeMarking: true,
    marksPerQuestion: 4,
    passingMarks: 240,
    maxAttempts: 1,
    shuffleQuestions: false,
    shuffleOptions: true,

    // Step 3: Chapter Selection
    questionSelection: 'bank',
    selectedQuestions: [] as string[],

    // Step 4: Question Selection
    selectedChapters: {} as Record<string, string[]>,

    // Step 5: Test Instructions
    instructions: '',

    // Step 6: Scheduling
    publishNow: true,
    scheduleDate: '',
    scheduleTime: '',
    expiryDate: '',
    expiryTime: '',
    timeZone: 'Asia/Kolkata',

    // Step 7: Visibility
    visibility: 'draft' as 'draft' | 'published' | 'private' | 'public' | 'assigned',
  })

  const normalizeAttemptTitle = (value: string) => value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')

  const loadMockTests = async () => {
    try {
      const [data, resultData] = await Promise.all([
        mockTestsAPI.getAllAdmin(),
        testsAPI.getAllAdmin(),
      ])

      const resultMap = new Map<string, { count: number; totalScore: number }>()
      resultData.forEach(result => {
        const title = normalizeAttemptTitle(result.testName || '')
        if (!title) return
        const entry = resultMap.get(title) || { count: 0, totalScore: 0 }
        const percent = result.totalMarks > 0 ? (result.score / result.totalMarks) * 100 : 0
        entry.count += 1
        entry.totalScore += percent
        resultMap.set(title, entry)
      })

      const hydrated = data.map(test => {
        const key = normalizeAttemptTitle(test.title || '')
        const metrics = resultMap.get(key)
        return {
          ...test,
          attempts: metrics ? metrics.count : (test.attempts || 0),
          avgScore: metrics ? Number((metrics.totalScore / metrics.count).toFixed(1)) : (test.avgScore || 0),
        }
      })

      setMockTests(hydrated)
    } catch (error) {
      console.error('Failed to load mock tests:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadQuestionBankMeta = async () => {
    setLoadingMeta(true)
    try {
      const data = await questionsAPI.getSubjectsAndChapters()
      setAvailableSubjects(data.subjects)
      setAvailableChaptersBySubject(data.chaptersBySubject)
    } catch (error) {
      console.error('Failed to load question bank metadata:', error)
    } finally {
      setLoadingMeta(false)
    }
  }

  const getStudentForAttempt = (result: TestResult, userMap: Map<string, any>) => {
    if (typeof result.userId === 'object' && result.userId) return result.userId

    const rawUserId = typeof result.userId === 'string' ? result.userId : result.userId?._id
    if (!rawUserId) return { _id: 'unknown', name: 'Student', email: 'No email available' }

    return userMap.get(String(rawUserId)) || { _id: rawUserId, name: 'Student', email: 'No email available' }
  }

  const viewTestAttempts = async (test: MockTest) => {
    setSelectedTest(test)
    setAttemptsLoading(true)
    try {
      const [results, allUsers] = await Promise.all([
        testsAPI.getAllAdmin(),
        usersAPI.getAll('approved'),
      ])

      const targetTitle = normalizeAttemptTitle(test.title)
      const userMap = new Map((allUsers || []).map(user => [String(user._id), user]))

      const filtered = (results || []).filter(result => {
        const candidate = normalizeAttemptTitle(result.testName || '')
        return candidate === targetTitle || result.testName?.trim().toLowerCase() === test.title.trim().toLowerCase()
      })

      setTestAttempts(filtered.map(result => ({
        ...result,
        userId: getStudentForAttempt(result, userMap),
      })))
    } catch (error) {
      console.error('Failed to load test attempts:', error)
      setTestAttempts([])
    } finally {
      setAttemptsLoading(false)
    }
  }

  const openEditWizard = (test: MockTest) => {
    setCreateError('')
    const category = test.examType || (['PCM', 'PCB', 'PCMB'].includes(test.subject) ? test.subject : 'PCM')
    setEditingTest(test)
    setFormData(previous => ({
      ...previous,
      title: test.title,
      subject: category === test.subject ? 'Mixed' : test.subject,
      category,
      difficulty: test.difficulty,
      totalQuestions: test.questions,
      duration: test.duration,
      maxAttempts: test.maxAttempts || 1,
      totalMarks: test.questions * marksForSubject(test.subject),
      marksPerQuestion: marksForSubject(test.subject),
      selectedQuestions: test.questionIds || [],
      selectedChapters: {},
      publishNow: test.status === 'active',
      visibility: test.status === 'active' ? 'published' : 'draft',
    }))
    setQuestionSubjectFilter('Mixed')
    setCurrentStep(1)
    setShowCreateModal(true)
  }

  const saveTestSettings = async (status: MockTest['status']) => {
    if (!settingsTest) return
    try {
      await mockTestsAPI.update(settingsTest._id, { status })
      setSettingsTest(null)
      await loadMockTests()
    } catch (error) {
      console.error('Failed to update test settings:', error)
      alert('Failed to update test settings. Please try again.')
    }
  }

  const deleteTest = async (test: MockTest) => {
    if (!window.confirm(`Permanently delete "${test.title}", all its schedules, student attempts, and results? This cannot be undone.`)) return
    try {
      await mockTestsAPI.delete(test._id)
      setMockTests(current => current.filter(item => item._id !== test._id))
    } catch (error) {
      console.error('Failed to delete mock test:', error)
      alert(error instanceof Error ? error.message : 'Failed to delete test. Please try again.')
    }
  }

  const handleCreateTest = async () => {
    setCreateError('')
    if (!Number.isInteger(formData.maxAttempts) || formData.maxAttempts < 1) {
      setCreateError('Maximum attempts must be a whole number greater than zero.')
      return
    }
    if (formData.visibility === 'assigned' && !editingTest && selectedStudentIds.length === 0) {
      setCreateError('Select at least one student to assign this test to.')
      return
    }
    try {
      if (formData.visibility === 'assigned' && !formData.publishNow
        && (!formData.scheduleDate || !formData.scheduleTime || !formData.expiryDate || !formData.expiryTime)) {
        setCreateError('Enter the schedule start date and time, expiry date and time, and time zone.')
        return
      }
      const status = resolveVisibilityStatus(formData.visibility, formData.publishNow)
      const hasStudentSchedule = formData.visibility === 'assigned'
      const scheduleStart = formData.publishNow
        ? new Date()
        : formData.scheduleDate && formData.scheduleTime
          ? new Date(dateTimeToUtc(formData.scheduleDate, formData.scheduleTime, formData.timeZone))
          : undefined
      const scheduleEnd = hasStudentSchedule
        ? formData.publishNow
          ? new Date((scheduleStart || new Date()).getTime() + 365 * 24 * 60 * 60 * 1000)
          : new Date(dateTimeToUtc(formData.expiryDate, formData.expiryTime, formData.timeZone))
        : undefined
      if (hasStudentSchedule && scheduleEnd && scheduleStart
        && scheduleEnd.getTime() <= scheduleStart.getTime()) {
        setCreateError('Expiry date and time must be later than the schedule start.')
        return
      }
      if (hasStudentSchedule && scheduleEnd && scheduleEnd.getTime() <= Date.now()) {
        setCreateError('The expiry date and time must be in the future.')
        return
      }
      const scheduledDate = scheduleStart?.toISOString()

      const currentAdmin = session.get<{ name?: string }>()
      const payload = {
        title: formData.title,
        subject: formData.subject === 'Mixed' ? formData.category : formData.subject,
        examType: formData.category,
        difficulty: formData.difficulty as 'Easy' | 'Medium' | 'Hard',
        questions: formData.totalQuestions,
        duration: formData.duration,
        maxAttempts: formData.maxAttempts,
        questionIds: formData.questionSelection === 'bank' ? formData.selectedQuestions : [],
        status: status as 'active' | 'scheduled' | 'draft',
        scheduledDate,
        createdBy: currentAdmin?.name || 'Administrator',
      }
      let savedTest: MockTest
      if (editingTest) {
        savedTest = await mockTestsAPI.update(editingTest._id, payload)
      } else {
        savedTest = await mockTestsAPI.create(payload)
      }

      // If visibility is 'assigned', also create a mock test assignment for the selected students
      if (formData.visibility === 'assigned' && !editingTest) {
        const assignmentPayload = {
          mockTestId: savedTest._id,
          assignedTo: 'students',
          studentIds: selectedStudentIds,
          startDateTime: scheduleStart!.toISOString(),
          endDateTime: scheduleEnd!.toISOString(),
          timeZone: formData.timeZone,
          visibility: scheduleStart.getTime() > Date.now() ? 'scheduled' : 'available',
          resultVisibility: 'immediate',
          attemptLimit: formData.maxAttempts,
          randomizeQuestions: formData.shuffleQuestions,
          randomizeOptions: formData.shuffleOptions,
          allowBackNavigation: true,
          allowResume: true,
        }
        await mockTestAssignmentsAPI.create(assignmentPayload)
      }

      setEditingTest(null)
      setShowCreateModal(false)
      setCurrentStep(1)
      setSelectedStudentIds([])
      setStudentSearch('')
      loadMockTests()
    } catch (error) {
      console.error('Failed to create mock test:', error)
      setCreateError(error instanceof Error ? error.message : 'The mock test could not be saved. Please retry.')
    }
  }

  const updateFormData = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const resolveVisibilityStatus = (visibility: string, publishNow: boolean) => {
    if (visibility === 'draft') return 'draft'
    if (visibility === 'published' || visibility === 'public' || visibility === 'private' || visibility === 'assigned') return publishNow ? 'active' : 'scheduled'
    return publishNow ? 'active' : 'draft'
  }

  const nextStep = () => {
    if (currentStep === 2) {
      const requestedQuestions = Number(formData.totalQuestions)
      const availableQuestions = questionSubjectFilter === 'Mixed'
        ? categorySubjects.reduce((total, subject) => total + (questionCounts[subject] || 0), 0)
        : questionCounts[questionSubjectFilter] || 0
      if (!Number.isInteger(requestedQuestions) || requestedQuestions < 1) {
        setQuestionCountError('Enter at least 1 question.')
        return
      }
      if (requestedQuestions > availableQuestions) {
        setQuestionCountError(`Only ${availableQuestions} active question${availableQuestions === 1 ? '' : 's'} available in the selected category.`)
        return
      }
      setQuestionCountError('')
    }
    if (currentStep === 3 && !Object.values(formData.selectedChapters).some(chapters => chapters.length > 0)) {
      setQuestionCountError('Select at least one chapter to continue.')
      return
    }
    if (currentStep === 4 && formData.questionSelection === 'bank' && formData.selectedQuestions.length === 0) {
      setQuestionCountError('Select at least one question from the question bank.')
      return
    }
    setQuestionCountError('')
    setCurrentStep(prev => Math.min(7, prev + 1))
  }
  const prevStep = () => setCurrentStep(prev => Math.max(1, prev - 1))

  const marksForSubject = (subject: string) => subject === 'Mathematics' || subject === 'Biology' ? 2 : 1

  const categorySubjects = formData.category === 'PCM'
    ? ['Physics', 'Chemistry', 'Mathematics']
    : formData.category === 'PCB'
      ? ['Physics', 'Chemistry', 'Biology']
      : ['Physics', 'Chemistry', 'Mathematics', 'Biology']

  const selectedChapterQuestions = availableQuestions.filter(question =>
    categorySubjects.includes(question.subject?.trim() || '') &&
    Boolean(question.chapter && formData.selectedChapters[question.subject.toLowerCase()]?.includes(question.chapter))
  )

  const getFilteredQuestionCount = (subject: string) => subject === 'Mixed'
    ? selectedChapterQuestions.length
    : selectedChapterQuestions.filter(question => question.subject === subject).length

  const updateQuestionSubjectFilter = (subject: string) => {
    setQuestionSubjectFilter(subject)
  }

  const filteredQuestionBank = availableQuestions.filter(question => {
    const matchesChapterSelection = selectedChapterQuestions.some(selected => selected._id === question._id)
    const matchesSubject = questionSubjectFilter === 'Mixed' || question.subject === questionSubjectFilter
    const matchesDifficulty = questionDifficultyFilter === 'All Difficulties' || question.difficulty === questionDifficultyFilter
    const matchesChapter = questionChapterFilter === 'All Chapters' || question.chapter === questionChapterFilter
    const searchTerm = questionSearch.trim().toLowerCase()
    const matchesSearch = !searchTerm || [
      question.text,
      question.subject,
      question.chapter,
      question.topic,
      question._id,
    ].some(value => value?.toLowerCase().includes(searchTerm))
    return matchesChapterSelection && matchesSubject && matchesDifficulty && matchesChapter && matchesSearch
  })
  const questionFilterChapters = [...new Set(
    selectedChapterQuestions
      .filter(question => questionSubjectFilter === 'Mixed' || question.subject === questionSubjectFilter)
      .map(question => question.chapter)
      .filter((chapter): chapter is string => Boolean(chapter))
  )]
  const questionsPerPage = 4
  const questionPageCount = Math.max(1, Math.ceil(filteredQuestionBank.length / questionsPerPage))
  const currentQuestionPage = Math.min(questionPage, questionPageCount - 1)
  const pagedQuestionBank = filteredQuestionBank.slice(
    currentQuestionPage * questionsPerPage,
    (currentQuestionPage + 1) * questionsPerPage,
  )
  const selectedChapterCount = categorySubjects.reduce(
    (total, subject) => total + (formData.selectedChapters[subject.toLowerCase()]?.length || 0),
    0,
  )
  const selectedQuestionMarks = availableQuestions
    .filter(question => formData.selectedQuestions.includes(question._id))
    .reduce((total, question) => total + marksForSubject(question.subject), 0)
  const visibleSelectedQuestionCount = filteredQuestionBank
    .filter(question => formData.selectedQuestions.includes(question._id)).length

  const toggleQuestionSelection = (question: Question) => {
    const selected = formData.selectedQuestions.includes(question._id)
    const selectedQuestions = selected
      ? formData.selectedQuestions.filter(id => id !== question._id)
      : [...formData.selectedQuestions, question._id]
    const selectedItems = availableQuestions.filter(item => selectedQuestions.includes(item._id))
    updateFormData('selectedQuestions', selectedQuestions)
    updateFormData('totalQuestions', selectedQuestions.length)
    updateFormData('totalMarks', selectedItems.reduce((total, item) => total + marksForSubject(item.subject), 0))
  }

  const toggleChapterSelection = (subject: string, chapter: string, checked: boolean) => {
    const subjectKey = subject.toLowerCase()
    const subjectChapters = formData.selectedChapters[subjectKey] || []
    const selectedChapters = {
      ...formData.selectedChapters,
      [subjectKey]: checked
        ? [...new Set([...subjectChapters, chapter])]
        : subjectChapters.filter(selectedChapter => selectedChapter !== chapter),
    }
    const chapterQuestions = availableQuestions.filter(question => question.subject === subject && question.chapter === chapter)
    const selectedQuestions = checked
      ? formData.selectedQuestions
      : formData.selectedQuestions.filter(id => !chapterQuestions.some(question => question._id === id))
    const selectedItems = availableQuestions.filter(question => selectedQuestions.includes(question._id))
    updateFormData('selectedChapters', selectedChapters)
    updateFormData('selectedQuestions', selectedQuestions)
    updateFormData('totalQuestions', selectedQuestions.length)
    updateFormData('totalMarks', selectedItems.reduce((total, question) => total + marksForSubject(question.subject), 0))
    if (!checked && questionChapterFilter === chapter) setQuestionChapterFilter('All Chapters')
    setQuestionPage(0)
  }

  const toggleAllSubjectChapters = (subject: string, checked: boolean) => {
    const chapters = availableChaptersBySubject[subject] || []
    const subjectKey = subject.toLowerCase()
    const selectedChapters = {
      ...formData.selectedChapters,
      [subjectKey]: checked ? chapters : [],
    }
    const subjectQuestions = availableQuestions.filter(question => question.subject === subject)
    const selectedQuestions = checked
      ? formData.selectedQuestions
      : formData.selectedQuestions.filter(id => !subjectQuestions.some(question => question._id === id))
    const selectedItems = availableQuestions.filter(question => selectedQuestions.includes(question._id))
    updateFormData('selectedChapters', selectedChapters)
    updateFormData('selectedQuestions', selectedQuestions)
    updateFormData('totalQuestions', selectedQuestions.length)
    updateFormData('totalMarks', selectedItems.reduce((total, question) => total + marksForSubject(question.subject), 0))
    setQuestionChapterFilter('All Chapters')
    setQuestionPage(0)
  }

  useEffect(() => {
    if (formData.subject === 'Mixed') return
    const marks = marksForSubject(formData.subject)
    setFormData(previous => ({
      ...previous,
      marksPerQuestion: marks,
      totalMarks: (Number(previous.totalQuestions) || 0) * marks,
    }))
  }, [formData.subject, formData.totalQuestions])

  useEffect(() => {
    if (!showCreateModal || !Object.keys(questionCounts).length) return
    const allowedSubjects = formData.category === 'PCM'
      ? ['Physics', 'Chemistry', 'Mathematics']
      : formData.category === 'PCB'
        ? ['Physics', 'Chemistry', 'Biology']
        : ['Physics', 'Chemistry', 'Mathematics', 'Biology']
    const totalQuestions = questionSubjectFilter === 'Mixed'
      ? allowedSubjects.reduce((total, subject) => total + (questionCounts[subject] || 0), 0)
      : questionCounts[questionSubjectFilter] || 0
    const totalMarks = questionSubjectFilter === 'Mixed'
      ? allowedSubjects.reduce((total, subject) => total + (questionCounts[subject] || 0) * marksForSubject(subject), 0)
      : totalQuestions * marksForSubject(questionSubjectFilter)
    setFormData(previous => previous.totalQuestions === totalQuestions && previous.totalMarks === totalMarks
      ? previous
      : { ...previous, totalQuestions, totalMarks, marksPerQuestion: questionSubjectFilter === 'Mixed' ? previous.marksPerQuestion : marksForSubject(questionSubjectFilter) })
  }, [showCreateModal, questionCounts, questionSubjectFilter, formData.category])

  useEffect(() => {
    loadMockTests()
    let refreshTimer: number | undefined
    const scheduleRefresh = () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => { void loadMockTests() }, 250)
    }

    const channel = supabase
      .channel('admin_mock_tests_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'test_results' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mock_tests' }, scheduleRefresh)
      .subscribe()
    window.addEventListener('focus', scheduleRefresh)

    return () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      window.removeEventListener('focus', scheduleRefresh)
      void supabase.removeChannel(channel)
    }
  }, [])

  const loadApprovedStudents = async () => {
    setStudentsLoading(true)
    setStudentsLoadError('')
    try {
      const users = await usersAPI.getAll('approved')
      if (!Array.isArray(users)) throw new Error('The student list response was invalid.')
      setAllStudents(users.filter(user =>
        String(user.role || '').toLowerCase() === 'student'
        && String(user.status || '').toLowerCase() === 'approved'))
    } catch (error) {
      setAllStudents([])
      setStudentsLoadError(error instanceof Error ? error.message : 'Could not load approved students.')
    } finally {
      setStudentsLoading(false)
    }
  }

  useEffect(() => {
    if (currentStep !== 7 || formData.visibility !== 'assigned') return
    if (allStudents.length > 0) return // already loaded
    void loadApprovedStudents()
  }, [currentStep, formData.visibility, allStudents.length])

  useEffect(() => {
    if (showCreateModal) {
      loadQuestionBankMeta()
      const subject = formData.subject && formData.subject !== 'Mixed' ? formData.subject : undefined
      questionsAPI.getAllAdmin({ isActive: true }).then(questions => {
        setAvailableQuestions(questions)
        if (editingTest) {
          const selectedIds = new Set(editingTest.questionIds || [])
          const selectedChapters = questions.reduce<Record<string, string[]>>((chapters, question) => {
            if (selectedIds.has(question._id) && question.chapter) {
              const key = question.subject.toLowerCase()
              chapters[key] = [...new Set([...(chapters[key] || []), question.chapter])]
            }
            return chapters
          }, {})
          setFormData(previous => ({ ...previous, selectedChapters }))
        }
        setQuestionCounts(questions.reduce<Record<string, number>>((counts, question) => {
          const subjectName = question.subject?.trim() || 'Other'
          counts[subjectName] = (counts[subjectName] || 0) + 1
          return counts
        }, {}))
      }).catch(error => console.error('Failed to count questions:', error))
      questionsAPI.getAllAdmin({ isActive: true, subject }).then(questions => setAvailableQuestionCount(questions.length)).catch(error => console.error('Failed to count selected subject questions:', error))
    }
  }, [showCreateModal, formData.subject, formData.category, editingTest])

  const initialQuestionIdsKey = initialQuestionIds.join(',')
  useEffect(() => {
    if (!initialQuestionIdsKey) return
    let cancelled = false
    const ids = initialQuestionIdsKey.split(',').filter(Boolean)
    questionsAPI.getAllAdmin({ isActive: true })
      .then(allQuestions => {
        if (cancelled) return
        const selected = allQuestions.filter(question => ids.includes(question._id))
        if (!selected.length) {
          alert('The approved questions could not be loaded from the Question Bank. Please reopen test creation and select them again.')
          return
        }
        const subjectNames = [...new Set(selected.map(question => question.subject.trim()))]
        const hasMathOrBio = subjectNames.some(name => name === 'Mathematics' || name === 'Biology')
        const hasBiology = subjectNames.includes('Biology')
        const hasNonBiology = subjectNames.some(name => name !== 'Biology')
        const category = hasBiology && hasNonBiology ? 'PCMB' : hasBiology ? 'PCB' : 'PCM'
        const subject = subjectNames.length === 1 ? subjectNames[0] : 'Mixed'
        const marks = selected.reduce((total, question) => total + (question.subject === 'Mathematics' || question.subject === 'Biology' ? 2 : 1), 0)
        const selectedChapters = selected.reduce<Record<string, string[]>>((chapters, question) => {
          if (question.chapter) {
            const key = question.subject.toLowerCase()
            chapters[key] = [...new Set([...(chapters[key] || []), question.chapter])]
          }
          return chapters
        }, {})
        setFormData(previous => ({
          ...previous,
          category,
          subject,
          totalQuestions: selected.length,
          totalMarks: marks || selected.length * (hasMathOrBio ? 2 : 1),
          questionSelection: 'bank',
          selectedChapters,
          selectedQuestions: selected.map(question => question._id),
        }))
        setQuestionSubjectFilter(subject)
        setCurrentStep(1)
        setShowCreateModal(true)
      })
      .catch(error => {
        if (!cancelled) {
          console.error('Failed to load generated questions for test creation:', error)
          alert('Could not load the saved questions for test creation. Please try again.')
        }
      })
      .finally(() => {
        if (!cancelled) onInitialQuestionSelectionConsumed?.()
      })
    return () => { cancelled = true }
  }, [initialQuestionIdsKey, onInitialQuestionSelectionConsumed])

  const filtered = mockTests.filter(test => {
    const matchesTab = activeTab === 'all' || test.status === activeTab
    const matchesSearch = !search || test.title.toLowerCase().includes(search.toLowerCase()) || test.subject.toLowerCase().includes(search.toLowerCase())
    return matchesTab && matchesSearch
  })

  const stats = {
    total: mockTests.length,
    active: mockTests.filter(t => t.status === 'active').length,
    scheduled: mockTests.filter(t => t.status === 'scheduled').length,
    draft: mockTests.filter(t => t.status === 'draft').length,
    totalAttempts: mockTests.reduce((sum, t) => sum + (t.attempts || 0), 0),
    avgScore: mockTests.length > 0 ? Math.round(mockTests.filter(t => t.avgScore > 0).reduce((sum, t) => sum + t.avgScore, 0) / Math.max(1, mockTests.filter(t => t.avgScore > 0).length)) : 0,
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return '--green'
      case 'scheduled': return '--blue'
      case 'draft': return '--gray'
      default: return '--gray'
    }
  }

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'Easy': return '#dcfce7'
      case 'Medium': return '#fef9c3'
      case 'Hard': return '#fee2e2'
      default: return '#f1f5f9'
    }
  }

  const subjectOptions = formData.category === 'PCM'
    ? ['Physics', 'Chemistry', 'Mathematics']
    : formData.category === 'PCB'
      ? ['Physics', 'Chemistry', 'Biology']
      : ['Physics', 'Chemistry', 'Mathematics', 'Biology']

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        if (showAssignmentManagement) {
          return <AdminMockTestAssignments onBack={() => setShowAssignmentManagement(false)} />
        }

        return (
          <>
            <div className="amt-form-group">
              <label className="amt-label">Mock Test Title *</label>
              <input type="text" className="amt-input" placeholder="e.g., Full Syllabus Mock Test A" value={formData.title} onChange={e => updateFormData('title', e.target.value)} />
            </div>
            <div className="amt-form-group">
              <label className="amt-label">Description (Optional)</label>
              <textarea className="amt-textarea" rows={3} placeholder="Brief description of the test..." value={formData.description} onChange={e => updateFormData('description', e.target.value)} />
            </div>
            <div className="amt-form-row">
              <div className="amt-form-group">
                <label className="amt-label">Category</label>
                <select className="amt-select" value={formData.category} onChange={e => {
                  const category = e.target.value
                  updateFormData('category', category)
                  setQuestionSubjectFilter('Mixed')
                  const subjects = category === 'PCM' ? ['Physics', 'Chemistry', 'Mathematics'] : category === 'PCB' ? ['Physics', 'Chemistry', 'Biology'] : ['Physics', 'Chemistry', 'Mathematics', 'Biology']
                  if (formData.subject !== 'Mixed' && !subjects.includes(formData.subject)) updateFormData('subject', 'Physics')
                }}>
                  <option>PCM</option>
                  <option>PCB</option>
                  <option>PCMB</option>
                </select>
                <div className="amt-question-counts">
                  {categorySubjects.map(subject => (
                    <span key={subject}>{subject}: <strong>{questionCounts[subject] || 0}</strong> available</span>
                  ))}
                </div>
              </div>
              <div className="amt-form-group">
                <label className="amt-label">Subject *</label>
                <select className="amt-select" value={formData.subject} onChange={e => updateFormData('subject', e.target.value)}>
                  <option value="Mixed">All Subjects</option>
                  {subjectOptions.map(subject => (
                    <option key={subject} value={subject}>{subject}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="amt-form-group">
              <label className="amt-label">Difficulty Level *</label>
              <select className="amt-select" value={formData.difficulty} onChange={e => updateFormData('difficulty', e.target.value)}>
                <option>Easy</option>
                <option>Medium</option>
                <option>Hard</option>
                <option>Mixed</option>
              </select>
            </div>
          </>
        )

      case 2:
        return (
          <>
            <div className="amt-form-row">
              <div className="amt-form-group">
                <label className="amt-label">Total Questions *</label>
                <input type="number" min="1" className="amt-input" value={formData.totalQuestions} onChange={e => { setQuestionCountError(''); updateFormData('totalQuestions', parseInt(e.target.value)) }} />
                <small className="amt-availability-note">{categorySubjects.reduce((total, subject) => total + (questionCounts[subject] || 0), 0)} active questions available for {formData.category}</small>
                {questionCountError && <p className="amt-validation-error">{questionCountError}</p>}
                <div className="amt-category-total">
                  {categorySubjects.map((subject, index) => (
                    <span key={subject}>{index > 0 && ' + '}{subject} <strong>{questionCounts[subject] || 0}</strong></span>
                  ))}
                  {' = '}<strong>{categorySubjects.reduce((total, subject) => total + (questionCounts[subject] || 0), 0)} total</strong>
                </div>
              </div>
              <div className="amt-form-group">
                <label className="amt-label">Total Marks *</label>
                <input type="number" className="amt-input" value={formData.totalMarks} readOnly={formData.subject !== 'Mixed'} onChange={e => updateFormData('totalMarks', parseInt(e.target.value))} />
              </div>
            </div>
            <div className="amt-form-row">
              <div className="amt-form-group">
                <label className="amt-label">Duration (Minutes) *</label>
                <input type="number" className="amt-input" value={formData.duration} onChange={e => updateFormData('duration', parseInt(e.target.value))} />
              </div>
              <div className="amt-form-group">
                <label className="amt-label">Marks per Question</label>
                <input type="number" className="amt-input" value={formData.subject === 'Mixed' ? formData.marksPerQuestion : marksForSubject(formData.subject)} readOnly={formData.subject !== 'Mixed'} onChange={e => updateFormData('marksPerQuestion', parseInt(e.target.value))} />
                <small className="amt-availability-note">Physics/Chemistry: 1 mark · Mathematics/Biology: 2 marks</small>
              </div>
            </div>
            <div className="amt-form-row">
              <div className="amt-form-group">
                <label className="amt-label">Passing Marks</label>
                <input type="number" className="amt-input" value={formData.passingMarks} onChange={e => updateFormData('passingMarks', parseInt(e.target.value))} />
              </div>
              <div className="amt-form-group">
                <label className="amt-label">Maximum Attempts</label>
                <input type="number" min={1} step={1} className="amt-input" value={formData.maxAttempts} onChange={e => updateFormData('maxAttempts', Number(e.target.value))} />
              </div>
            </div>
            <div className="amt-form-group">
              <label className="amt-checkbox-label">
                <input type="checkbox" checked={formData.negativeMarking} onChange={e => updateFormData('negativeMarking', e.target.checked)} />
                <span>Enable Negative Marking</span>
              </label>
            </div>
            <div className="amt-form-row">
              <div className="amt-form-group">
                <label className="amt-checkbox-label">
                  <input type="checkbox" checked={formData.shuffleQuestions} onChange={e => updateFormData('shuffleQuestions', e.target.checked)} />
                  <span>Shuffle Questions</span>
                </label>
              </div>
              <div className="amt-form-group">
                <label className="amt-checkbox-label">
                  <input type="checkbox" checked={formData.shuffleOptions} onChange={e => updateFormData('shuffleOptions', e.target.checked)} />
                  <span>Shuffle Options</span>
                </label>
              </div>
            </div>
          </>
        )

      case 4:
        return (
          <>
            <div className="amt-form-group amt-question-method-group">
              <label className="amt-label">Question Selection Method</label>
              <div className="amt-radio-group amt-question-method-options">
                <label className="amt-radio-label">
                  <input type="radio" name="questionSelection" value="bank" checked={formData.questionSelection === 'bank'} onChange={e => updateFormData('questionSelection', e.target.value)} />
                  <span><strong>Select from Question Bank</strong><small>Pick existing questions</small></span>
                </label>
                <label className="amt-radio-label">
                  <input type="radio" name="questionSelection" value="create" checked={formData.questionSelection === 'create'} onChange={e => updateFormData('questionSelection', e.target.value)} />
                  <span><strong>Create New Question</strong><small>Use the question type below</small></span>
                </label>
              </div>
            </div>

            {formData.questionSelection === 'bank' && (
              <div className="amt-question-picker">
                <div className="amt-question-picker-heading">
                  <div>
                    <h3>Choose questions</h3>
                    <p>Choose questions from the chapters you selected in the previous step.</p>
                  </div>
                  <div className="amt-question-picker-counts">
                    <span className="amt-question-result-count">{filteredQuestionBank.length} questions</span>
                    <span className="amt-question-selected-count">{formData.selectedQuestions.length} selected</span>
                  </div>
                </div>
                <div className="amt-question-filter-grid">
                  <div className="amt-question-filter">
                    <label className="amt-label" htmlFor="amt-question-subject">Subject</label>
                    <select id="amt-question-subject" className="amt-select" value={questionSubjectFilter} onChange={e => {
                      updateQuestionSubjectFilter(e.target.value)
                      setQuestionChapterFilter('All Chapters')
                      setQuestionPage(0)
                    }}>
                      <option value="Mixed">All Subjects ({getFilteredQuestionCount('Mixed')})</option>
                      {subjectOptions.map(subject => (
                        <option key={subject} value={subject}>{subject} ({getFilteredQuestionCount(subject)})</option>
                      ))}
                    </select>
                  </div>
                  <div className="amt-question-filter">
                    <label className="amt-label" htmlFor="amt-question-difficulty">Difficulty</label>
                    <select id="amt-question-difficulty" className="amt-select" value={questionDifficultyFilter} onChange={e => { setQuestionDifficultyFilter(e.target.value); setQuestionPage(0) }}>
                      <option>All Difficulties</option>
                      <option>Easy</option>
                      <option>Medium</option>
                      <option>Hard</option>
                    </select>
                  </div>
                  <div className="amt-question-filter">
                    <label className="amt-label" htmlFor="amt-question-chapter">Chapter</label>
                    <select id="amt-question-chapter" className="amt-select" value={questionChapterFilter} onChange={e => { setQuestionChapterFilter(e.target.value); setQuestionPage(0) }}>
                      <option>All Chapters</option>
                      {questionFilterChapters.map(chapter => (
                        <option key={chapter} value={chapter}>{chapter}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <label className="amt-question-search">
                  <Search size={18} aria-hidden="true" />
                  <input
                    type="search"
                    value={questionSearch}
                    onChange={event => { setQuestionSearch(event.target.value); setQuestionPage(0) }}
                    placeholder="Search question text, topic, chapter or ID"
                    aria-label="Search questions"
                  />
                  {questionSearch && <button type="button" onClick={() => setQuestionSearch('')}>Clear</button>}
                </label>
                <div className="amt-question-toolbar">
                  <span>Showing <strong>{filteredQuestionBank.length}</strong> of {getFilteredQuestionCount(questionSubjectFilter)} questions</span>
                  <div className="amt-question-selection-actions">
                    <button
                      type="button"
                      disabled={!filteredQuestionBank.length || visibleSelectedQuestionCount === filteredQuestionBank.length}
                      onClick={() => {
                        const selectedQuestions = [...new Set([...formData.selectedQuestions, ...filteredQuestionBank.map(question => question._id)])]
                        const selectedItems = availableQuestions.filter(question => selectedQuestions.includes(question._id))
                        updateFormData('selectedQuestions', selectedQuestions)
                        updateFormData('totalQuestions', selectedQuestions.length)
                        updateFormData('totalMarks', selectedItems.reduce((total, question) => total + marksForSubject(question.subject), 0))
                        setQuestionCountError('')
                      }}
                    >Select all results</button>
                    <button
                      type="button"
                      disabled={!visibleSelectedQuestionCount}
                      onClick={() => {
                        const visibleIds = new Set(filteredQuestionBank.map(question => question._id))
                        const selectedQuestions = formData.selectedQuestions.filter(id => !visibleIds.has(id))
                        const selectedItems = availableQuestions.filter(question => selectedQuestions.includes(question._id))
                        updateFormData('selectedQuestions', selectedQuestions)
                        updateFormData('totalQuestions', selectedQuestions.length)
                        updateFormData('totalMarks', selectedItems.reduce((total, question) => total + marksForSubject(question.subject), 0))
                      }}
                    >Clear results</button>
                  </div>
                </div>
                <div className="amt-question-bank-list">
                  {filteredQuestionBank.length === 0 ? (
                    <div className="amt-question-empty">
                      <Search size={22} aria-hidden="true" />
                      <strong>{selectedChapterCount ? 'No questions found' : 'Select chapters first'}</strong>
                      <span>{selectedChapterCount ? 'Try changing your filters or search terms.' : 'Go back to Chapter Selection and choose chapters to view their questions.'}</span>
                    </div>
                  ) : pagedQuestionBank.map((question, index) => (
                    <label key={question._id} className={`amt-question-option ${formData.selectedQuestions.includes(question._id) ? 'selected' : ''}`}>
                      <input type="checkbox" checked={formData.selectedQuestions.includes(question._id)} onChange={() => toggleQuestionSelection(question)} />
                      <div className="amt-question-content">
                        <div className="amt-question-card-heading">
                          <span className="amt-question-index">Q{currentQuestionPage * questionsPerPage + index + 1}</span>
                          <span className="amt-question-subject">{question.subject}</span>
                          <span className="amt-question-topic">{question.chapter || question.topic}</span>
                          <span className={`amt-question-difficulty amt-question-difficulty--${question.difficulty.toLowerCase()}`}>{question.difficulty}</span>
                          <span className="amt-question-marks">{question.marks} marks</span>
                        </div>
                        <div className="amt-question-text"><RichQuestionContent content={question.text} /></div>
                        {question.imageUrl && (
                          <img className="amt-question-image" src={question.imageUrl} alt="Question illustration" loading="lazy" />
                        )}
                        {question.options?.length > 0 && (
                          <div className="amt-question-options" aria-label="Answer choices">
                            {question.options.map((option, optionIndex) => (
                              <div className="amt-question-preview-option" key={`${question._id}-option-${optionIndex}`}>
                                <span>{String.fromCharCode(65 + optionIndex)}</span>
                                <RichQuestionContent content={option} />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
                {filteredQuestionBank.length > questionsPerPage && (
                  <nav className="amt-question-pagination" aria-label="Question pages">
                    <span>
                      Showing <strong>{currentQuestionPage * questionsPerPage + 1}-{Math.min((currentQuestionPage + 1) * questionsPerPage, filteredQuestionBank.length)}</strong> of <strong>{filteredQuestionBank.length}</strong>
                    </span>
                    <div>
                      <button type="button" disabled={currentQuestionPage === 0} onClick={() => setQuestionPage(page => Math.max(0, page - 1))}>
                        <ChevronLeft size={15} /> Previous
                      </button>
                      <span className="amt-question-page-number">Page {currentQuestionPage + 1} of {questionPageCount}</span>
                      <button type="button" disabled={currentQuestionPage >= questionPageCount - 1} onClick={() => setQuestionPage(page => Math.min(questionPageCount - 1, page + 1))}>
                        Next <ChevronRight size={15} />
                      </button>
                    </div>
                  </nav>
                )}
                <div className="amt-selection-summary" aria-live="polite">
                  <Info size={18} aria-hidden="true" />
                  <p>
                    <strong>{formData.selectedQuestions.length} questions selected</strong>
                    <span>{selectedQuestionMarks} marks total · {visibleSelectedQuestionCount} selected in these results</span>
                  </p>
                  <button
                    type="button"
                    disabled={!formData.selectedQuestions.length}
                    onClick={() => {
                      updateFormData('selectedQuestions', [])
                      updateFormData('totalQuestions', 0)
                      updateFormData('totalMarks', 0)
                      setQuestionCountError('')
                    }}
                  >Clear selection</button>
                </div>
                {questionCountError && <p className="amt-validation-error">{questionCountError}</p>}
              </div>
            )}

            {formData.questionSelection === 'create' && (
              <div className="amt-form-group">
                <label className="amt-label">Question Type</label>
                <select className="amt-select">
                  <option>Single Correct MCQ</option>
                  <option>Multiple Correct</option>
                  <option>Numerical Answer</option>
                  <option>Assertion & Reason</option>
                  <option>Match the Following</option>
                </select>
              </div>
            )}
          </>
        )

      case 3:
        return (
          <div className="amt-chapters-container">
            <div className="amt-question-picker-heading">
              <div>
                <h3>Select chapters</h3>
                <p>Choose the chapters to include. Their added questions will appear in the next step.</p>
              </div>
              <span className="amt-question-result-count">{selectedChapterCount} selected</span>
            </div>
            {questionCountError && <p className="amt-validation-error" role="alert">{questionCountError}</p>}
            {categorySubjects.map(subject => {
              const chapters = availableChaptersBySubject[subject] || []
              const subjectQuestions = availableQuestions.filter(question => question.subject === subject)
              const selectedSubjectChapters = formData.selectedChapters[subject.toLowerCase()] || []
              const allSelected = chapters.length > 0 && chapters.every(chapter => selectedSubjectChapters.includes(chapter))
              return (
                <div className="amt-chapter-section" key={subject}>
                  <div className="amt-chapter-header">
                    <h4>{subject}</h4>
                    <label className="amt-select-all-label"><input type="checkbox" checked={allSelected} onChange={event => toggleAllSubjectChapters(subject, event.target.checked)} /> Select all chapters</label>
                  </div>
                  <div className="amt-chapter-list">
                    {chapters.length > 0 ? chapters.map(chapter => {
                      const chapterQuestions = availableQuestions.filter(question => question.subject === subject && question.chapter === chapter)
                      const isSelected = selectedSubjectChapters.includes(chapter)
                      return <label key={chapter} className="amt-checkbox-label"><input type="checkbox" checked={isSelected} onChange={event => toggleChapterSelection(subject, chapter, event.target.checked)} /><span>{chapter} ({chapterQuestions.length})</span></label>
                    }) : <p className="amt-no-chapters">No chapters available in question bank</p>}
                  </div>
                  {subjectQuestions.length === 0 && chapters.length > 0 && <p className="amt-no-chapters">No active questions are available for this subject.</p>}
                </div>
              )
            })}
          </div>
        )

      case 5:
        return (
          <div className="amt-form-group">
            <label className="amt-label">Test Instructions</label>
            <textarea 
              className="amt-textarea" 
              rows={8} 
              placeholder="Enter test instructions here...

Example:
• No calculator allowed.
• Test cannot be paused once started.
• Negative marking applies for wrong answers.
• Read every question carefully before answering.
• Submit the test before time expires." 
              value={formData.instructions}
              onChange={e => updateFormData('instructions', e.target.value)}
            />
          </div>
        )

      case 6:
        return (
          <>
            <div className="amt-form-group">
              <label className="amt-label">Publishing Option</label>
              <div className="amt-radio-group">
                <label className="amt-radio-label">
                  <input type="radio" name="publish" checked={formData.publishNow} onChange={() => updateFormData('publishNow', true)} />
                  <span>Publish Now</span>
                </label>
                <label className="amt-radio-label">
                  <input type="radio" name="publish" checked={!formData.publishNow} onChange={() => updateFormData('publishNow', false)} />
                  <span>Schedule for Later</span>
                </label>
              </div>
            </div>

            {!formData.publishNow && (
              <>
                <div className="amt-form-row">
                  <div className="amt-form-group">
                    <label className="amt-label">Schedule Date</label>
                    <input type="date" className="amt-input" value={formData.scheduleDate} onChange={e => updateFormData('scheduleDate', e.target.value)} />
                  </div>
                  <div className="amt-form-group">
                    <label className="amt-label">Schedule Time</label>
                    <input type="time" className="amt-input" value={formData.scheduleTime} onChange={e => updateFormData('scheduleTime', e.target.value)} />
                  </div>
                </div>
                <div className="amt-form-row">
                  <div className="amt-form-group">
                    <label className="amt-label">Expiry Date</label>
                    <input type="date" className="amt-input" min={formData.scheduleDate || undefined} value={formData.expiryDate} onChange={e => updateFormData('expiryDate', e.target.value)} />
                  </div>
                  <div className="amt-form-group">
                    <label className="amt-label">Expiry Time</label>
                    <input type="time" className="amt-input" value={formData.expiryTime} onChange={e => updateFormData('expiryTime', e.target.value)} />
                  </div>
                  <div className="amt-form-group">
                    <label className="amt-label">Time Zone</label>
                    <select className="amt-select" value={formData.timeZone} onChange={e => updateFormData('timeZone', e.target.value)}>
                      <option>Asia/Kolkata</option>
                      <option>UTC</option>
                      <option>Asia/Dubai</option>
                      <option>Europe/London</option>
                      <option>America/New_York</option>
                    </select>
                  </div>
                </div>
              </>
            )}
          </>
        )

      case 7:
        return (
          <div className="amt-form-group">
            <label className="amt-label">Visibility *</label>
            <div className="amt-visibility-options">
              <label className={`amt-visibility-card ${formData.visibility === 'draft' ? 'active' : ''}`}>
                <input type="radio" name="visibility" value="draft" checked={formData.visibility === 'draft'} onChange={e => { updateFormData('visibility', e.target.value as any); updateFormData('publishNow', false) }} />
                <div className="amt-visibility-content">
                  <FileText size={24} />
                  <h5>Draft</h5>
                  <p>Save as draft, not visible to students</p>
                </div>
              </label>
              <label className={`amt-visibility-card ${formData.visibility === 'published' ? 'active' : ''}`}>
                <input type="radio" name="visibility" value="published" checked={formData.visibility === 'published'} onChange={e => updateFormData('visibility', e.target.value as any)} />
                <div className="amt-visibility-content">
                  <CheckCircle size={24} />
                  <h5>Published</h5>
                  <p>Make test available to all students</p>
                </div>
              </label>
              <label className={`amt-visibility-card ${formData.visibility === 'private' ? 'active' : ''}`}>
                <input type="radio" name="visibility" value="private" checked={formData.visibility === 'private'} onChange={e => updateFormData('visibility', e.target.value as any)} />
                <div className="amt-visibility-content">
                  <Lock size={24} />
                  <h5>Private</h5>
                  <p>Only accessible via direct link</p>
                </div>
              </label>
              <label className={`amt-visibility-card ${formData.visibility === 'public' ? 'active' : ''}`}>
                <input type="radio" name="visibility" value="public" checked={formData.visibility === 'public'} onChange={e => updateFormData('visibility', e.target.value as any)} />
                <div className="amt-visibility-content">
                  <Users size={24} />
                  <h5>Public</h5>
                  <p>Listed publicly for all users</p>
                </div>
              </label>
              <label className={`amt-visibility-card ${formData.visibility === 'assigned' ? 'active' : ''}`}>
                <input type="radio" name="visibility" value="assigned" checked={formData.visibility === 'assigned'} onChange={e => {
                  updateFormData('visibility', e.target.value as any)
                  setSelectedStudentIds([])
                  setStudentSearch('')
                }} />
                <div className="amt-visibility-content">
                  <UserCheck size={24} />
                  <h5>Assigned</h5>
                  <p>Only visible to selected students</p>
                </div>
              </label>
            </div>

            {formData.visibility === 'assigned' && (
              <div style={{ marginTop: '24px', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>Select Students</h4>
                    <p style={{ margin: '3px 0 0', fontSize: '13px', color: '#64748b' }}>Only selected students will see this test on their dashboard.</p>
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#2563eb', background: '#eff6ff', padding: '4px 12px', borderRadius: '99px' }}>
                    {selectedStudentIds.length} selected
                  </span>
                  <button type="button" onClick={() => void loadApprovedStudents()} disabled={studentsLoading} style={{ padding: '8px 12px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: studentsLoading ? 'wait' : 'pointer', color: '#334155' }}>
                    {studentsLoading ? 'Loading…' : 'Reload students'}
                  </button>
                </div>

                <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="Search by name, email, or student ID…"
                    value={studentSearch}
                    onChange={e => setStudentSearch(e.target.value)}
                    style={{ flex: '1 1 240px', padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '14px', color: '#0f172a', outline: 'none' }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const visible = allStudents.filter(s => {
                        const q = studentSearch.trim().toLowerCase()
                        return !q || [s.name, s.email, s.mhcetId, s._id, s.id].some(v => String(v || '').toLowerCase().includes(q))
                      }).map(s => String(s.id || s._id))
                      setSelectedStudentIds(prev => [...new Set([...prev, ...visible])])
                    }}
                    style={{ padding: '9px 14px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', color: '#334155', whiteSpace: 'nowrap' }}
                  >
                    Select All Shown
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const visible = allStudents.filter(s => {
                        const q = studentSearch.trim().toLowerCase()
                        return !q || [s.name, s.email, s.mhcetId, s._id, s.id].some(v => String(v || '').toLowerCase().includes(q))
                      }).map(s => String(s.id || s._id))
                      setSelectedStudentIds(prev => prev.filter(id => !visible.includes(id)))
                    }}
                    style={{ padding: '9px 14px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', color: '#334155', whiteSpace: 'nowrap' }}
                  >
                    Deselect All Shown
                  </button>
                </div>

                <div style={{ maxHeight: '320px', overflowY: 'auto', padding: '0 20px' }}>
                  {studentsLoading ? (
                    <p style={{ textAlign: 'center', padding: '24px', color: '#64748b', fontSize: '14px' }}>Loading students…</p>
                  ) : allStudents.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px', color: studentsLoadError ? '#b91c1c' : '#64748b', fontSize: '14px' }}>
                      <p style={{ margin: 0 }}>{studentsLoadError
                        ? `Could not load students: ${studentsLoadError}`
                        : 'No approved student accounts found. Approve student accounts in the Admin Dashboard, then reload this list.'}</p>
                    </div>
                  ) : (() => {
                    const q = studentSearch.trim().toLowerCase()
                    const filtered = allStudents.filter(s =>
                      !q || [s.name, s.email, s.mhcetId, s._id, s.id].some(v => String(v || '').toLowerCase().includes(q))
                    )
                    return filtered.length === 0 ? (
                      <p style={{ textAlign: 'center', padding: '24px', color: '#64748b', fontSize: '14px' }}>No students match your search.</p>
                    ) : filtered.map(student => {
                      const sid = String(student.id || student._id)
                      const checked = selectedStudentIds.includes(sid)
                      return (
                        <label
                          key={sid}
                          style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0', borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setSelectedStudentIds(prev =>
                              checked ? prev.filter(id => id !== sid) : [...prev, sid]
                            )}
                            style={{ width: '16px', height: '16px', accentColor: '#2563eb', flexShrink: 0, cursor: 'pointer' }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {student.name}
                            </div>
                            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {student.email} {student.mhcetId ? `· ID: ${student.mhcetId}` : ''}{student.branch ? ` · ${student.branch}` : ''}{student.batch ? ` · Batch ${student.batch}` : ''}
                            </div>
                          </div>
                          {checked && (
                            <span style={{ fontSize: '11px', fontWeight: 700, color: '#16a34a', background: '#dcfce7', padding: '2px 8px', borderRadius: '99px', flexShrink: 0 }}>
                              Selected
                            </span>
                          )}
                        </label>
                      )
                    })
                  })()}
                </div>

                {selectedStudentIds.length > 0 && (
                  <div style={{ padding: '12px 20px', background: '#f0fdf4', borderTop: '1px solid #bbf7d0', fontSize: '13px', color: '#166534', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '16px' }}>✓</span>
                    <span>
                      <strong>{selectedStudentIds.length} student{selectedStudentIds.length === 1 ? '' : 's'}</strong> will be assigned this test when you save.
                    </span>
                  </div>
                )}

                {selectedStudentIds.length === 0 && !studentsLoading && (
                  <div style={{ padding: '12px 20px', background: '#fffbeb', borderTop: '1px solid #fde68a', fontSize: '13px', color: '#92400e' }}>
                    Select at least one student to use Assigned visibility.
                  </div>
                )}
              </div>
            )}
          </div>
        )

      default:
        return null
    }
  }

  const getStepTitle = (step: number) => {
    switch (step) {
      case 1: return 'Basic Information'
      case 2: return 'Test Settings'
      case 3: return 'Chapter Selection'
      case 4: return 'Question Selection'
      case 5: return 'Test Instructions'
      case 6: return 'Scheduling'
      case 7: return 'Visibility'
      default: return ''
    }
  }

  return (
    <div className="amt-root">
      {/* Header */}
      <div className="amt-header">
        <div>
          <h1 className="amt-title">Mock Tests Management</h1>
          <p className="amt-sub">Create, schedule, and manage mock tests</p>
        </div>
        <div className="amt-header-actions">
          <button className="amt-create-btn" onClick={() => {
            setCreateError('')
            setEditingTest(null)
            setFormData(previous => ({ ...previous, questionSelection: 'bank', selectedQuestions: [], selectedChapters: {} }))
            setCurrentStep(1)
            setShowCreateModal(true)
          }}>
            <Plus size={18} />
            Create New Test
          </button>
          <button className="amt-assign-btn" onClick={() => setShowAssignmentManagement(true)}>
            <ClipboardList size={18} />
            Assign Mock Test
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="amt-stats-grid">
        <div className="amt-stat-card">
          <div className="amt-stat-icon" style={{ background: '#eff6ff', color: '#2563eb' }}>
            <FileText size={22} />
          </div>
          <div>
            <p className="amt-stat-label">Total Tests</p>
            <p className="amt-stat-value">{stats.total}</p>
          </div>
        </div>
        <div className="amt-stat-card">
          <div className="amt-stat-icon" style={{ background: '#f0fdf4', color: '#16a34a' }}>
            <PlayCircle size={22} />
          </div>
          <div>
            <p className="amt-stat-label">Active</p>
            <p className="amt-stat-value">{stats.active}</p>
          </div>
        </div>
        <div className="amt-stat-card">
          <div className="amt-stat-icon" style={{ background: '#fef9c3', color: '#a16207' }}>
            <Calendar size={22} />
          </div>
          <div>
            <p className="amt-stat-label">Scheduled</p>
            <p className="amt-stat-value">{stats.scheduled}</p>
          </div>
        </div>
        <div className="amt-stat-card">
          <div className="amt-stat-icon" style={{ background: '#f1f5f9', color: '#64748b' }}>
            <BarChart3 size={22} />
          </div>
          <div>
            <p className="amt-stat-label">Total Attempts</p>
            <p className="amt-stat-value">{stats.totalAttempts.toLocaleString()}</p>
          </div>
        </div>
        <div className="amt-stat-card">
          <div className="amt-stat-icon" style={{ background: '#faf5ff', color: '#8b5cf6' }}>
            <CheckCircle size={22} />
          </div>
          <div>
            <p className="amt-stat-label">Avg Score</p>
            <p className="amt-stat-value">{stats.avgScore}%</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="amt-toolbar">
        <div className="amt-tabs">
          {[
            { key: 'all', label: 'All Tests' },
            { key: 'active', label: 'Active' },
            { key: 'scheduled', label: 'Scheduled' },
            { key: 'draft', label: 'Draft' },
          ].map(tab => (
            <button
              key={tab.key}
              className={`amt-tab${activeTab === tab.key ? ' amt-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.key as TabType)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="amt-toolbar-right">
          <div className="amt-search-wrap">
            <Search size={16} className="amt-search-icon" />
            <input
              type="text"
              className="amt-search-input"
              placeholder="Search tests..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Tests Table */}
      <div className="amt-table-container">
        <table className="amt-table">
          <thead>
            <tr>
              <th>Test Name</th>
              <th>Subject</th>
              <th>Questions</th>
              <th>Duration</th>
              <th>Difficulty</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Avg Score</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="amt-empty">
                  <FileText size={48} />
                  <p>No tests found</p>
                </td>
              </tr>
            ) : (
              filtered.map(test => (
                <tr key={test._id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{test.title}</div>
                    {test.scheduledDate && (
                      <div style={{ fontSize: 11, color: '#2563eb', marginTop: 2 }}>
                        <Calendar size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                        {new Date(test.scheduledDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}{' '}
                        {new Date(test.scheduledDate).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </td>
                  <td>{test.subject}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <FileText size={14} />
                      {test.questions}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Clock size={14} />
                      {test.duration} min
                    </div>
                  </td>
                  <td>
                    <span className="amt-diff-badge" style={{ background: getDifficultyColor(test.difficulty), color: test.difficulty === 'Easy' ? '#15803d' : test.difficulty === 'Medium' ? '#a16207' : '#dc2626' }}>
                      {test.difficulty}
                    </span>
                  </td>
                  <td>
                    <span className={`amt-status-badge amt-status-badge--${test.status}`}>
                      {test.status === 'active' && <CheckCircle size={12} />}
                      {test.status.charAt(0).toUpperCase() + test.status.slice(1)}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Users size={14} />
                      {test.attempts.toLocaleString()}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <BarChart3 size={14} />
                      {test.avgScore > 0 ? `${test.avgScore}%` : '—'}
                    </div>
                  </td>
                  <td>{new Date(test.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                  <td>
                    <div className="amt-actions">
                      <button className="amt-action-btn" title="View Student Attempts" onClick={() => viewTestAttempts(test)}>
                        <Eye size={16} />
                      </button>
                      <button className="amt-action-btn" title="Edit" onClick={() => openEditWizard(test)}>
                        <Edit size={16} />
                      </button>
                      <button className="amt-action-btn" title="Settings" onClick={() => setSettingsTest(test)}>
                        <Settings size={16} />
                      </button>
                      <button className="amt-action-btn amt-action-btn--danger" title="Delete" onClick={() => deleteTest(test)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedTest && (
        <div className="amt-modal-overlay" onClick={() => setSelectedTest(null)}>
          <div className="amt-modal amt-attempts-modal" onClick={event => event.stopPropagation()}>
            <div className="amt-modal-header">
              <div>
                <h2>{selectedTest.title}</h2>
                <p className="amt-attempts-subtitle">Students who completed this exam</p>
              </div>
              <button className="amt-modal-close" onClick={() => setSelectedTest(null)}><X size={20} /></button>
            </div>
            <div className="amt-attempts-body">
              {attemptsLoading ? <p className="amt-attempts-empty">Loading student attempts...</p> : testAttempts.length === 0 ? <p className="amt-attempts-empty">No students have completed this exam yet.</p> : (
                <div className="amt-attempts-list">
                  {testAttempts.map(result => {
                    const student = typeof result.userId === 'object' ? result.userId : null
                    const percentage = result.totalMarks ? Math.round(result.score / result.totalMarks * 100) : 0
                    const displayName = student?.name || 'Student'
                    const displayEmail = student?.email || 'No email available'
                    return (
                      <div className="amt-attempt-row" key={result._id}>
                        <div><strong>{displayName}</strong><span>{displayEmail}</span></div>
                        <div><strong>{Math.round(result.score)}/{Math.round(result.totalMarks)}</strong><span>{percentage}% marks</span></div>
                        <div><strong>{result.percentile?.toFixed(1) || '0.0'}th</strong><span>{new Date(result.attemptedAt).toLocaleDateString('en-IN')}</span></div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {settingsTest && (
        <div className="amt-modal-overlay" onClick={() => setSettingsTest(null)}>
          <div className="amt-modal amt-small-modal" onClick={event => event.stopPropagation()}>
            <div className="amt-modal-header"><h2>Test Settings</h2><button className="amt-modal-close" onClick={() => setSettingsTest(null)}><X size={20} /></button></div>
            <p className="amt-settings-test-name">{settingsTest.title}</p>
            <label className="amt-status-select">Test status<select value={settingsTest.status} onChange={event => saveTestSettings(event.target.value as MockTest['status'])}><option value="active">Active</option><option value="scheduled">Scheduled</option><option value="draft">Draft</option></select></label>
          </div>
        </div>
      )}

      {/* Create Modal with Steps */}
      {showCreateModal && (
        <div className="amt-modal-overlay" onClick={() => { setShowCreateModal(false); setSelectedStudentIds([]); setStudentSearch('') }}>
<div className="amt-modal amt-modal--fullscreen" onClick={e => e.stopPropagation()}>
            <div className="amt-modal-header">
              <h2>{editingTest ? 'Edit Mock Test' : 'Create New Mock Test'}</h2>
              <button className="amt-modal-close" onClick={() => { setShowCreateModal(false); setSelectedStudentIds([]); setStudentSearch('') }}>
                <X size={20} />
              </button>
            </div>

            {/* Step Indicators */}
            <div className="amt-step-indicators">
              {[1, 2, 3, 4, 5, 6, 7].map(step => (
                <div key={step} className={`amt-step ${currentStep === step ? 'active' : ''} ${currentStep > step ? 'completed' : ''}`}>
                  <div className="amt-step-number">{step}</div>
                  <div className="amt-step-title">{getStepTitle(step)}</div>
                </div>
              ))}
            </div>

            <div className="amt-modal-body">
              {createError && (
                <div role="alert" style={{
                  marginBottom: 18,
                  padding: '12px 16px',
                  border: '1px solid #fecaca',
                  borderRadius: 10,
                  background: '#fef2f2',
                  color: '#b91c1c',
                  fontSize: 14,
                }}>
                  {createError}
                </div>
              )}
              {renderStepContent()}
            </div>

            <div className="amt-modal-footer">
              <button className="amt-btn amt-btn-secondary" onClick={() => { setShowCreateModal(false); setCurrentStep(1); setSelectedStudentIds([]); setStudentSearch('') }}>
                Cancel
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                {currentStep > 1 && (
                  <button className="amt-btn amt-btn-secondary" onClick={prevStep}>
                    <ChevronLeft size={16} />
                    Back
                  </button>
                )}
                {currentStep < 7 ? (
                  <button className="amt-btn amt-btn-primary" onClick={nextStep}>
                    Next
                    <ChevronRight size={16} />
                  </button>
                ) : (
                  <button className="amt-btn amt-btn-primary" onClick={handleCreateTest}>
                    <Plus size={16} />
                    {editingTest ? 'Save Changes' : 'Create Test'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}