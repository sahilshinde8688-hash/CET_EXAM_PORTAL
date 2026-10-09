const express = require('express')
const router = express.Router()
const db = require('../services/dbService')
const { protect, adminOnly } = require('../middleware/auth')
const { apiLimiter } = require('../middleware/rateLimit')

router.get('/overview', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    const overview = await db.getAdminDashboardOverview()
    res.json(overview)
  } catch (error) {
    console.error('Admin dashboard overview error:', error)
    res.status(500).json({ success: false, message: 'Failed to load dashboard overview.' })
  }
})

module.exports = router