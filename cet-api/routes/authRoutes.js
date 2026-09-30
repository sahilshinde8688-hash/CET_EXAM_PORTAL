const express = require('express')
const router = express.Router()
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const db = require('../services/dbService')
const { getDeviceInfo } = require('../services/sessionService')
const {
  createSessionId,
  signAccessToken,
  signRefreshToken,
  setAuthCookies,
  clearAuthCookies,
  hashToken,
} = require('../utils/authHelpers')
const { validateCsrfToken } = require('../middleware/csrf')
const { sensitiveHeaders } = require('../middleware/securityHeaders')
const { loginLimiter, registerLimiter, refreshLimiter } = require('../middleware/rateLimit')
const { protect } = require('../middleware/auth')

const getUserPayload = (user) => ({
  _id: user.id || user._id,
  id: user.id || user._id,
  name: user.name,
  email: user.email,
  branch: user.branch,
  role: user.role,
  adminRole: user.adminRole,
  status: user.status,
  mhcetId: user.mhcetId,
  phone: user.phone,
  batch: user.batch,
  photo: user.photo,
  mustResetPassword: user.mustResetPassword,
})

const passwordMatches = async (inputPassword, user) => {
  if (!inputPassword || !user) return false

  const supplied = String(inputPassword).trim()

  if (user.password) {
    try {
      if (await bcrypt.compare(supplied, user.password)) return true
    } catch (err) {
      // fall through to legacy plain-text comparison below
    }

    if (String(user.password).trim() === supplied) return true
  }

  if (user.mhcetPassword && String(user.mhcetPassword).trim() === supplied) return true

  return false
}

const createAuthSession = async (user, req, res, rememberMe = false) => {
  const sessionId = createSessionId()
  const deviceInfo = getDeviceInfo(req)
  const userId = user.id || user._id
  const accessToken = signAccessToken(userId, sessionId)
  const refreshTokenValue = signRefreshToken(userId, sessionId, rememberMe)
  const refreshTokenHash = hashToken(refreshTokenValue)
  const refreshExpiry = new Date(Date.now() + (rememberMe ? 30 : 7) * 24 * 60 * 60 * 1000).toISOString()

  const session = await db.createSession({
    sessionId,
    userId,
    deviceName: deviceInfo.deviceName,
    browser: deviceInfo.browser,
    operatingSystem: deviceInfo.operatingSystem,
    ipAddress: deviceInfo.ipAddress,
    country: deviceInfo.country,
    expiresAt: refreshExpiry,
    isCurrent: true,
  })
  if (!session?.session_id) throw new Error('Unable to persist the authentication session.')

  try {
    const refreshRecord = await db.createRefreshToken({
      userId,
      sessionId,
      tokenHash: refreshTokenHash,
      deviceName: deviceInfo.deviceName,
      browser: deviceInfo.browser,
      operatingSystem: deviceInfo.operatingSystem,
      ipAddress: deviceInfo.ipAddress,
      country: deviceInfo.country,
      expiresAt: refreshExpiry,
    })
    if (!refreshRecord?.id) throw new Error('Unable to persist the refresh token.')
  } catch (err) {
    try {
      await db.deleteSession(sessionId)
    } catch (cleanupError) {
      console.error('Failed to clean up an incomplete authentication session:', cleanupError.message)
    }
    throw err
  }

  try {
    await db.createLoginHistory({
      userId,
      sessionId,
      event: 'login_success',
      ipAddress: deviceInfo.ipAddress,
      userAgent: req.headers['user-agent'],
      browser: deviceInfo.browser,
      operatingSystem: deviceInfo.operatingSystem,
      deviceName: deviceInfo.deviceName,
      country: deviceInfo.country,
    })
  } catch (err) {
    console.warn('LoginHistory log notice:', err.message)
  }

  setAuthCookies(res, accessToken, refreshTokenValue, req.csrfToken, rememberMe)

  return {
    ...getUserPayload(user),
    sessionId: session.session_id || sessionId,
    rememberMe,
  }
}

const refreshUserSession = async (req, res) => {
  const refreshToken = req.cookies?.refreshToken
  if (!refreshToken) {
    return res.status(401).json({ success: false, message: 'No refresh token found.' })
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET)
    if (decoded.type !== 'refresh') {
      return res.status(401).json({ success: false, message: 'Invalid token type.' })
    }

    const tokenHash = hashToken(refreshToken)
    const storedToken = await db.findRefreshTokenByHash(tokenHash)

    if (!storedToken || storedToken.revoked_at || new Date(storedToken.expires_at) <= new Date()) {
      return res.status(401).json({ success: false, message: 'Refresh token expired or revoked.' })
    }

    const user = await db.findUserById(storedToken.user_id)
    if (!user || user.status === 'rejected' || (user.role === 'student' && user.status === 'pending')) {
      return res.status(401).json({ success: false, message: 'User not found.' })
    }

    const session = await db.findSessionById(storedToken.session_id)
    if (!session || session.revoked_at || session.user_id !== storedToken.user_id) {
      return res.status(401).json({ success: false, message: 'Session not active.' })
    }

    const rememberMe = decoded.rememberMe === true
      || (new Date(storedToken.expires_at).getTime() - new Date(storedToken.created_at).getTime()) > 8 * 24 * 60 * 60 * 1000
    await db.updateSession(storedToken.session_id, {
      expires_at: storedToken.expires_at,
      last_activity: new Date().toISOString(),
    })

    const accessToken = signAccessToken(user.id, storedToken.session_id)
    setAuthCookies(res, accessToken, refreshToken, req.csrfToken, rememberMe)

    await db.createLoginHistory({
      userId: user.id,
      sessionId: storedToken.session_id,
      event: 'refresh_success',
      ipAddress: getDeviceInfo(req).ipAddress,
      userAgent: req.headers['user-agent'],
    })

    return res.json({ success: true, user: getUserPayload(user), sessionId: storedToken.session_id })
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError' || err.name === 'NotBeforeError') {
      return res.status(401).json({ success: false, message: 'Refresh token invalid or expired.' })
    }
    console.error('Session refresh failed:', err.message || err)
    return res.status(500).json({ success: false, message: 'Unable to refresh your session.' })
  }
}

// POST /api/auth/register
router.post('/register', sensitiveHeaders, registerLimiter, async (req, res) => {
  const { name, email, phone, branch, batch } = req.body
  try {
    if (!name || !email || !phone || !branch || !batch) {
      return res.status(400).json({ success: false, message: 'All fields are required.' })
    }

    const cleanEmail = String(email).toLowerCase().trim()
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({ success: false, message: 'Invalid email address format.' })
    }

    const cleanPhone = String(phone).replace(/[^\d+]/g, '').trim()
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      return res.status(400).json({ success: false, message: 'Invalid phone number.' })
    }

    const validBranches = ['Byculla', 'Worli', 'Prabhadevi']
    if (!validBranches.includes(branch)) {
      return res.status(400).json({ success: false, message: `Invalid branch. Must be one of: ${validBranches.join(', ')}` })
    }

    const numBatch = Number(batch)
    if (isNaN(numBatch) || numBatch < 2020 || numBatch > 2040) {
      return res.status(400).json({ success: false, message: 'Invalid batch year.' })
    }

    let createdUser = null

    try {
      const exists = await db.findUserByEmail(cleanEmail)
      if (exists) return res.status(400).json({ success: false, message: 'Email already registered.' })

      createdUser = await db.createUser({
        name: String(name).trim().slice(0, 100),
        email: cleanEmail,
        phone: cleanPhone,
        branch,
        batch: numBatch,
        role: 'student',
        status: 'pending',
      })
    } catch (dbErr) {
      if (dbErr.code === '23505' || dbErr.message?.includes('duplicate key')) {
        return res.status(400).json({ success: false, message: 'Email already registered.' })
      }
      return res.status(400).json({ success: false, message: 'Registration failed: ' + dbErr.message })
    }

    if (!createdUser?.id) {
      return res.status(500).json({ success: false, message: 'Registration could not be completed.' })
    }

    delete createdUser.password
    delete createdUser.mhcetPassword

    return res.status(201).json({
      success: true,
      message: 'Registration submitted! Your account is under review. You will receive your credentials via email once approved.',
      status: 'pending',
      user: getUserPayload(createdUser),
    })
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error during registration.' })
  }
})

// POST /api/auth/login
router.post('/login', validateCsrfToken, sensitiveHeaders, loginLimiter, async (req, res) => {
  const { email, password, rememberMe } = req.body

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email/ID and password are required.' })
  }

  try {
    let user = null
    const input = String(email).trim()

    if (/^MHC-/i.test(input)) {
      user = await db.findUserByMhcetId(input.toUpperCase())
    } else {
      user = await db.findUserByEmail(input.toLowerCase())
    }

    if (!user) {
      await db.createLoginHistory({
        userId: null,
        event: 'login_failed',
        ipAddress: getDeviceInfo(req).ipAddress,
        userAgent: req.headers['user-agent'],
        metadata: { email: input },
      })
      return res.status(401).json({ success: false, message: 'Invalid credentials.' })
    }

    if (user.role === 'student' && user.status === 'pending') {
      return res.status(403).json({
        success: false,
        message: 'Your account is pending admin approval. You will receive an email once approved.',
      })
    }

    if (user.status === 'rejected') {
      return res.status(403).json({ success: false, message: 'Your account has been deactivated.' })
    }

    // Verify password hash with bcrypt, while supporting legacy plain-text passwords in the database
    const isMatch = await passwordMatches(password, user)

    if (!isMatch) {
      await db.createLoginHistory({
        userId: user.id,
        event: 'login_failed',
        ipAddress: getDeviceInfo(req).ipAddress,
        userAgent: req.headers['user-agent'],
        metadata: { email: input },
      })
      return res.status(401).json({ success: false, message: 'Invalid credentials.' })
    }

    const payload = await createAuthSession(user, req, res, Boolean(rememberMe))

    if (user.mustResetPassword) {
      payload.mustResetPassword = true
    }

    return res.status(200).json(payload)
  } catch (err) {
    console.error('Login route error:', err.message || err)
    return res.status(503).json({ success: false, message: 'Authentication service is temporarily unavailable. Please try again later.' })
  }
})

router.post('/refresh', validateCsrfToken, refreshLimiter, async (req, res) => refreshUserSession(req, res))

router.post('/logout', validateCsrfToken, sensitiveHeaders, async (req, res) => {
  try {
    const now = new Date().toISOString()
    const refreshToken = req.cookies?.refreshToken
    const accessToken = req.cookies?.accessToken
    const tokenRecord = refreshToken
      ? await db.findRefreshTokenByHash(hashToken(refreshToken))
      : null
    let sessionId = tokenRecord?.session_id

    if (!sessionId && accessToken) {
      try {
        const decoded = jwt.verify(accessToken, process.env.JWT_SECRET)
        if (decoded.type === 'access') sessionId = decoded.sessionId
      } catch {}
    }

    if (sessionId) {
      const session = await db.findSessionById(sessionId)
      if (session && !session.revoked_at) {
        await db.updateSession(sessionId, { revoked_at: now, expires_at: now, is_current: false })
      }
    }
    if (tokenRecord && !tokenRecord.revoked_at) {
      await db.updateRefreshToken(tokenRecord.id, { revoked_at: now })
    }

    clearAuthCookies(res)
    return res.status(200).json({ success: true, message: 'Logged out successfully.' })
  } catch (err) {
    clearAuthCookies(res)
    console.error('Logout session revocation failed:', err.message || err)
    return res.status(500).json({ success: false, message: 'Unable to securely end the session.' })
  }
})

router.get('/csrf', (req, res) => {
  return res.json({ success: true, csrfToken: req.csrfToken })
})

router.get('/me', sensitiveHeaders, protect, async (req, res) => {
  return res.json(getUserPayload(req.user))
})

module.exports = router
