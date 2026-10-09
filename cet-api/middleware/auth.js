const jwt = require('jsonwebtoken')
const db = require('../services/dbService')
const { getSessionExpiresAt, sendSessionExpired } = require('../config/auth')
const { clearSessionCookies } = require('../utils/authHelpers')
const { isSuperAdminUser } = require('../utils/adminRoles')
const SESSION_ACTIVITY_WRITE_INTERVAL_MS = 60 * 1000

const rejectExpiredSession = (res) => {
  clearSessionCookies(res)
  return sendSessionExpired(res)
}

/**
 * Authentication middleware
 * Verifies JWT from cookie or Bearer Authorization header
 */
const createProtect = ({ recordActivity = true } = {}) => async (req, res, next) => {
  let token = req.cookies?.accessToken

  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1]
  }

  if (!token) {
    return rejectExpiredSession(res)
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    if (decoded.type !== 'access') {
      return res.status(401).json({ success: false, message: 'Invalid token type.' })
    }

    const session = decoded.sessionId ? await db.findSessionById(decoded.sessionId) : null
    const inactivityTimeoutSeconds = await db.getSessionInactivityTimeoutSeconds()
    const sessionExpiresAt = getSessionExpiresAt(session, inactivityTimeoutSeconds)
    if (!session || session.revoked_at || session.user_id !== decoded.id || !sessionExpiresAt) {
      return rejectExpiredSession(res)
    }
    if (sessionExpiresAt <= Date.now()) {
      const expiredAt = new Date().toISOString()
      await db.updateSession(decoded.sessionId, {
        revoked_at: expiredAt,
        expires_at: expiredAt,
        is_current: false,
      })
      return rejectExpiredSession(res)
    }

    const user = await db.findUserById(decoded.id)

    if (!user || (user.role === 'student' && user.status === 'pending')) {
      return res.status(401).json({ success: false, message: 'User account not found or deactivated.' })
    }

    if (user.status === 'rejected') {
      return res.status(403).json({ success: false, message: 'Your account has been deactivated.' })
    }

    if (user.isLocked) {
      clearSessionCookies(res)
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_LOCKED',
        message: user.lockedReason || 'Your account access has been temporarily suspended by the Super Admin.',
        lockedAt: user.lockedAt,
      })
    }

    delete user.password
    delete user.mhcetPassword

    const lastActivityAt = Date.parse(session.last_activity || session.created_at || session.login_at || '')
    const shouldRecordActivity = recordActivity && Date.now() - lastActivityAt >= SESSION_ACTIVITY_WRITE_INTERVAL_MS
    if (shouldRecordActivity) {
      const lastActivity = new Date().toISOString()
      const updatedSession = await db.updateSession(decoded.sessionId, {
        last_activity: lastActivity,
        expires_at: new Date(Date.now() + inactivityTimeoutSeconds * 1000).toISOString(),
      })
      if (!updatedSession) throw new Error('Unable to update authentication session activity.')
    }

    req.user = user
    req.sessionId = decoded.sessionId
    req.sessionInactivityTimeoutSeconds = inactivityTimeoutSeconds
    req.sessionExpiresAt = shouldRecordActivity
      ? new Date(Date.now() + inactivityTimeoutSeconds * 1000).toISOString()
      : new Date(sessionExpiresAt).toISOString()
    return next()
  } catch (error) {
    if (['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(error.name)) {
      return rejectExpiredSession(res)
    }
    return next(error)
  }
}

const protect = createProtect()
const protectWithoutActivity = createProtect({ recordActivity: false })

/**
 * Admin authorization middleware
 * Requires previous 'protect' middleware
 */
const adminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required.' })
  }

  const allowedRoles = new Set(['Super Admin', 'ADMIN'])
  const isApprovedAdmin = req.user.role === 'admin'
    && (req.user.status === 'approved' || req.user.status == null)
    && allowedRoles.has(req.user.adminRole)
  if (isApprovedAdmin) {
    return next()
  }

  return res.status(403).json({ success: false, message: 'Access denied: Admin privileges required.' })
}

/**
 * Super Admin authorization middleware
 * Requires previous 'protect' middleware
 */
const requireSuperAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required.' })
  }

  if (isSuperAdminUser(req.user)) {
    return next()
  }

  return res.status(403).json({ success: false, message: 'Access denied: Super Admin privileges required.' })
}

/**
 * Optional authentication middleware
 * Attaches req.user if valid token exists, but does not reject anonymous users
 */
const optionalAuth = async (req, res, next) => {
  let token = req.cookies?.accessToken
  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1]
  }

  if (!token) {
    return next()
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    if (decoded.type === 'access') {
      const session = decoded.sessionId ? await db.findSessionById(decoded.sessionId) : null
      const inactivityTimeoutSeconds = await db.getSessionInactivityTimeoutSeconds()
      const sessionExpiresAt = getSessionExpiresAt(session, inactivityTimeoutSeconds)
      if (!session || session.revoked_at || session.user_id !== decoded.id || !sessionExpiresAt || sessionExpiresAt <= Date.now()) {
        return next()
      }
      const user = await db.findUserById(decoded.id)
      if (user && user.status !== 'rejected' && !(user.role === 'student' && user.status === 'pending')) {
        delete user.password
        delete user.mhcetPassword
        req.user = user
        req.sessionId = decoded.sessionId
      }
    }
  } catch {}

  return next()
}

module.exports = { protect, protectWithoutActivity, adminOnly, requireSuperAdmin, optionalAuth }
