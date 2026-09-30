const jwt = require('jsonwebtoken')
const { findUserById, findSessionById } = require('../services/dbService')

/**
 * Authentication middleware
 * Verifies JWT from cookie or Bearer Authorization header
 */
const protect = async (req, res, next) => {
  let token = req.cookies?.accessToken

  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1]
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authenticated. Please log in again.' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    if (decoded.type !== 'access') {
      return res.status(401).json({ success: false, message: 'Invalid token type.' })
    }

    const session = decoded.sessionId ? await findSessionById(decoded.sessionId) : null
    if (!session || session.revoked_at || session.user_id !== decoded.id || new Date(session.expires_at) <= new Date()) {
      return res.status(401).json({ success: false, message: 'Session expired or invalid.' })
    }

    const user = await findUserById(decoded.id)

    if (!user || (user.role === 'student' && user.status === 'pending')) {
      return res.status(401).json({ success: false, message: 'User account not found or deactivated.' })
    }

    if (user.status === 'rejected') {
      return res.status(403).json({ success: false, message: 'Your account has been deactivated.' })
    }

    delete user.password
    delete user.mhcetPassword

    req.user = user
    req.sessionId = decoded.sessionId
    return next()
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Session expired or invalid.' })
  }
}

/**
 * Admin authorization middleware
 * Requires previous 'protect' middleware
 */
const adminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required.' })
  }

  const allowedRoles = new Set(['Super Admin', 'ADMIN', 'EXAM_MANAGER', 'QUESTION_MANAGER', 'ANALYST', 'SUPPORT'])
  const isApprovedAdmin = req.user.role === 'admin'
    && (req.user.status === 'approved' || req.user.status == null)
    && (!req.user.adminRole || allowedRoles.has(req.user.adminRole))
  if (isApprovedAdmin) {
    return next()
  }

  return res.status(403).json({ success: false, message: 'Access denied: Admin privileges required.' })
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
      const session = decoded.sessionId ? await findSessionById(decoded.sessionId) : null
      if (!session || session.revoked_at || session.user_id !== decoded.id || new Date(session.expires_at) <= new Date()) {
        return next()
      }
      const user = await findUserById(decoded.id)
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

module.exports = { protect, adminOnly, optionalAuth }
