const express    = require('express')
const router     = express.Router()
const TestResult = require('../models/TestResult')
const { protect, adminOnly } = require('../middleware/auth')
const { apiLimiter } = require('../middleware/rateLimit')

// POST /api/tests — save a test result
router.post('/', protect, apiLimiter, async (req, res) => {
  const { testName, subject, score, totalMarks, percentile, duration, subjectWiseScores, answers, correct, incorrect, unanswered, totalQuestions } = req.body
  try {
    const result = await TestResult.create({
      userId: req.user._id,
      testName, subject, score, totalMarks, percentile, duration, subjectWiseScores, answers, correct, incorrect, unanswered, totalQuestions,
    })
    res.status(201).json(result)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/tests/my — logged-in student's results
router.get('/my', protect, apiLimiter, async (req, res) => {
  try {
    const query = TestResult.find({ userId: req.user._id })
      .select('testName subject score totalMarks percentile duration attemptedAt correct incorrect unanswered totalQuestions subjectWiseScores')
      .sort({ attemptedAt: -1 })
    const results = await query.lean()
    res.json(results)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/tests — admin: all results
router.get('/', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    const results = await TestResult.find()
      .populate('userId', 'name email branch')
      .sort({ attemptedAt: -1 })
    res.json(results)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router
