const express = require('express')
const db = require('../services/dbService')
const notifications = require('../services/notificationService')
const { protect, adminOnly } = require('../middleware/auth')
const { apiLimiter } = require('../middleware/rateLimit')
const { validateCsrfToken } = require('../middleware/csrf')

const router = express.Router()
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const studentIdFor = req => String(req.user.id || req.user._id)

router.use(protect)

router.get('/', apiLimiter, async (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Student access is required.' })
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20))
  const offset = Math.min(10_000, Math.max(0, Number.parseInt(req.query.offset, 10) || 0))
  try {
    const result = await db.getNotifications(studentIdFor(req), { limit, offset })
    return res.json({ success: true, ...result })
  } catch (error) {
    console.error('[notifications] Failed to load student notifications:', error.message)
    return res.status(500).json({ success: false, message: 'Notifications could not be loaded. Please retry.' })
  }
})

router.patch('/:id/read', validateCsrfToken, apiLimiter, async (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Student access is required.' })
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid notification ID.' })
  try {
    const notification = await db.markNotificationRead(studentIdFor(req), req.params.id)
    if (!notification) return res.status(404).json({ success: false, message: 'Notification not found.' })
    return res.json({ success: true, notification })
  } catch (error) {
    console.error('[notifications] Failed to mark notification read:', error.message)
    return res.status(500).json({ success: false, message: 'Notification could not be updated. Please retry.' })
  }
})

router.post('/read-all', validateCsrfToken, apiLimiter, async (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Student access is required.' })
  try {
    await db.markAllNotificationsRead(studentIdFor(req))
    return res.json({ success: true })
  } catch (error) {
    console.error('[notifications] Failed to mark all notifications read:', error.message)
    return res.status(500).json({ success: false, message: 'Notifications could not be updated. Please retry.' })
  }
})

router.delete('/:id', validateCsrfToken, apiLimiter, async (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Student access is required.' })
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid notification ID.' })
  try {
    const deleted = await db.deleteNotification(studentIdFor(req), req.params.id)
    if (!deleted) return res.status(404).json({ success: false, message: 'Notification not found.' })
    return res.json({ success: true })
  } catch (error) {
    console.error('[notifications] Failed to delete notification:', error.message)
    return res.status(500).json({ success: false, message: 'Notification could not be deleted. Please retry.' })
  }
})

router.delete('/', validateCsrfToken, apiLimiter, async (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Student access is required.' })
  try {
    await db.clearNotifications(studentIdFor(req))
    return res.json({ success: true })
  } catch (error) {
    console.error('[notifications] Failed to clear notifications:', error.message)
    return res.status(500).json({ success: false, message: 'Notifications could not be cleared. Please retry.' })
  }
})

router.post('/announcements', adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  const { title, message, targetPage, requestId } = req.body || {}
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 120
    || typeof message !== 'string' || !message.trim() || message.trim().length > 1000
    || typeof requestId !== 'string' || !UUID_RE.test(requestId)) {
    return res.status(400).json({ success: false, message: 'Enter a valid request ID, title (up to 120 characters), and message (up to 1000 characters).' })
  }
  const allowedPages = new Set(['dashboard', 'mocktests', 'results', 'analytics', 'settings'])
  if (targetPage !== undefined && !allowedPages.has(targetPage)) {
    return res.status(400).json({ success: false, message: 'Select a valid destination for this announcement.' })
  }
  try {
    const [announcementsEnabled, inAppNotificationsEnabled] = await Promise.all([
      db.getSystemSetting('announcements'),
      db.getSystemSetting('in_app_notifications'),
    ])
    if (announcementsEnabled === false || inAppNotificationsEnabled === false) {
      return res.status(409).json({ success: false, message: 'Enable system announcements and in-app notifications in notification settings before publishing.' })
    }
    await notifications.publishSystemAlert({
      title: title.trim(),
      message: message.trim(),
      targetPage: targetPage || 'dashboard',
      dedupeKey: `announcement:${requestId}`,
    })
    return res.status(201).json({ success: true, message: 'Announcement published to approved students.' })
  } catch (error) {
    console.error('[notifications] Failed to publish system announcement:', error.message)
    return res.status(500).json({ success: false, message: 'Announcement could not be published. Please retry.' })
  }
})

module.exports = router
