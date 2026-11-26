import { useState, useEffect, useRef } from 'react'
import Sidebar, { type Page } from './Sidebar'
import TestInterface from './TestInterface'
import ExamInstructions from './ExamInstructions'
import UserAvatar from './UserAvatar'
import { mockTestsAPI, testsAPI, questionsAPI, session, type MockTest, type TestResult, type AuthUser, type StudentNotification } from '../lib/api'
import {
  getMockTestCategory,
  getMockTestMaximumMarks,
  normalizeMockTestSubject,
  selectCustomPracticeQuestionIds,
} from '../lib/mockTestCatalog'
import AssignedMockTests from './AssignedMockTests'
import NotificationCenter from './NotificationCenter'
import { supabase } from '../lib/supabaseClient'

type TabType = 'Full Length' | 'Subject-wise' | 'Chapter-wise' | 'Previous Year'
type DiffFilter = 'All Levels' | 'Easy' | 'Medium' | 'Hard'
type SubjFilter = 'All Subjects' | 'Physics' | 'Chemistry' | 'Mathematics' | 'Biology'
type TestSort = 'Recommended first' | 'Newest' | 'Shortest'
type AttemptFilter = 'All tests' | 'Not attempted' | 'Attempted' | 'Limit reached'
type DurationFilter = 'Any duration' | 'Under 60 min' | '60–120 min' | 'Over 120 min'

const TABS: TabType[] = ['Full Length', 'Subject-wise', 'Chapter-wise', 'Previous Year']
const SUBJECTS: SubjFilter[] = ['All Subjects', 'Physics', 'Chemistry', 'Mathematics', 'Biology']
const diffColors: Record<string, string> = {
  Easy: 'mt-diff-easy',
  Medium: 'mt-diff-medium',
  Hard: 'mt-diff-hard',
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null

const getSubjectVisual = (subject: SubjFilter) => {
  switch (subject) {
    case 'Physics': return { icon: 'science', color: 'blue' }
    case 'Chemistry': return { icon: 'science', color: 'teal' }
    case 'Mathematics': return { icon: 'functions', color: 'purple' }
    case 'Biology': return { icon: 'biotech', color: 'orange' }
    default: return { icon: 'assignment', color: 'blue' }
  }
}

interface MockTestsProps {
  onNavigate?: (page: Page) => void
}

export default function MockTests({ onNavigate }: MockTestsProps) {
  const user = session.get<AuthUser>()
  const examType = String(user?.examType || '').toUpperCase()
  const streamSubjects = examType === 'PCM'
    ? ['Physics', 'Chemistry', 'Mathematics']
    : examType === 'PCB'
      ? ['Physics', 'Chemistry', 'Biology']
      : ['Physics', 'Chemistry', 'Mathematics', 'Biology']
  const [activeTab, setActiveTab] = useState<TabType>('Full Length')
  const [diff, setDiff] = useState<DiffFilter>('All Levels')
  const [subj, setSubj] = useState<SubjFilter>('All Subjects')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<TestSort>('Newest')
  const [attemptFilter, setAttemptFilter] = useState<AttemptFilter>('All tests')
  const [durationFilter, setDurationFilter] = useState<DurationFilter>('Any duration')
  const [rangeVal, setRangeVal] = useState(60)
  const [customSubject, setCustomSubject] = useState('Physics')
  const [customChapter, setCustomChapter] = useState('')
  const [customDifficulty, setCustomDifficulty] = useState<DiffFilter>('All Levels')
  const [customQuestionCount, setCustomQuestionCount] = useState(20)
  const [customLoading, setCustomLoading] = useState(false)
  const [customError, setCustomError] = useState('')
  const [questionSubjects, setQuestionSubjects] = useState<string[]>([])
  const [chaptersBySubject, setChaptersBySubject] = useState<Record<string, string[]>>({})
  const [taxonomyError, setTaxonomyError] = useState('')
  const [mockTests, setMockTests] = useState<MockTest[]>([])
  const [testResults, setTestResults] = useState<TestResult[]>([])
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [mockTestsError, setMockTestsError] = useState('')
  const [analyticsError, setAnalyticsError] = useState('')
  const [showResumeDialog, setShowResumeDialog] = useState(false)
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null)
  const [notificationAssignmentId, setNotificationAssignmentId] = useState(() => {
    const key = 'cet:pending-notification-navigation'
    const raw = sessionStorage.getItem(key)
    if (!raw) return ''
    try {
      const pending = JSON.parse(raw) as { targetPage?: string; targetType?: string; targetId?: string }
      if (pending.targetPage !== 'mocktests') return ''
      sessionStorage.removeItem(key)
      return pending.targetType === 'assignment' ? pending.targetId || '' : ''
    } catch {
      sessionStorage.removeItem(key)
      return ''
    }
  })
  const [selectedTestName, setSelectedTestName] = useState(() => localStorage.getItem('cet_selected_test_name') || 'MHT-CET Mock Test')
  const [selectedMockTestId, setSelectedMockTestId] = useState(() => localStorage.getItem('cet_selected_mock_test_id') || '')
  const [selectedTestDuration, setSelectedTestDuration] = useState<number>(() => {
    const saved = localStorage.getItem('cet_selected_test_duration')
    return saved ? Number(saved) : 120
  })
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('cet_selected_question_ids')
    try {
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const [selectedQuestionCount, setSelectedQuestionCount] = useState<number>(() => {
    const saved = localStorage.getItem('cet_selected_question_count')
    return saved ? Number(saved) : 150
  })
  const bypassBackGuard = useRef(false)
  const mockTestsRequestInProgress = useRef(false)

  // ── Restore exam state on reload ─────────────────────────────────────────
  const EXAM_STATE_KEY = 'cet_exam_state'
  const savedState = localStorage.getItem(EXAM_STATE_KEY)
  const currentUserId = String(user?.id || user?._id || '')
  const examBelongsToUser = Boolean(currentUserId && localStorage.getItem('cet_exam_owner_id') === currentUserId)
  const [testActive, setTestActive] = useState(savedState === 'test' && examBelongsToUser)
  const [startingTest, setStartingTest] = useState(savedState === 'instructions' && examBelongsToUser)

  const hasActiveInProgressExam = () => {
    const ownedExam = localStorage.getItem('cet_exam_owner_id') === currentUserId
    const examState = ownedExam ? localStorage.getItem(EXAM_STATE_KEY) : null
    const inProgressTest = localStorage.getItem('cet_inProgressTest')
    try {
      const progressOwnerId = inProgressTest ? JSON.parse(inProgressTest).userId : null
      return examState === 'test' || examState === 'instructions' || Boolean(currentUserId && progressOwnerId === currentUserId)
    } catch {
      localStorage.removeItem('cet_inProgressTest')
      return examState === 'test' || examState === 'instructions'
    }
  }

  const enterExamInstructions = () => {
    if (hasActiveInProgressExam()) {
      setBlockedMessage('Please complete the first test before starting a new one.')
      return
    }

    localStorage.setItem(EXAM_STATE_KEY, 'instructions')
    localStorage.setItem('cet_exam_owner_id', currentUserId)
    setStartingTest(true)
  }

  const enterTest = () => {
    bypassBackGuard.current = false
    localStorage.setItem(EXAM_STATE_KEY, 'test')
    setStartingTest(false)
    setTestActive(true)
  }

  const exitExam = () => {
    localStorage.removeItem(EXAM_STATE_KEY)
    localStorage.removeItem('cet_exam_owner_id')
    localStorage.removeItem('cet_selected_mock_test_id')
    setSelectedMockTestId('')
    setTestActive(false)
    setStartingTest(false)
  }

  // ── Back button interception during exam ──────────────────────────────────
  useEffect(() => {
    const isExamOpen = testActive || startingTest
    if (!isExamOpen) return

    // Push a sentinel entry so the back button hits it first
    window.history.pushState({ examGuard: true }, '')

    const handlePopState = (e: PopStateEvent) => {
      if (bypassBackGuard.current) return
      // Browser just consumed our sentinel — show the resume dialog instead of leaving
      e.preventDefault?.()
      window.history.pushState({ examGuard: true }, '') // push sentinel back immediately
      setShowResumeDialog(true)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [testActive, startingTest])

  useEffect(() => {
    loadMockTests()
    loadTestResults()
    let refreshTimer: number | undefined
    const scheduleRefresh = () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => void loadMockTests(true), 250)
    }
    const channel = supabase
      .channel('student_mock_tests_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mock_tests' }, scheduleRefresh)
      .subscribe()
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') scheduleRefresh()
    }
    window.addEventListener('focus', refreshOnFocus)
    return () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      window.removeEventListener('focus', refreshOnFocus)
      void supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    questionsAPI.getSubjectsAndChapters()
      .then(data => {
        if (cancelled) return
        setQuestionSubjects(data.subjects)
        setChaptersBySubject(data.chaptersBySubject)
        setTaxonomyError('')
        if (data.subjects.length) {
          setCustomSubject(current => data.subjects.includes(current) ? current : data.subjects[0])
        }
      })
      .catch(error => {
        console.error('Failed to load custom practice topics:', error)
        if (!cancelled) setTaxonomyError('Topic options are temporarily unavailable. You can still build practice by subject.')
      })
    return () => { cancelled = true }
  }, [])

  const loadTestResults = async () => {
    try {
      const data = await testsAPI.getMyResults()
      setTestResults(data)
      setAnalyticsError('')
    } catch (error) {
      console.error('Failed to load test analytics:', error)
      setAnalyticsError('Your performance data could not be loaded.')
    } finally {
      setAnalyticsLoading(false)
    }
  }

  const loadMockTests = async (background = false) => {
    if (mockTestsRequestInProgress.current) return
    mockTestsRequestInProgress.current = true
    try {
      const data = await mockTestsAPI.getAll({ background })
      setMockTests(data)
      setMockTestsError('')
    } catch (error) {
      console.error('Failed to load mock tests:', error)
      setMockTestsError('Available tests could not be loaded. Please try again.')
    } finally {
      setLoading(false)
      mockTestsRequestInProgress.current = false
    }
  }

  const testsTaken = testResults.length
  const totalEarnedMarks = testResults.reduce((total, result) => total + (Number(result.score) || 0), 0)
  const totalAvailableMarks = testResults.reduce((total, result) => total + (Number(result.totalMarks) || 0), 0)
  const averageScore = testsTaken > 0 ? Math.round(totalEarnedMarks / testsTaken) : 0
  const averageMaxScore = testsTaken > 0 ? Math.round(totalAvailableMarks / testsTaken) : 0
  const practicedHours = Math.max(0, testResults.reduce((total, result) => total + (Number(result.duration) || 0), 0) / 3600)
  const answeredQuestions = testResults.reduce((total, result) => total + (Number(result.correct) || 0) + (Number(result.incorrect) || 0), 0)
  const correctQuestions = testResults.reduce((total, result) => total + (Number(result.correct) || 0), 0)
  const accuracy = answeredQuestions > 0 ? Math.round(correctQuestions / answeredQuestions * 100) : 0
  const completion = accuracy
  const subjectTotals = testResults.flatMap(result => result.subjectWiseScores || [])
    .reduce((subjects, subject) => {
      const current = subjects.get(subject.subject) || { score: 0, maxScore: 0 }
      subjects.set(subject.subject, { score: current.score + subject.score, maxScore: current.maxScore + subject.maxScore })
      return subjects
    }, new Map<string, { score: number; maxScore: number }>());
  const subjectPerformance = Array.from(subjectTotals.entries())
    .map(([label, value]) => ({ label, percentage: value.maxScore ? Math.round(value.score / value.maxScore * 100) : 0 }))
    .filter(subject => subjectTotals.get(subject.label)?.maxScore)
    .sort((a, b) => a.percentage - b.percentage)
  const weakSubjects = subjectPerformance
    .filter(subject => subject.percentage < 70)
    .filter(subject => streamSubjects.some(streamSubject => normalizeMockTestSubject(subject.label) === streamSubject))
    .slice(0, 3)

  const getTestDescription = (test: MockTest): string => {
    const config = asRecord(test.config)
    return typeof config?.description === 'string' && config.description.trim()
      ? config.description.trim()
      : `${test.subject}${test.examType ? ` · ${test.examType}` : ''}`
  }

  const testCards = mockTests.map(test => {
    const normalizedSubject = normalizeMockTestSubject(test.subject)
    const config = asRecord(test.config)
    const sections = Array.isArray(config?.sections) ? config.sections : []
    const sectionNames = sections
      .map(section => asRecord(section)?.name)
      .filter((name): name is string => typeof name === 'string')
      .join(' ')
      .toLowerCase()
    const subjectCoverage = SUBJECTS.filter(subject => subject !== 'All Subjects'
      && (normalizedSubject === subject || sectionNames.includes(subject.toLowerCase())))
    const weakSubjectMatch = weakSubjects.find(subject =>
      normalizeMockTestSubject(test.subject) === normalizeMockTestSubject(subject.label)
      || sectionNames.includes(subject.label.toLowerCase()))
    const attemptsUsed = testResults.filter(result => result.mockTestId
      ? result.mockTestId === test._id
      : result.testName.trim().toLowerCase() === test.title.trim().toLowerCase()).length
    const startsAtValue = typeof config?.startsAt === 'string' ? config.startsAt : test.scheduledDate
    const startsAt = startsAtValue ? Date.parse(startsAtValue) : Number.NaN
    const endsAt = typeof config?.endsAt === 'string' ? Date.parse(config.endsAt) : Number.NaN
    const now = Date.now()
    const available = test.status === 'active'
      && (!Number.isFinite(startsAt) || startsAt <= now)
      && (!Number.isFinite(endsAt) || endsAt > now)
    const visual = getSubjectVisual(normalizedSubject)
    const negativeMarks = [...new Set(sections
      .map(section => Number(asRecord(section)?.negativeMarks))
      .filter(value => Number.isFinite(value) && value > 0)
    )].sort((a, b) => a - b)
    return {
      source: test,
      id: test._id,
      icon: visual.icon,
      iconColor: visual.color,
      title: test.title,
      desc: getTestDescription(test),
      questions: test.questions,
      mins: test.duration,
      maxMarks: getMockTestMaximumMarks(test),
      negativeMarks,
      maxAttempts: test.maxAttempts || 1,
      attemptsUsed,
      difficulty: test.difficulty,
      subject: normalizedSubject,
      subjectCoverage,
      category: getMockTestCategory(test),
      recommended: Boolean(weakSubjectMatch),
      recommendation: weakSubjectMatch?.label || '',
      available,
      createdAt: test.createdAt,
    }
  })

  const query = searchQuery.trim().toLowerCase()
  const filtered = testCards.filter(test => {
    const matchesTab = test.category === activeTab
    const matchesDifficulty = diff === 'All Levels' || test.difficulty === diff
    const matchesSubject = subj === 'All Subjects' || test.subject === subj || test.subjectCoverage.includes(subj)
    const matchesSearch = !query || [
      test.title,
      test.desc,
      test.subject,
      test.subjectCoverage.join(' '),
      test.category,
      test.source.examType || '',
    ].some(value => value.toLowerCase().includes(query))
    const matchesAttempts = attemptFilter === 'All tests'
      || attemptFilter === 'Not attempted' && test.attemptsUsed === 0
      || attemptFilter === 'Attempted' && test.attemptsUsed > 0 && test.attemptsUsed < test.maxAttempts
      || attemptFilter === 'Limit reached' && test.attemptsUsed >= test.maxAttempts
    const matchesDuration = durationFilter === 'Any duration'
      || durationFilter === 'Under 60 min' && test.mins < 60
      || durationFilter === '60–120 min' && test.mins >= 60 && test.mins <= 120
      || durationFilter === 'Over 120 min' && test.mins > 120
    return matchesTab && matchesDifficulty && matchesSubject && matchesSearch && matchesAttempts && matchesDuration
  }).sort((a, b) => {
    if (sortBy === 'Recommended first' && a.recommended !== b.recommended) return a.recommended ? -1 : 1
    if (sortBy === 'Shortest') return a.mins - b.mins
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  const availableTests = testCards.filter(test => test.available && test.attemptsUsed < test.maxAttempts)

  const startMockTest = (test: MockTest) => {
    const config = asRecord(test.config)
    const startsAtValue = typeof config?.startsAt === 'string' ? config.startsAt : test.scheduledDate
    const startsAt = startsAtValue ? Date.parse(startsAtValue) : Number.NaN
    const endsAt = typeof config?.endsAt === 'string' ? Date.parse(config.endsAt) : Number.NaN
    if (test.status !== 'active'
      || (Number.isFinite(startsAt) && startsAt > Date.now())
      || (Number.isFinite(endsAt) && endsAt <= Date.now())) {
      setBlockedMessage('This test is not available yet.')
      return
    }
    if (analyticsLoading || analyticsError) {
      setBlockedMessage('Your attempt history could not be verified. Please try again before starting this test.')
      return
    }
    const attemptsUsed = testResults.filter(result => result.mockTestId
      ? result.mockTestId === test._id
      : result.testName.trim().toLowerCase() === test.title.trim().toLowerCase()).length
    if (attemptsUsed >= (test.maxAttempts || 1)) {
      setBlockedMessage('You have reached the attempt limit for this test.')
      return
    }
    if (hasActiveInProgressExam()) {
      setBlockedMessage('Please complete the first test before starting a new one.')
      return
    }
    const questionIds = test.questionIds || []
    localStorage.setItem('cet_selected_mock_test_id', test._id)
    localStorage.setItem('cet_selected_test_name', test.title)
    localStorage.setItem('cet_selected_test_duration', String(test.duration))
    localStorage.setItem('cet_selected_question_ids', JSON.stringify(questionIds))
    localStorage.setItem('cet_selected_question_count', String(test.questions))
    setSelectedTestName(test.title)
    setSelectedMockTestId(test._id)
    setSelectedTestDuration(test.duration)
    setSelectedQuestionCount(test.questions)
    setSelectedQuestionIds(questionIds)
    localStorage.setItem(EXAM_STATE_KEY, 'instructions')
    localStorage.setItem('cet_exam_owner_id', currentUserId)
    setStartingTest(true)
  }

  const handleNotification = (notification: StudentNotification) => {
    if (notification.targetType && notification.targetId) {
      sessionStorage.setItem('cet:pending-notification-navigation', JSON.stringify({
        targetPage: notification.targetPage,
        targetType: notification.targetType,
        targetId: notification.targetId,
      }))
    }
    onNavigate?.(notification.targetPage)
  }

  const generateCustomPractice = async () => {
    if (hasActiveInProgressExam()) {
      setBlockedMessage('Please complete the first test before starting a new one.')
      return
    }
    setCustomLoading(true)
    setCustomError('')
    try {
      const bankQuestions = await questionsAPI.getAll({ subject: customSubject, isActive: true })
      const matchingQuestions = bankQuestions.filter(question =>
        question.isActive
        && question._id
        && (!customChapter || question.chapter === customChapter || question.topic === customChapter)
        && (customDifficulty === 'All Levels' || question.difficulty === customDifficulty))
      if (matchingQuestions.length < customQuestionCount) {
        setCustomError(`Only ${matchingQuestions.length} matching questions are available. Choose fewer questions or broaden your selection.`)
        return
      }

      const questionIds = selectCustomPracticeQuestionIds(matchingQuestions, {
        chapter: customChapter,
        difficulty: customDifficulty,
        count: customQuestionCount,
      })
      if (questionIds.length < customQuestionCount) {
        setCustomError(`Only ${questionIds.length} distinct matching questions are available. Choose fewer questions or broaden your selection.`)
        return
      }
      const testName = `Practice · ${customSubject}${customChapter ? ` · ${customChapter}` : ''}`
      localStorage.removeItem('cet_selected_mock_test_id')
      localStorage.setItem('cet_selected_test_name', testName)
      localStorage.setItem('cet_selected_test_duration', String(rangeVal))
      localStorage.setItem('cet_selected_question_ids', JSON.stringify(questionIds))
      localStorage.setItem('cet_selected_question_count', String(questionIds.length))
      setSelectedTestName(testName)
      setSelectedMockTestId('')
      setSelectedTestDuration(rangeVal)
      setSelectedQuestionCount(questionIds.length)
      setSelectedQuestionIds(questionIds)
      localStorage.setItem(EXAM_STATE_KEY, 'instructions')
      localStorage.setItem('cet_exam_owner_id', currentUserId)
      setStartingTest(true)
    } catch (error) {
      console.error('Failed to build a custom practice test:', error)
      setCustomError(error instanceof Error ? error.message : 'Custom practice could not be created. Please try again.')
    } finally {
      setCustomLoading(false)
    }
  }

  const availableCustomSubjects = (questionSubjects.length ? questionSubjects : streamSubjects)
    .filter(subject => streamSubjects.some(streamSubject => normalizeMockTestSubject(subject) === streamSubject))
  const customChapters = Object.entries(chaptersBySubject)
    .find(([subject]) => subject.toLowerCase() === customSubject.toLowerCase())?.[1] || []

  // ── Resume Test Dialog ───────────────────────────────────────────────────
  const ResumeDialog = () => (
    <>
      <style>{`
        @keyframes rd-fadein  { from { opacity:0 } to { opacity:1 } }
        @keyframes rd-slidein { from { transform:translateY(20px) scale(.97); opacity:0 } to { transform:translateY(0) scale(1); opacity:1 } }
      `}</style>
      <div style={{
        position: 'fixed', inset: 0, zIndex: 999998,
        background: 'rgba(23, 44, 79, 0.75)', backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'rd-fadein 0.18s ease',
      }}>
        <div style={{
          background: '#fff', borderRadius: '20px', width: '90%', maxWidth: '440px',
          padding: '40px 36px 32px', textAlign: 'center',
          boxShadow: '0 32px 64px rgba(0,0,0,0.3)',
          animation: 'rd-slidein 0.22s cubic-bezier(0.34,1.56,0.64,1)',
          position: 'relative', overflow: 'hidden',
        }}>
          {/* Blue accent strip */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '5px', background: 'linear-gradient(90deg,#172c4f,#d21436)', borderRadius: '20px 20px 0 0' }} />

          {/* Icon */}
          <div style={{ width: '68px', height: '68px', borderRadius: '50%', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '34px', color: '#d21436', fontVariationSettings: "'FILL' 1" }}>quiz</span>
          </div>

          {/* Tag */}
          <div style={{ display: 'inline-block', padding: '4px 12px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '12px', background: '#ffffff', color: '#171717', border: '1px solid #e5e5e5' }}>
            Exam In Progress
          </div>

          <h2 style={{ margin: '0 0 10px', fontSize: '20px', fontWeight: 800, color: '#171717', lineHeight: 1.3 }}>
            You have an exam in progress
          </h2>
          <p style={{ margin: '0 0 28px', fontSize: '13.5px', color: '#171717', lineHeight: 1.65 }}>
            Your answers and timer are saved. Would you like to resume your test or exit?
          </p>

          {/* Resume button */}
          <button
            autoFocus
            onClick={() => setShowResumeDialog(false)}
            style={{
              width: '100%', padding: '14px', borderRadius: '12px', border: 'none',
              background: 'linear-gradient(135deg,#172c4f,#d21436)', color: '#fff',
              fontSize: '15px', fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 6px 20px rgba(210, 20, 54, 0.35)', marginBottom: '10px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px', fontVariationSettings: "'FILL' 0" }}>play_arrow</span>
            Resume Test
          </button>

          {/* Exit button */}
          <button
            onClick={() => {
              bypassBackGuard.current = true
              setShowResumeDialog(false)
              exitExam()
              // Pop the sentinel history entry we pushed, then exit
              window.history.go(-1)
            }}
            style={{
              width: '100%', padding: '12px', borderRadius: '12px', border: '1.5px solid #e5e5e5',
              background: '#ffffff', color: '#171717',
              fontSize: '14px', fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px', fontVariationSettings: "'FILL' 0" }}>exit_to_app</span>
            Exit Exam & Go Back
          </button>

          <p style={{ margin: '16px 0 0', fontSize: '11px', color: '#171717' }}>
            Exiting will end your current exam session. Your progress may not be saved.
          </p>
        </div>
      </div>
    </>
  )

  return (
    <>
    {showResumeDialog && <ResumeDialog />}
    {blockedMessage && (
      <div
        role="alert"
        style={{
          position: 'fixed',
          top: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 999999,
          background: '#f8f8f8',
          color: '#d21436',
          border: '1px solid #d21436',
          borderRadius: '12px',
          boxShadow: '0 20px 45px rgba(23, 44, 79, 0.18)',
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          maxWidth: '90vw',
          fontWeight: 600,
          letterSpacing: '0.01em',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>warning</span>
        <span>{blockedMessage}</span>
        <button
          type="button"
          onClick={() => setBlockedMessage(null)}
          style={{
            border: 'none',
            background: 'transparent',
            color: '#d21436',
            fontWeight: 700,
            cursor: 'pointer',
            marginLeft: '8px',
            fontSize: '16px',
          }}
          aria-label="Dismiss warning"
        >
          ×
        </button>
      </div>
    )}
    {testActive ? (
      <TestInterface
        onClose={exitExam}
        examName={selectedTestName}
        mockTestId={selectedMockTestId || undefined}
        durationMinutes={selectedTestDuration}
        questionCount={selectedQuestionCount}
        questionIds={selectedQuestionIds}
        onBackToAnalysis={() => {
          exitExam()
          onNavigate?.('analytics')
        }}
        onSubmissionComplete={() => {
          exitExam()
          onNavigate?.('dashboard')
        }}
        onBackRequest={() => setShowResumeDialog(true)}
      />
    ) : startingTest ? (
      <ExamInstructions
        onStart={enterTest}
        onCancel={() => {
          sessionStorage.removeItem(EXAM_STATE_KEY)
          setStartingTest(false)
        }}
      />
    ) : notificationAssignmentId ? (
      <div className="db-root mt-page-content">
        <Sidebar activePage="mocktests" onNavigate={onNavigate} onStartTest={enterExamInstructions} />
        <main className="db-main">
          <div className="db-content">
            <AssignedMockTests
              embedded
              focusAssignmentId={notificationAssignmentId}
              onBack={() => setNotificationAssignmentId('')}
              toolbarActions={(
                <button type="button" className="mt-quick-btn" onClick={() => setNotificationAssignmentId('')}>
                  Browse tests
                </button>
              )}
            />
          </div>
        </main>
      </div>
    ) : (
    <div className="db-root mt-page-content">

      {/* ── Sidebar ──────────────────────────────── */}
      <Sidebar activePage="mocktests" onNavigate={onNavigate} onStartTest={enterExamInstructions} />

      {/* ── Main ─────────────────────────────────── */}
      <main className="db-main">

        {/* Topbar */}
        <header className="mt-topbar">
          <div className="mt-topbar-left">
            <button
              type="button"
              className="mt-mobile-menu-btn"
              onClick={() => window.dispatchEvent(new CustomEvent('cet:toggle-nav'))}
              aria-label="Toggle navigation menu"
            >
              <span className="material-symbols-outlined">menu</span>
            </button>
            <h1 className="mt-topbar-title">MHT-CET Prep</h1>
          </div>
          <div className="mt-topbar-right">
            <button
              type="button"
              className="mt-icon-btn"
              onClick={() => window.dispatchEvent(new CustomEvent('cet:open-qr'))}
              title="Open on Phone / QR Scanner"
              aria-label="Open on Phone or scan QR code"
            >
              <span className="material-symbols-outlined" style={{ color: '#d21436' }}>qr_code_2</span>
            </button>
            <NotificationCenter onOpenNotification={handleNotification} />
            <button className="mt-icon-btn">
              <span className="material-symbols-outlined">help</span>
            </button>
            <div className="mt-avatar-wrap">
              <UserAvatar user={user} className="mt-avatar" onClick={() => onNavigate?.('settings')} />
            </div>
          </div>
        </header>

        <div className="mt-content">

          {/* Hero */}
          <div className="mt-hero">
            <div>
              <p className="mt-eyebrow">YOUR PREPARATION</p>
              <h2 className="mt-hero-title">Practice with purpose</h2>
              <p className="mt-hero-sub">Choose a mock test or build a focused practice set from the question bank.</p>
            </div>
          </div>

          <AssignedMockTests
            embedded
            toolbarActions={
              <>
                <button
                  type="button"
                  className="mt-quick-btn"
                  disabled={!availableTests.length || analyticsLoading || Boolean(analyticsError)}
                  onClick={() => availableTests[0] && startMockTest(availableTests[0].source)}
                >
                  <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
                  {analyticsLoading ? 'Checking attempts…' : analyticsError ? 'Attempt history unavailable' : availableTests.length ? 'Quick start a mock' : 'No mock tests available'}
                </button>
                <button
                  type="button"
                  className="mt-quick-btn mt-quick-btn--secondary"
                  onClick={() => document.getElementById('assigned-mock-tests')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  <span className="material-symbols-outlined">assignment_turned_in</span>
                  View assigned tests
                </button>
              </>
            }
          />

          <div className="mt-grid">

            {/* Left: Tests */}
            <div className="mt-left-col">

              {/* Filter bar */}
              <div className="mt-filter-bar">
                <div className="mt-tabs">
                  {TABS.map(tab => (
                    <button
                      type="button"
                      key={tab}
                      className={`mt-tab${activeTab === tab ? ' mt-tab--active' : ''}`}
                      onClick={() => setActiveTab(tab)}
                    >{tab}</button>
                  ))}
                </div>
                <div className="mt-filter-controls">
                  <label className="mt-catalog-search">
                    <span className="material-symbols-outlined">search</span>
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={event => setSearchQuery(event.target.value)}
                      placeholder="Search tests and subjects..."
                      aria-label="Search available tests"
                    />
                  </label>
                  <div className="mt-filter-group">
                    <label className="mt-filter-label" htmlFor="mt-difficulty">Difficulty</label>
                    <select id="mt-difficulty" className="mt-select" value={diff} onChange={e => setDiff(e.target.value as DiffFilter)}>
                      {(['All Levels', 'Easy', 'Medium', 'Hard'] as DiffFilter[]).map(value => <option key={value}>{value}</option>)}
                    </select>
                  </div>
                  <div className="mt-filter-group">
                    <label className="mt-filter-label" htmlFor="mt-subject">Subject</label>
                    <select id="mt-subject" className="mt-select" value={subj} onChange={e => setSubj(e.target.value as SubjFilter)}>
                      {SUBJECTS.map(subject => <option key={subject}>{subject}</option>)}
                    </select>
                  </div>
                  <div className="mt-filter-group">
                    <label className="mt-filter-label" htmlFor="mt-duration">Duration</label>
                    <select id="mt-duration" className="mt-select" value={durationFilter} onChange={e => setDurationFilter(e.target.value as DurationFilter)}>
                      {(['Any duration', 'Under 60 min', '60–120 min', 'Over 120 min'] as DurationFilter[]).map(value => <option key={value}>{value}</option>)}
                    </select>
                  </div>
                  <div className="mt-filter-group">
                    <label className="mt-filter-label" htmlFor="mt-attempts">Attempts</label>
                    <select id="mt-attempts" className="mt-select" value={attemptFilter} disabled={analyticsLoading || Boolean(analyticsError)} onChange={e => setAttemptFilter(e.target.value as AttemptFilter)}>
                      {(['All tests', 'Not attempted', 'Attempted', 'Limit reached'] as AttemptFilter[]).map(value => <option key={value}>{value}</option>)}
                    </select>
                  </div>
                  <div className="mt-filter-group">
                    <label className="mt-filter-label" htmlFor="mt-sort">Sort</label>
                    <select id="mt-sort" className="mt-select" value={sortBy} onChange={e => setSortBy(e.target.value as TestSort)}>
                      <option disabled={!weakSubjects.length}>Recommended first</option>
                      <option>Newest</option>
                      <option>Shortest</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    className="mt-reset-filters"
                    onClick={() => {
                      setSearchQuery('')
                      setDiff('All Levels')
                      setSubj('All Subjects')
                      setAttemptFilter('All tests')
                      setDurationFilter('Any duration')
                      setSortBy('Newest')
                    }}
                  >Reset filters</button>
                </div>
                <p className="mt-result-count" aria-live="polite">
                  {loading ? 'Loading tests…' : `Showing ${filtered.length} of ${testCards.length} available tests`}
                </p>
              </div>

              {/* Test Cards Grid */}
              <div className="mt-cards-grid">
                {mockTestsError && (
                  <div className="mt-empty mt-empty--error" role="alert">
                    <span className="material-symbols-outlined mt-empty-icon">cloud_off</span>
                    <p>{mockTestsError}</p>
                    <button type="button" className="mt-retry-btn" onClick={() => void loadMockTests()}>Try again</button>
                  </div>
                )}
                {loading && (
                  <div className="mt-empty">
                    <span className="material-symbols-outlined mt-empty-icon">progress_activity</span>
                    <p>Loading available tests...</p>
                  </div>
                )}
                {!loading && !mockTestsError && filtered.length === 0 && (
                  <div className="mt-empty">
                    <span className="material-symbols-outlined mt-empty-icon">search_off</span>
                    <h3>{testCards.length ? 'No tests match these filters' : 'No mock tests available yet'}</h3>
                    <p>{testCards.length ? 'Try changing your search or clearing one of the filters.' : 'Published tests will appear here when they are available for your account.'}</p>
                    {testCards.length > 0 && <button type="button" className="mt-retry-btn" onClick={() => {
                      setSearchQuery('')
                      setDiff('All Levels')
                      setSubj('All Subjects')
                      setAttemptFilter('All tests')
                      setDurationFilter('Any duration')
                      setSortBy('Newest')
                    }}>Clear filters</button>}
                  </div>
                )}
                {filtered.map(test => {
                  const attemptLimitReached = test.attemptsUsed >= test.maxAttempts
                  return (
                  <div key={test.id} className="mt-glass-card mt-test-card">
                    {test.recommended && <div className="mt-recommended-badge">Focus: {test.recommendation}</div>}
                    <div className={`mt-card-icon mt-icon--${test.iconColor}`}>
                      <span className="material-symbols-outlined">{test.icon}</span>
                    </div>
                    <span className="mt-test-category">{test.category}</span>
                    <h3 className="mt-card-title">{test.title}</h3>
                    <p className="mt-card-desc">{test.desc}</p>
                    <div className="mt-card-meta">
                      <span className="mt-meta-item">
                        <span className="material-symbols-outlined">format_list_bulleted</span>
                        {test.questions} questions
                      </span>
                      <span className="mt-meta-item">
                        <span className="material-symbols-outlined">schedule</span>
                        {test.mins} min
                      </span>
                      {test.maxMarks && <span className="mt-meta-item">{test.maxMarks} marks</span>}
                      {test.negativeMarks.length > 0 && (
                        <span className="mt-meta-item">
                          Negative marking · {test.negativeMarks.map(value => `−${value}`).join(' / ')}
                        </span>
                      )}
                      <span className={`mt-diff-badge ${diffColors[test.difficulty] || ''}`}>{test.difficulty}</span>
                    </div>
                    <div className="mt-test-footer">
                      <span className="mt-attempt-status">
                        {analyticsLoading
                          ? 'Checking attempts…'
                          : analyticsError
                            ? 'Attempt history unavailable'
                            : test.available
                          ? `${Math.max(0, test.maxAttempts - test.attemptsUsed)} of ${test.maxAttempts} attempts left`
                          : 'Not available yet'}
                      </span>
                      <button
                        type="button"
                        className={`mt-start-btn${test.available && !attemptLimitReached ? ' mt-start-btn--primary' : ''}`}
                        disabled={!test.available || analyticsLoading || Boolean(analyticsError) || attemptLimitReached && !onNavigate}
                        onClick={() => attemptLimitReached ? onNavigate?.('results') : startMockTest(test.source)}
                      >
                        {attemptLimitReached ? 'View results' : analyticsLoading ? 'Checking…' : analyticsError ? 'Unavailable' : test.available ? 'Start test' : 'Unavailable'}
                        {test.available && !attemptLimitReached && <span className="material-symbols-outlined">arrow_forward</span>}
                      </button>
                    </div>
                  </div>
                  )
                })}
              </div>
            </div>

            {/* Right: Sidebar widgets */}
            <div className="mt-right-col">

              <section className="mt-ai-card" id="mt-custom-practice">
                <div className="mt-ai-card-inner">
                  <div className="mt-ai-header">
                    <span className="material-symbols-outlined mt-ai-icon">tune</span>
                    <h3 className="mt-ai-title">Build a practice test</h3>
                  </div>
                  <p className="mt-ai-desc">Choose a subject and create a timed set using active questions from the student question bank.</p>
                  <div className="mt-custom-focus">
                    <span className="mt-field-label">Focus subjects from your results</span>
                    {weakSubjects.length ? (
                      <div className="mt-topic-chips">
                        {weakSubjects.map(subject => (
                          <button
                            type="button"
                            key={subject.label}
                            className={`mt-topic-chip${normalizeMockTestSubject(customSubject) === normalizeMockTestSubject(subject.label) ? ' mt-topic-chip--active' : ''}`}
                            onClick={() => {
                              const matchingSubject = availableCustomSubjects.find(option =>
                                normalizeMockTestSubject(option) === normalizeMockTestSubject(subject.label))
                              if (matchingSubject) setCustomSubject(matchingSubject)
                              setCustomChapter('')
                            }}
                          >{subject.label} · {subject.percentage}%</button>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-custom-note">
                        {testsTaken
                          ? 'No subject-level weakness is available in your results. Choose any subject below.'
                          : 'Complete a test for personalized subject insights, or choose a subject below.'}
                      </p>
                    )}
                  </div>
                  <div className="mt-ai-fields">
                    <div>
                      <label className="mt-field-label" htmlFor="mt-custom-subject">Subject</label>
                      <select
                        id="mt-custom-subject"
                        className="mt-custom-select"
                        value={customSubject}
                        onChange={event => {
                          setCustomSubject(event.target.value)
                          setCustomChapter('')
                        }}
                        disabled={!availableCustomSubjects.length}
                      >
                        {availableCustomSubjects.map(subject => <option key={subject} value={subject}>{subject}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mt-field-label" htmlFor="mt-custom-chapter">Chapter or topic</label>
                      <select
                        id="mt-custom-chapter"
                        className="mt-custom-select"
                        value={customChapter}
                        onChange={event => setCustomChapter(event.target.value)}
                      >
                        <option value="">All chapters</option>
                        {customChapters.map(chapter => <option key={chapter} value={chapter}>{chapter}</option>)}
                      </select>
                      {taxonomyError && <p className="mt-custom-note" role="status">{taxonomyError}</p>}
                    </div>
                    <div>
                      <label className="mt-field-label" htmlFor="mt-custom-difficulty">Difficulty</label>
                      <select
                        id="mt-custom-difficulty"
                        className="mt-custom-select"
                        value={customDifficulty}
                        onChange={event => setCustomDifficulty(event.target.value as DiffFilter)}
                      >
                        {(['All Levels', 'Easy', 'Medium', 'Hard'] as DiffFilter[]).map(value => <option key={value}>{value}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mt-field-label" htmlFor="mt-custom-count">Question count</label>
                      <select
                        id="mt-custom-count"
                        className="mt-custom-select"
                        value={customQuestionCount}
                        onChange={event => setCustomQuestionCount(Number(event.target.value))}
                      >
                        {[10, 20, 30, 50].map(count => <option key={count} value={count}>{count} questions</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mt-field-label" htmlFor="mt-custom-duration">Time limit: {rangeVal} min</label>
                      <input
                        id="mt-custom-duration"
                        type="range" min={30} max={120} step={15} value={rangeVal}
                        onChange={e => setRangeVal(Number(e.target.value))}
                        className="mt-range"
                      />
                      <div className="mt-range-labels"><span>30 MIN</span><span>120 MIN</span></div>
                    </div>
                  </div>
                  {customError && <p className="mt-inline-error" role="alert">{customError}</p>}
                  <button
                    type="button"
                    className="mt-generate-btn"
                    onClick={() => void generateCustomPractice()}
                    disabled={customLoading || !availableCustomSubjects.length}
                  >
                    <span className={`material-symbols-outlined${customLoading ? ' mt-spin' : ''}`}>
                      {customLoading ? 'progress_activity' : 'play_arrow'}
                    </span>
                    {customLoading ? 'Preparing questions…' : 'Start custom practice'}
                  </button>
                </div>
              </section>

              {/* Test Analytics */}
              <div className="mt-glass-card mt-analytics-card">
                <h4 className="mt-analytics-title">Test Analytics</h4>
                {analyticsError && <p className="mt-inline-error" role="alert">{analyticsError}</p>}
                <div className="mt-analytics-top">
                  <div>
                    <span className="mt-big-score">
                      {testsTaken ? averageScore : '—'}
                      {testsTaken > 0 && averageMaxScore > 0 && <span className="mt-big-score-unit">/{averageMaxScore}</span>}
                    </span>
                    <span className="mt-score-label">Average score</span>
                  </div>
                  <div className="mt-ring-group">
                    <div className="mt-ring-wrap">
                      <svg className="mt-ring-svg" viewBox="0 0 80 80" aria-label={answeredQuestions ? `${accuracy}% accuracy` : 'No accuracy data yet'}>
                        <circle cx="40" cy="40" r="32" fill="transparent" stroke="#E8ECF2" strokeWidth="8" />
                        {answeredQuestions > 0 && (
                          <circle cx="40" cy="40" r="32" fill="transparent"
                            stroke="#D41236" strokeWidth="8"
                            strokeDasharray="200" strokeDashoffset={200 - (200 * completion) / 100}
                            strokeLinecap="round"
                            style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}
                          />
                        )}
                      </svg>
                      <div className="mt-ring-label">{answeredQuestions ? `${accuracy}%` : '—'}</div>
                    </div>
                    <span className="mt-ring-caption">Accuracy</span>
                  </div>
                </div>
                <div className="mt-analytics-rows">
                  {[
                    { label: 'Tests Taken', val: testsTaken.toString() },
                    { label: 'Questions answered', val: answeredQuestions ? answeredQuestions.toLocaleString() : '—' },
                    { label: 'Time practiced', val: testsTaken ? `${practicedHours.toFixed(1)} hrs` : '—' },
                  ].map(r => (
                    <div key={r.label} className="mt-analytics-row">
                      <span className="mt-analytics-row-label">{r.label}</span>
                      <span className="mt-analytics-row-val">{r.val}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-glass-card mt-chapters-card">
                <div className="mt-chapters-header">
                  <strong>Subject performance</strong>
                  <span>Based on your completed test results</span>
                </div>
                <div className="mt-chapters-list">
                  {subjectPerformance.length > 0 ? subjectPerformance.slice(0, 4).map(subject => (
                    <button
                      type="button"
                      key={subject.label}
                      className="mt-chapter-row"
                      onClick={() => {
                        const matchingSubject = availableCustomSubjects.find(option =>
                          normalizeMockTestSubject(option) === normalizeMockTestSubject(subject.label))
                        if (matchingSubject) {
                          setCustomSubject(matchingSubject)
                          setCustomChapter('')
                          document.getElementById('mt-custom-practice')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                        }
                      }}
                    >
                      <span className="mt-chapter-label">{subject.label}</span>
                      <span className={`mt-chapter-badge${subject.percentage < 70 ? ' mt-chapter-badge--focus' : ' mt-chapter-badge--strong'}`}>
                        {subject.percentage}% · {subject.percentage < 70 ? 'Focus' : 'On track'}
                      </span>
                    </button>
                  )) : (
                    <p className="mt-empty-chapters">
                      {analyticsError ? 'Subject performance is unavailable right now.' : 'Complete a test with subject-level scoring to see your performance here.'}
                    </p>
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>
      </main>
    </div>
    )}
    </>
  )
}
