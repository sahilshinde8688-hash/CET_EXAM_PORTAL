const express = require('express')
const { protect, adminOnly } = require('../middleware/auth')
const { validateCsrfToken } = require('../middleware/csrf')
const { apiLimiter, createLimiter } = require('../middleware/rateLimit')
const { escapeHtml } = require('../services/emailTemplates')
const emailNotifications = require('../services/emailNotificationService')

const router = express.Router()
const testEmailLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many test emails. Please try again later.',
})
const validateEmailServiceLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many email service validation attempts. Please try again later.',
})

router.get('/admin', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    res.json(await emailNotifications.getEmailAdminInfo())
  } catch (error) {
    console.error('[email] Could not load administrator delivery data:', error.message)
    res.status(500).json({ success: false, message: 'Unable to load email notification activity.' })
  }
})

router.post('/admin/validate', protect, adminOnly, validateCsrfToken, validateEmailServiceLimiter, async (req, res) => {
  try {
    await emailNotifications.validatePythonEmailService()
    return res.json({
      success: true,
      valid: true,
      message: 'Mailer configuration is complete. This check does not test SMTP connectivity; send a test email to verify delivery.',
    })
  } catch (error) {
    console.error('[email] Python email service validation failed:', error.message)
    const statusCode = [400, 401, 403, 503].includes(error.statusCode) ? error.statusCode : 502
    return res.status(statusCode).json({
      success: false,
      valid: false,
      message: error.message || 'Unable to validate the Python email service.',
    })
  }
})

router.post('/admin/test', protect, adminOnly, validateCsrfToken, testEmailLimiter, async (req, res) => {
  try {
    const result = await emailNotifications.sendAdminTestEmail(req.user)
    if (result.status === 'accepted' || result.status === 'delivered') {
      return res.json({ success: true, message: `Test email accepted by the SMTP server for ${req.user.email}.`, status: result.status })
    }
    return res.status(result.status === 'unknown' ? 502 : 503).json({
      success: false,
      message: result.safe_error || 'The SMTP server could not accept the test email. Verify the mailer configuration.',
    })
  } catch (error) {
    if (error.code === 'ADMIN_EMAIL_INVALID') {
      return res.status(400).json({ success: false, code: error.code, message: error.message })
    }
    console.error('[email] Administrator test email failed:', error.message)
    return res.status(503).json({
      success: false,
      message: error.message || 'The Python email service is not configured.',
    })
  }
})

router.post('/admin/retry/:id', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid notification ID.' })
    }
    const result = await emailNotifications.retryNotification(req.params.id)
    if (result.notFound) return res.status(404).json({ success: false, message: 'Email notification not found.' })
    if (result.conflict) return res.status(409).json({ success: false, message: `Only failed notifications can be retried (current status: ${result.status}).` })
    if (result.exhausted) return res.status(409).json({ success: false, message: 'The maximum number of automatic retries has been reached.' })
    const statusMessages = {
      accepted: 'The SMTP server accepted the retry. Final mailbox delivery is not confirmed.',
      delivered: 'The retried email was marked delivered.',
      pending: 'The retry is queued and awaiting delivery.',
      failed: `The email retry failed. ${result.safe_error || 'Review the notification details before retrying again.'}`,
      unknown: 'The SMTP server may have accepted the retry, but CETNova could not confirm the result. Check the recipient mailbox before retrying.',
      cancelled: 'The email retry was cancelled because notifications are disabled.',
    }
    const success = ['accepted', 'delivered', 'pending'].includes(result.status)
    const statusCode = result.status === 'failed' ? 503
      : result.status === 'unknown' ? 502
        : result.status === 'cancelled' ? 409
          : result.status === 'pending' ? 202 : 200
    res.status(statusCode).json({
      success,
      status: result.status,
      message: statusMessages[result.status] || 'Retry status is unavailable. Review the notification log.',
    })
  } catch (error) {
    console.error('[email] Administrator retry failed:', error.message)
    res.status(500).json({ success: false, message: 'Unable to retry this email notification.' })
  }
})

router.get('/parent-report/:token', apiLimiter, async (req, res) => {
  try {
    const report = await emailNotifications.getParentReport(req.params.token)
    if (!report) return res.status(404).send('This private report link is invalid or has expired.')
    const score = escapeHtml(report.score)
    const total = escapeHtml(report.totalMarks)
    const name = escapeHtml(report.studentName)
    const exam = escapeHtml(report.testName)
    const percentage = Number(report.percentage).toFixed(1)
    const submitted = report.attemptedAt
      ? escapeHtml(new Date(report.attemptedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }))
      : 'Not recorded'
    res.set({
      'Cache-Control': 'no-store, private',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Content-Type': 'text/html; charset=utf-8',
    })
    res.send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CETNova private result</title><body style="margin:0;padding:32px;background:#f1f5f9;font:16px Arial,sans-serif;color:#172033"><main style="max-width:640px;margin:auto;padding:32px;background:#fff;border-radius:16px"><h1 style="color:#102a56">CETNova — Private student result</h1><p>This private report was shared with an authorized parent or guardian.</p><h2>${name}</h2><p><strong>Test:</strong> ${exam}</p><p><strong>Score:</strong> ${score} / ${total} (${percentage}%)</p><p><strong>Correct:</strong> ${escapeHtml(report.correct ?? 0)} · <strong>Incorrect:</strong> ${escapeHtml(report.incorrect ?? 0)} · <strong>Unanswered:</strong> ${escapeHtml(report.unanswered ?? 0)}</p><p><strong>Time taken:</strong> ${escapeHtml(Math.floor(Number(report.duration || 0) / 60))}m</p><p><strong>Submitted:</strong> ${submitted}</p><p style="color:#64748b;font-size:13px">This secure report link expires seven days after it was issued. Do not forward it.</p></main></body></html>`)
  } catch (error) {
    console.error('[email] Parent report lookup failed:', error.message)
    res.status(500).send('Unable to load this private report.')
  }
})

module.exports = router
