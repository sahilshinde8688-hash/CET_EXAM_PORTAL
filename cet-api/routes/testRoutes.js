const express = require('express')
const router = express.Router()
const db = require('../services/dbService')
const { protect, adminOnly } = require('../middleware/auth')
const { apiLimiter } = require('../middleware/rateLimit')

// POST /api/tests — save a test result
router.post('/', protect, apiLimiter, async (req, res) => {
  const { testName, subject, score, totalMarks, percentile, duration, subjectWiseScores, answers, correct, incorrect, unanswered, totalQuestions } = req.body
  try {
    const userId = req.user.id || req.user._id
    const result = await db.createTestResult({
      userId,
      testName,
      subject,
      score,
      totalMarks,
      percentile,
      duration,
      subjectWiseScores,
      answers,
      correct,
      incorrect,
      unanswered,
      totalQuestions,
    })
    res.status(201).json(result)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/tests/my — logged-in student's results
router.get('/my', protect, apiLimiter, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id
    const results = await db.getTestResultsByUserId(userId)
    res.json(results)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/tests — admin: all results
router.get('/', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    const users = await db.getAllUsers()
    const usersMap = Object.fromEntries(users.map((u) => [u.id, u]))
    const allUsers = users
    const allResults = []

    for (const u of allUsers) {
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
    res.status(500).json({ message: err.message })
  }
})

module.exports = router
