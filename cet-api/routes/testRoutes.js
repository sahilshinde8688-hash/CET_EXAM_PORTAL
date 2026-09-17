const express = require('express')
const router = express.Router()
const db = require('../services/dbService')
const { protect, adminOnly } = require('../middleware/auth')
const { apiLimiter } = require('../middleware/rateLimit')
const { validateCsrfToken } = require('../middleware/csrf')

// POST /api/tests — Save and authoritatively score a test result
router.post('/', protect, validateCsrfToken, apiLimiter, async (req, res) => {
  const { testName, answers, duration } = req.body
  try {
    const userId = req.user.id || req.user._id

    // Server-side authoritative score calculation
    const result = await db.calculateAndCreateTestResult({
      userId,
      testName: testName || 'MHT-CET Mock Test',
      answers: answers || {},
      duration: Number(duration) || 0,
    })

    res.status(201).json(result)
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to record test submission: ' + err.message })
  }
})

// GET /api/tests/my — Logged-in student's test results
router.get('/my', protect, apiLimiter, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id
    const results = await db.getTestResultsByUserId(userId)
    res.json(results)
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

    // In review mode, fetch questions with solutions for student learning
    const questions = await db.getQuestions({ isActive: true }, { isAdmin: true })

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
    const users = await db.getAllUsers()
    const allResults = []

    for (const u of users) {
      const userResults = await db.getTestResultsByUserId(u.id)
      for (const r of userResults) {
        allResults.push({
          ...r,
          userId: {
            _id: u.id,
            id: u.id,
            name: u.name,
            email: u.email,
            branch: u.branch,
          },
        })
      }
    }

    allResults.sort((a, b) => new Date(b.attemptedAt) - new Date(a.attemptedAt))
    res.json(allResults)
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router
