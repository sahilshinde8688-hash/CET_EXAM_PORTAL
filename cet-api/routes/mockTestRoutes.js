const express = require('express')
const router = express.Router()
const db = require('../services/dbService')
const { apiLimiter } = require('../middleware/rateLimit')
const { protect, adminOnly } = require('../middleware/auth')
const { validateCsrfToken } = require('../middleware/csrf')

const requireAdminQuery = (req, res, next) => {
  if (req.query.admin !== 'true') return next()
  return protect(req, res, () => adminOnly(req, res, next))
}

// GET all mock tests
router.get('/', requireAdminQuery, apiLimiter, async (req, res) => {
  try {
    const isAdminRequest = req.query.admin === 'true'
    const activatedTests = await db.activateDueScheduledMockTests()
    for (const test of activatedTests) {
      console.info(`[mock-test-schedule] Activated due mock test ${test.id} (${test.title}) during catalog request`)
    }
    const filters = isAdminRequest
      ? req.query
      : { ...req.query, status: 'active' }
    const tests = await db.getMockTests(filters)
    if (isAdminRequest) return res.json(tests)
    const assignments = await db.getMockTestAssignments()
    const assignedTestIds = new Set(assignments
      .filter(assignment => assignment.status === 'active')
      .map(assignment => assignment.mockTestId))
    return res.json(tests.filter(test => !assignedTestIds.has(test._id)))
  } catch (err) {
    console.error('Failed to load mock tests:', err)
    res.status(500).json({ success: false, message: 'Failed to load mock tests' })
  }
})

// GET single mock test
router.get('/:id', requireAdminQuery, apiLimiter, async (req, res) => {
  try {
    const activated = await db.activateScheduledMockTest(req.params.id)
    if (activated) {
      console.info(`[mock-test-schedule] Activated due mock test ${activated.id} (${activated.title}) during detail request`)
    }
    const test = await db.getMockTestById(req.params.id)
    const assignedOnly = req.query.admin !== 'true'
      && (await db.getMockTestAssignments()).some(assignment =>
        assignment.status === 'active' && assignment.mockTestId === req.params.id)
    if (!test || assignedOnly || (test.status !== 'active' && req.query.admin !== 'true')) {
      return res.status(404).json({ success: false, message: 'This mock test is not published or is no longer available.' })
    }
    res.json(test)
  } catch (err) {
    console.error('Failed to load mock test:', err)
    res.status(500).json({ success: false, message: 'Failed to load mock test' })
  }
})

// CREATE mock test — ADMIN ONLY
router.post('/', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    const { title, subject, questions, duration, difficulty } = req.body
    if (
      typeof title !== 'string' || !title.trim()
      || typeof subject !== 'string' || !subject.trim()
      || !Number.isInteger(Number(questions)) || Number(questions) < 1
      || !Number.isInteger(Number(duration)) || Number(duration) < 1
      || !Number.isInteger(Number(req.body.maxAttempts)) || Number(req.body.maxAttempts) < 1
      || !['Easy', 'Medium', 'Hard'].includes(difficulty)
    ) {
      return res.status(400).json({ success: false, message: 'Enter a test title and subject, positive question count, duration, and attempt limit, and a valid difficulty.' })
    }

    const test = await db.createMockTest({
      ...req.body,
      createdBy: req.user.name || req.user.email,
    })
    res.status(201).json(test)
  } catch (err) {
    console.error('Failed to create mock test:', err)
    const missingMockTestSchema = ['PGRST204', '42703'].includes(err?.code)
      && /exam_type|max_attempts/.test(String(err?.message || ''))
    if (missingMockTestSchema) {
      return res.status(503).json({
        success: false,
        message: 'The database is missing fields required for mock tests. Apply all Supabase migrations, including 20261007_mock_test_assignments.sql and 20261008_mock_test_attempt_limits.sql, then retry.',
      })
    }
    res.status(500).json({ success: false, message: 'The mock test could not be saved. Please retry; if this continues, contact the administrator.' })
  }
})

// UPDATE mock test — ADMIN ONLY
router.put('/:id', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    if (req.body.maxAttempts !== undefined
      && (!Number.isInteger(Number(req.body.maxAttempts)) || Number(req.body.maxAttempts) < 1)) {
      return res.status(400).json({ success: false, message: 'Maximum attempts must be a whole number greater than zero.' })
    }
    const updated = await db.updateMockTest(req.params.id, req.body)
    res.json(updated)
  } catch (err) {
    if (['PGRST204', '42703'].includes(err?.code)
      && /max_attempts/.test(String(err?.message || ''))) {
      return res.status(503).json({
        success: false,
        message: 'Mock-test attempt limits are not installed in the database yet. Apply all Supabase migrations, including 20261008_mock_test_attempt_limits.sql.',
      })
    }
    res.status(400).json({ success: false, message: 'Failed to update test' })
  }
})

// DELETE mock test — ADMIN ONLY
router.delete('/:id', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    const test = await db.getMockTestById(req.params.id)
    if (!test) return res.status(404).json({ success: false, message: 'Mock test not found.' })

    const assignments = (await db.getMockTestAssignments())
      .filter(assignment => assignment.mockTestId === req.params.id)
    const attemptsByAssignment = await Promise.all(assignments.map(assignment =>
      db.getMockTestAttempts(assignment._id)))
    const hasAttempts = attemptsByAssignment.some(attempts => attempts.length > 0)

    if (hasAttempts) {
      for (const assignment of assignments) {
        await db.updateMockTestAssignment(assignment._id, {
          status: 'archived',
          schedulingStatus: 'cancelled',
        })
      }
      const archived = await db.updateMockTest(req.params.id, {
        status: 'draft',
        scheduledDate: null,
      })
      console.info(`[mock-test] Archived ${req.params.id} to preserve student attempts and results`)
      return res.json({
        success: true,
        archived: true,
        message: 'Test archived because it has student attempts. Attempts and results were preserved.',
        test: archived,
      })
    }

    for (const assignment of assignments) {
      await db.deleteMockTestAssignment(assignment._id)
    }
    await db.deleteMockTest(req.params.id)
    return res.json({ success: true, message: 'Mock test and its schedules deleted.' })
  } catch (err) {
    console.error('Failed to delete mock test and its schedules:', err)
    res.status(400).json({ success: false, message: 'Delete failed. The test or its schedules may have changed; refresh and retry.' })
  }
})

module.exports = router