const express = require('express')
const router = express.Router()
const db = require('../services/dbService')
const { protect, adminOnly } = require('../middleware/auth')
const { apiLimiter, testSubmitLimiter } = require('../middleware/rateLimit')
const { validateCsrfToken } = require('../middleware/csrf')
const emailNotifications = require('../services/emailNotificationService')

const assignedResultVisibility = async (studentId) => {
  const assignments = (await db.getMockTestAssignments())
    .filter(assignment => assignment.studentIds.includes(String(studentId)))
  const visibilityByResultId = new Map()
  for (const assignment of assignments) {
    const attempts = await db.getMockTestAttempts(assignment._id, String(studentId))
    const visible = assignment.resultVisibility === 'immediate'
      || assignment.resultVisibility === 'after_close' && Date.now() >= new Date(assignment.endDateTime).getTime()
    for (const attempt of attempts) {
      if (attempt.resultId) visibilityByResultId.set(attempt.resultId, visible)
    }
  }
  return visibilityByResultId
}

// POST /api/tests — Save and authoritatively score a test result
router.post('/', protect, validateCsrfToken, testSubmitLimiter, async (req, res) => {
  const { testName, answers, duration, questionIds, mockTestId, submissionKey } = req.body
  try {
    if (submissionKey !== undefined && (typeof submissionKey !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionKey))) {
      return res.status(400).json({ success: false, message: 'The test submission identifier is invalid.' })
    }
    const userId = req.user.id || req.user._id
    const requestedMockTestId = typeof mockTestId === 'string' ? mockTestId : null
    const matchingTest = requestedMockTestId || typeof testName !== 'string'
      ? null
      : await db.getActiveMockTestByTitle(testName)
    const assignedMockTestId = requestedMockTestId || matchingTest?._id
    if (assignedMockTestId) {
      const hasAssignment = (await db.getMockTestAssignments()).some(assignment =>
        assignment.status === 'active' && assignment.mockTestId === assignedMockTestId)
      if (hasAssignment) {
        return res.status(403).json({
          success: false,
          message: 'This test must be started and submitted through its student assignment.',
        })
      }
    }

    // Server-side authoritative score calculation
    const result = await db.calculateAndCreateTestResult({
      userId,
      testName: testName || 'MHT-CET Mock Test',
      answers: answers || {},
      duration: Number(duration) || 0,
      questionIds: Array.isArray(questionIds) ? questionIds : [],
      mockTestId: requestedMockTestId || matchingTest?._id || null,
      submissionKey: submissionKey || null,
    })

    try {
      await emailNotifications.sendSavedResultNotifications(result._id || result.id)
    } catch (emailError) {
      console.error('[email] Could not queue result notification:', emailError.message)
    }
    res.status(201).json(result)
  } catch (err) {
    if (err.code === 'P0001' && err.message.includes('attempt limit')) {
      return res.status(409).json({
        success: false,
        message: 'You have used all attempts allowed for this mock test.',
      })
    }
    if (['P0002', 'MOCK_TEST_NOT_AVAILABLE'].includes(err.code)) {
      return res.status(404).json({ success: false, message: 'This mock test is no longer available.' })
    }
    if (err.code === 'MOCK_TEST_QUESTION_MISMATCH') {
      return res.status(400).json({ success: false, message: 'The submitted questions do not match this mock test.' })
    }
    if (err.code === 'MOCK_TEST_ID_REQUIRED') {
      return res.status(400).json({ success: false, message: 'The mock test could not be identified. Reload the test list and start the test again.' })
    }
    if (err.code === 'PGRST202') {
      return res.status(503).json({
        success: false,
        message: 'Mock-test attempt limits are not installed in the database yet. Apply all Supabase migrations, including 20261008_mock_test_attempt_limits.sql.',
      })
    }
    if (['42703', 'PGRST204'].includes(err.code) && /question_ids/i.test(err.message || '')) {
      return res.status(503).json({
        success: false,
        message: 'The database is missing the question_ids field required to save test submissions. Apply supabase/migrations/20261001_test_result_question_ids.sql in the Supabase SQL Editor, then retry.',
      })
    }
    res.status(500).json({ success: false, message: 'Failed to record test submission: ' + err.message })
  }
})

// GET /api/tests/my — Logged-in student's test results
router.get('/my', protect, apiLimiter, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id
    const results = await db.getTestResultsByUserId(userId)
    const visibility = await assignedResultVisibility(userId)
    res.json(results.filter(result => !visibility.has(result._id) || visibility.get(result._id)))
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// GET /api/tests/:id/review — Review answers and solutions for a completed test
router.get('/:id/review', protect, apiLimiter, async (req, res) => {
  try {
    const result = await db.getTestResultById(req.params.id)
    if (!result) {
      return res.status(404).json({ success: false, message: 'Test result not found' })
    }

    // Must be the student who took the test or an administrator
    const currentUserId = req.user.id || req.user._id
    if (result.userId !== currentUserId && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied to this test review.' })
    }
    if (req.user.role !== 'admin') {
      const visibility = await assignedResultVisibility(currentUserId)
      if (visibility.has(result._id) && !visibility.get(result._id)) {
        return res.status(403).json({ success: false, message: 'This result is not visible yet.' })
      }
    }

    // Answer keys are available only through the owner-checked review endpoint.
    const savedQuestionIds = Array.isArray(result.questionIds) ? result.questionIds.map(String) : []
    const reviewQuestionIds = savedQuestionIds.length
      ? savedQuestionIds
      : Object.keys(result.answers || {})
    const questionsById = reviewQuestionIds.length
      ? await db.getQuestions({ ids: reviewQuestionIds }, { isAdmin: true })
      : []
    const questionsByIdMap = new Map(questionsById.map(question => [String(question._id), question]))
    const questions = reviewQuestionIds
      .map(questionId => questionsByIdMap.get(questionId))
      .filter(Boolean)
    if (questions.length !== reviewQuestionIds.length) {
      return res.status(409).json({ success: false, message: 'Some questions from this test attempt are no longer available for review.' })
    }

    res.json({
      result,
      questions,
    })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load review: ' + err.message })
  }
})

// GET /api/tests — ADMIN ONLY: all results across all students
router.get('/', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    const [users, results] = await Promise.all([
      db.getAllUsers(),
      db.getAllTestResults({ summaryOnly: req.query.summary === 'true' }),
    ])
    const usersById = new Map(users.map(user => [String(user.id || user._id), user]))
    const allResults = results.map(result => {
      const user = usersById.get(String(result.userId))
      return {
        ...result,
        userId: user ? {
          _id: user.id || user._id,
          id: user.id || user._id,
          name: user.name,
          email: user.email,
          branch: user.branch,
        } : result.userId,
      }
    })
    res.json(allResults)
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router
