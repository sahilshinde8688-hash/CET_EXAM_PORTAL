import { useState, useEffect, useRef } from 'react'
import type { Page } from './Sidebar'
import TestInterface from './TestInterface'
import AssignedMockTests from './AssignedMockTests'
import StudentDashboardView from './StudentDashboardView'
import { session, testsAPI, mockTestsAPI, mockTestAssignmentsAPI, type AuthUser, type MockTestAssignment, type TestResult } from '../lib/api'

interface DashboardProps {
  onNavigate?: (page: Page) => void
}

export default function Dashboard({ onNavigate }: DashboardProps) {
  const [showTest, setShowTest] = useState(false)
  const [showAssignedMockTests, setShowAssignedMockTests] = useState(false)
  const [assignedTests, setAssignedTests] = useState<MockTestAssignment[]>([])
  const [assignedTestsLoading, setAssignedTestsLoading] = useState(true)
  const [assignedTestsError, setAssignedTestsError] = useState('')
  const [inProgressTest, setInProgressTest] = useState<any>(null)
  const [testHistory, setTestHistory] = useState<TestResult[]>(() => testsAPI.getCachedDashboardResults() || [])
  const [dashboardLoading, setDashboardLoading] = useState(() => !testsAPI.getCachedDashboardResults())
  const [dashboardError, setDashboardError] = useState(false)
  const lastAssignmentRequestAt = useRef(0)
  const user = session.get<AuthUser>()
  const currentUserId = String(user?.id || user?._id || '')

  useEffect(() => {
    const inProgress = localStorage.getItem('cet_inProgressTest')
    if (inProgress) {
      try {
        const progress = JSON.parse(inProgress)
        if (currentUserId && progress.userId === currentUserId) {
          setInProgressTest(progress)
        } else {
          localStorage.removeItem('cet_inProgressTest')
          setInProgressTest(null)
        }
      } catch {
        localStorage.removeItem('cet_inProgressTest')
        setInProgressTest(null)
      }
    }

    let cancelled = false
    let assignmentRequestInFlight = false
    const cachedResults = testsAPI.getCachedDashboardResults()
    if (cachedResults) setTestHistory(cachedResults)

    testsAPI.getDashboardResults(true).then(results => {
      if (cancelled) return
      setTestHistory(results.sort((a, b) => new Date(b.attemptedAt).getTime() - new Date(a.attemptedAt).getTime()))
      setDashboardError(false)
    }).catch(error => {
      if (!cancelled) {
        console.error('Failed to load dashboard data:', error)
        setDashboardError(true)
      }
    }).finally(() => {
      if (!cancelled) setDashboardLoading(false)
    })
    const loadAssignedTests = (force = false) => {
      if (assignmentRequestInFlight) return
      if (!force && (document.hidden || Date.now() - lastAssignmentRequestAt.current < 30_000)) return
      assignmentRequestInFlight = true
      lastAssignmentRequestAt.current = Date.now()
      mockTestAssignmentsAPI.getStudentAssignments().then(response => {
        if (!cancelled) {
          setAssignedTests(response.assignments)
          setAssignedTestsError('')
        }
      }).catch(error => {
        if (!cancelled) {
          console.error('Failed to load assigned mock tests:', error)
          setAssignedTestsError(error instanceof Error ? error.message : 'Assigned mock tests could not be loaded.')
        }
      }).finally(() => {
        assignmentRequestInFlight = false
        if (!cancelled) setAssignedTestsLoading(false)
      })
    }
    loadAssignedTests(true)
    const assignmentRefresh = window.setInterval(loadAssignedTests, 60000)
    const refreshAssignmentsOnFocus = () => { loadAssignedTests() }
    window.addEventListener('focus', refreshAssignmentsOnFocus)
    return () => {
      cancelled = true
      window.clearInterval(assignmentRefresh)
      window.removeEventListener('focus', refreshAssignmentsOnFocus)
    }
  }, [currentUserId])

  useEffect(() => {
    let cancelled = false
    let checkingTest = false
    let lastTestCheckAt = 0

    const refreshInProgressTest = async (force = false) => {
      const saved = localStorage.getItem('cet_inProgressTest')
      if (!saved) {
        setInProgressTest(null)
        return
      }

      let progress: { userId?: string | null; title?: string; mockTestId?: string | null; durationMinutes?: number; questionCount?: number; questionIds?: string[] }
      try {
        progress = JSON.parse(saved)
      } catch {
        localStorage.removeItem('cet_inProgressTest')
        setInProgressTest(null)
        return
      }

      if (!currentUserId || progress.userId !== currentUserId) {
        localStorage.removeItem('cet_inProgressTest')
        setInProgressTest(null)
        return
      }

      const mockTestId = progress.mockTestId || localStorage.getItem('cet_selected_mock_test_id')
      if (!mockTestId || checkingTest) {
        setInProgressTest(progress)
        return
      }
      if (!force && (document.hidden || Date.now() - lastTestCheckAt < 30_000)) {
        setInProgressTest({ ...progress, mockTestId })
        return
      }

      checkingTest = true
      lastTestCheckAt = Date.now()
      try {
        const availableTests = await mockTestsAPI.getAll({ background: true })
        if (cancelled) return
        if (!availableTests.some(test => test._id === mockTestId)) {
          localStorage.removeItem('cet_inProgressTest')
          localStorage.removeItem('cet_exam_state')
          localStorage.removeItem('cet_exam_owner_id')
          localStorage.removeItem('cet_selected_mock_test_id')
          localStorage.removeItem('cet_exam_current_index')
          localStorage.removeItem('cet_exam_answers')
          localStorage.removeItem('cet_exam_marked')
          localStorage.removeItem('cet_exam_time_remaining')
          localStorage.removeItem('cet_exam_time_elapsed')
          localStorage.removeItem('cet_exam_duration_minutes')
          localStorage.removeItem('cet_exam_name')
          localStorage.removeItem('cet_selected_test_name')
          localStorage.removeItem('cet_selected_test_duration')
          localStorage.removeItem('cet_selected_question_ids')
          localStorage.removeItem('cet_selected_question_count')
          setInProgressTest(null)
          return
        }
        setInProgressTest({ ...progress, mockTestId })
      } catch (error) {
        if (!cancelled) console.error('Failed to verify in-progress test:', error)
      } finally {
        checkingTest = false
      }
    }

    refreshInProgressTest()
    const refreshInterval = window.setInterval(refreshInProgressTest, 60000)
    const refreshInProgressTestOnFocus = () => { void refreshInProgressTest() }
    window.addEventListener('focus', refreshInProgressTestOnFocus)
    const refreshOnStorage = () => { void refreshInProgressTest(true) }
    window.addEventListener('storage', refreshOnStorage)
    return () => {
      cancelled = true
      window.clearInterval(refreshInterval)
      window.removeEventListener('focus', refreshInProgressTestOnFocus)
      window.removeEventListener('storage', refreshOnStorage)
    }
  }, [currentUserId])

  if (showAssignedMockTests) {
    return <AssignedMockTests onBack={() => setShowAssignedMockTests(false)} />
  }

  if (showTest) {
    return (
      <TestInterface
        onClose={() => setShowTest(false)}
        onBackRequest={() => setShowTest(false)}
        examName={inProgressTest?.title || 'MHT-CET Mock Test'}
        mockTestId={inProgressTest?.mockTestId || undefined}
        durationMinutes={inProgressTest?.durationMinutes}
        questionCount={inProgressTest?.questionCount}
        questionIds={inProgressTest?.questionIds || []}
        onResultSaved={(result) => {
          setInProgressTest(null)
          setTestHistory(current => [result, ...current.filter(item => item._id !== result._id)])
        }}
      />
    )
  }

  return (
    <StudentDashboardView
      user={user}
      testHistory={testHistory}
      dashboardLoading={dashboardLoading}
      dashboardError={dashboardError}
      assignedTests={assignedTests}
      assignedTestsLoading={assignedTestsLoading}
      assignedTestsError={assignedTestsError}
      inProgressTest={inProgressTest}
      onNavigate={onNavigate}
      onStartTest={() => setShowTest(true)}
      onResumeTest={() => setShowTest(true)}
      onOpenAssignedTests={() => setShowAssignedMockTests(true)}
      onRetry={() => window.location.reload()}
    />
  )
}
