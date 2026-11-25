const express = require('express')
const bcrypt = require('bcryptjs')
const supabase = require('../config/supabase')
const db = require('../services/dbService')
const { protect, adminOnly } = require('../middleware/auth')
const { validateCsrfToken } = require('../middleware/csrf')
const { adminMfaLimiter, apiLimiter } = require('../middleware/rateLimit')
const { createRecoveryCodes, hashAdminIdentifier, isStrongAdminPassword } = require('../utils/adminMfa')
const { verifyAdminSecondFactor } = require('../services/adminMfaService')
const emailNotifications = require('../services/emailNotificationService')

const router = express.Router()

const getAdmin = (req) => db.findMfaUserById(req.user.id || req.user._id)

const reauthenticate = async (user, currentPassword, code) => {
  if (typeof currentPassword !== 'string' || typeof code !== 'string' || !user.password) return false
  const passwordValid = await bcrypt.compare(currentPassword, user.password)
  if (!passwordValid) return false
  return verifyAdminSecondFactor(user, code)
}

const rejectReauthentication = async (req, res) => {
  await db.createLoginHistory({
    userId: req.user.id || req.user._id,
    sessionId: req.sessionId,
    event: 'security_reauth_failed',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  return res.status(401).json({ success: false, message: 'Current password or verification code is invalid.' })
}

router.get('/', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    const user = await getAdmin(req)
    if (!user) return res.status(404).json({ success: false, message: 'Administrator account not found.' })

    const [sessions, loginActivity, attempts] = await Promise.all([
      db.getUserSessions(user.id),
      db.getUserLoginHistory(user.id, 30),
      db.getAdminAuthAttempts(hashAdminIdentifier(user.email)),
    ])
    const now = Date.now()
    const activeSessions = sessions
      .filter(session => !session.revoked_at && Date.parse(session.expires_at) > now)
      .map(session => ({
        deviceName: session.device_name,
        browser: session.browser,
        operatingSystem: session.operating_system,
        ipAddress: session.ip_address,
        lastActivity: session.last_activity,
        expiresAt: session.expires_at,
        isCurrent: session.session_id === req.sessionId,
      }))
    const attemptWindowIsCurrent = attempts
      && Date.now() - Date.parse(attempts.window_started_at) < 15 * 60 * 1000

    res.setHeader('Cache-Control', 'no-store')
    return res.json({
      mfaEnabled: user.totpEnabled,
      activeSessions,
      loginActivity,
      failedLoginAttempts: {
        count: attemptWindowIsCurrent ? attempts.failure_count : 0,
        lockedUntil: attempts?.locked_until || null,
        lastAttemptAt: attempts?.last_attempt_at || null,
      },
    })
  } catch (error) {
    console.error('Could not load administrator security information:', error.message)
    return res.status(500).json({ success: false, message: 'Unable to load administrator security information.' })
  }
})

router.post('/recovery-codes', protect, adminOnly, validateCsrfToken, adminMfaLimiter, async (req, res) => {
  try {
    const user = await getAdmin(req)
    if (!user?.totpEnabled) return res.status(409).json({ success: false, message: 'Authenticator setup is required before recovery codes can be changed.' })
    if (!await reauthenticate(user, req.body?.currentPassword, req.body?.code)) {
      return rejectReauthentication(req, res)
    }

    const { codes, hashes } = createRecoveryCodes()
    const { data, error } = await supabase.from('users')
      .update({ backup_code_hashes: hashes })
      .eq('id', user.id)
      .eq('role', 'admin')
      .eq('totp_enabled', true)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) return res.status(409).json({ success: false, message: 'Recovery codes could not be updated. Retry after signing in again.' })

    res.setHeader('Cache-Control', 'no-store')
    return res.json({ success: true, recoveryCodes: codes })
  } catch (error) {
    console.error('Could not regenerate administrator recovery codes:', error.message)
    return res.status(500).json({ success: false, message: 'Unable to regenerate recovery codes.' })
  }
})

router.post('/password', protect, adminOnly, validateCsrfToken, adminMfaLimiter, async (req, res) => {
  try {
    const user = await getAdmin(req)
    const newPassword = req.body?.newPassword
    if (!user?.totpEnabled) return res.status(409).json({ success: false, message: 'Authenticator setup is required before changing administrator credentials.' })
    if (!isStrongAdminPassword(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'Use at least 12 characters with uppercase, lowercase, a number, and a symbol (maximum 72 UTF-8 bytes).',
      })
    }
    if (req.body?.currentPassword === newPassword) {
      return res.status(400).json({ success: false, message: 'Choose a password different from your current password.' })
    }
    if (!await reauthenticate(user, req.body?.currentPassword, req.body?.code)) {
      return rejectReauthentication(req, res)
    }

    const passwordHash = await bcrypt.hash(newPassword, 12)
    const { error } = await supabase.from('users')
      .update({ password: passwordHash, must_reset_password: false, mhcet_password: null, updated_at: new Date().toISOString() })
      .eq('id', user.id)
      .eq('role', 'admin')
    if (error) throw error

    const revokedSessions = await db.revokeOtherUserSessions(user.id, req.sessionId)
    try {
      await emailNotifications.sendPasswordChangedNotification(user)
    } catch (emailError) {
      console.error('[email] Could not queue administrator password-change notice:', emailError.message)
    }
    return res.json({ success: true, revokedSessions: revokedSessions.length })
  } catch (error) {
    console.error('Could not change administrator password:', error.message)
    return res.status(500).json({ success: false, message: 'Unable to change administrator password.' })
  }
})

router.post('/sessions/revoke-others', protect, adminOnly, validateCsrfToken, adminMfaLimiter, async (req, res) => {
  try {
    const user = await getAdmin(req)
    if (!user?.totpEnabled) return res.status(409).json({ success: false, message: 'Authenticator setup is required before managing administrator sessions.' })
    if (!await reauthenticate(user, req.body?.currentPassword, req.body?.code)) {
      return rejectReauthentication(req, res)
    }
    const revoked = await db.revokeOtherUserSessions(user.id, req.sessionId)
    return res.json({ success: true, revokedSessions: revoked.length })
  } catch (error) {
    console.error('Could not revoke other administrator sessions:', error.message)
    return res.status(500).json({ success: false, message: 'Unable to revoke other sessions.' })
  }
})

module.exports = router
