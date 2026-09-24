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
    const tests = await db.getMockTests(req.query)
    res.json(tests)
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load mock tests' })
  }
})

// GET single mock test
router.get('/:id', apiLimiter, async (req, res) => {
  try {
    const test = await db.getMockTestById(req.params.id)
    if (!test) {
      return res.status(404).json({ success: false, message: 'Mock test not found' })
    }
    res.json(test)
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load mock test' })
  }
})

// CREATE mock test — ADMIN ONLY
router.post('/', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    const { title, subject, questions, duration, difficulty } = req.body
    if (!title || !subject || !questions || !duration || !difficulty) {
      return res.status(400).json({ success: false, message: 'All fields are required.' })
    }

    const test = await db.createMockTest({
      ...req.body,
      createdBy: req.user.name || req.user.email,
    })
    res.status(201).json(test)
  } catch (err) {
    res.status(400).json({ success: false, message: 'Failed to create test: ' + err.message })
  }
})

// UPDATE mock test — ADMIN ONLY
router.put('/:id', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    const updated = await db.updateMockTest(req.params.id, req.body)
    res.json(updated)
  } catch (err) {
    res.status(400).json({ success: false, message: 'Failed to update test' })
  }
})

// DELETE mock test — ADMIN ONLY
router.delete('/:id', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    await db.deleteMockTest(req.params.id)
    res.json({ success: true, message: 'Deleted' })
  } catch (err) {
    res.status(400).json({ success: false, message: 'Delete failed' })
  }
})

module.exports = router