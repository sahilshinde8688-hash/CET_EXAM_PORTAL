const express = require('express')
const router = express.Router()
const db = require('../services/dbService')
const { apiLimiter } = require('../middleware/rateLimit')
const { protect, adminOnly } = require('../middleware/auth')

// GET all mock tests
router.get('/', apiLimiter, async (req, res) => {
  try {
    const tests = await db.getMockTests()
    res.json(tests)
  } catch (err) {
    res.status(500).json({ message: 'Failed to load mock tests' })
  }
})

// CREATE mock test
router.post('/', apiLimiter, async (req, res) => {
  try {
    const test = await db.createMockTest(req.body)
    res.status(201).json(test)
  } catch (err) {
    console.error('Mock test creation error:', err)
    res.status(400).json({ message: 'Failed to create test', details: err.message })
  }
})

// UPDATE mock test
router.put('/:id', apiLimiter, async (req, res) => {
  try {
    const updated = await db.updateMockTest(req.params.id, req.body)
    res.json(updated)
  } catch (err) {
    res.status(400).json({ message: 'Failed to update test' })
  }
})

// DELETE mock test
router.delete('/:id', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    await db.deleteMockTest(req.params.id)
    res.json({ message: 'Deleted' })
  } catch (err) {
    res.status(400).json({ message: 'Delete failed' })
  }
})

module.exports = router