const express = require('express')
const router = express.Router()
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const User = require('../models/User')
const Session = require('../models/Session')
const RefreshToken = require('../models/RefreshToken')
const LoginHistory = require('../models/LoginHistory')
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

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
}

const getUserPayload = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  branch: user.branch,
  role: user.role,
  status: user.status,
  mhcetId: user.mhcetId,
})

const createAuthSession = async (user, req, res, rememberMe = false) => {
  const sessionId = createSessionId()
  const deviceInfo = getDeviceInfo(req)
  const accessToken = signAccessToken(user._id, sessionId)
  const refreshTokenValue = signRefreshToken(user._id, sessionId)
  const refreshTokenHash = hashToken(refreshTokenValue)
  const refreshExpiry = new Date(Date.now() + ((rememberMe ? 30 : 7) * 24 * 60 * 60 * 1000))

  const session = await Session.create({
    sessionId,
    userId: user._id,
    deviceName: deviceInfo.deviceName,
    browser: deviceInfo.browser,
    operatingSystem: deviceInfo.operatingSystem,
    ipAddress: deviceInfo.ipAddress,
    country: deviceInfo.country,
    loginAt: new Date(),
    lastActivity: new Date(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  })

  await RefreshToken.create({
    userId: user._id,
    sessionId,
    tokenHash: refreshTokenHash,
    deviceName: deviceInfo.deviceName,
    browser: deviceInfo.browser,
    operatingSystem: deviceInfo.operatingSystem,
    ipAddress: deviceInfo.ipAddress,
    country: deviceInfo.country,
    expiresAt: refreshExpiry,
  })

  await LoginHistory.create({
    userId: user._id,
    sessionId,
    event: 'login_success',
    ipAddress: deviceInfo.ipAddress,
    userAgent: req.headers['user-agent'],
    browser: deviceInfo.browser,
    operatingSystem: deviceInfo.operatingSystem,
    deviceName: deviceInfo.deviceName,
    country: deviceInfo.country,
  })

  setAuthCookies(res, accessToken, refreshTokenValue, crypto.randomUUID())

  return {
    ...getUserPayload(user),
    sessionId: session.sessionId,
    rememberMe,
    accessToken,
    refreshToken: refreshTokenValue,
  }
}

const refreshUserSession = async (req, res) => {
  const refreshToken = req.cookies?.refreshToken
  if (!refreshToken) {
    return res.status(401).json({ message: 'No refresh token found.' })
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET)
    if (decoded.type !== 'refresh') {
      return res.status(401).json({ message: 'Invalid token type.' })
    }

    const tokenHash = hashToken(refreshToken)
    const storedToken = await RefreshToken.findOne({ tokenHash, revokedAt: null, expiresAt: { $gt: new Date() } }).lean()

    if (!storedToken) {
      return res.status(401).json({ message: 'Refresh token expired or revoked.' })
    }

    const user = await User.findById(storedToken.userId).select('-password -mhcetPassword')
    if (!user) {
      return res.status(401).json({ message: 'User not found.' })
    }

    const session = await Session.findOne({ sessionId: storedToken.sessionId, revokedAt: null }).lean()
    if (!session || session.expiresAt < new Date()) {
      return res.status(401).json({ message: 'Session not active.' })
    }

    const accessToken = signAccessToken(user._id, storedToken.sessionId)
    setAuthCookies(res, accessToken, refreshToken, crypto.randomUUID())

    await LoginHistory.create({
      userId: user._id,
      sessionId: storedToken.sessionId,
      event: 'refresh_success',
      ipAddress: getDeviceInfo(req).ipAddress,
      userAgent: req.headers['user-agent'],
    })

    return res.json({ user: getUserPayload(user), sessionId: storedToken.sessionId })
  } catch (err) {
    return res.status(401).json({ message: 'Refresh token invalid or expired.' })
  }
}

// POST /api/auth/register
router.post('/register', sensitiveHeaders, registerLimiter, async (req, res) => {
  const { name, email, phone, branch, batch } = req.body
  try {
    if (!name || !email || !phone || !branch || !batch) {
      return res.status(400).json({ message: 'All fields are required' })
    }

    const exists = await User.findOne({ email })
    if (exists) return res.status(400).json({ message: 'Email already registered' })

    const phoneExists = await User.findOne({ phone })
    if (phoneExists) return res.status(400).json({ message: 'Phone number already registered' })

    await User.create({ name, email, phone, branch, batch, role: 'student', status: 'pending' })

    res.status(201).json({
      message: 'Registration submitted! Your account is under review. You will receive your MHT-CET credentials via email once approved.',
      status: 'pending',
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/login', validateCsrfToken, sensitiveHeaders, loginLimiter, async (req, res) => {
  const { email, password, rememberMe } = req.body

  try {
    let user
    const input = email?.trim()

    if (input && /^MHC-/i.test(input)) {
      user = await User.findOne({ mhcetId: input.toUpperCase() })
    } else {
      user = await User.findOne({ email: input })
    }

    if (!user) {
      await LoginHistory.create({
        userId: null,
        event: 'login_failed',
        ipAddress: getDeviceInfo(req).ipAddress,
        userAgent: req.headers['user-agent'],
        metadata: { email: input },
      })
      return res.status(401).json({ message: 'Invalid credentials' })
    }

    if (user.role === 'student' && user.status === 'pending') {
      return res.status(403).json({ message: 'Your account is pending admin approval. Check your email for credentials once approved.' })
    }

    if (user.role === 'student' && user.status === 'rejected') {
      return res.status(403).json({ message: 'Your account has been rejected. Contact support for help.' })
    }

    let isMatch = false
    if (/^MHC-/i.test(input)) {
      isMatch = password === user.mhcetPassword
    } else {
      isMatch = await user.matchPassword(password)
    }

    if (!isMatch) {
      await LoginHistory.create({
        userId: user._id,
        event: 'login_failed',
        ipAddress: getDeviceInfo(req).ipAddress,
        userAgent: req.headers['user-agent'],
        metadata: { email: input },
      })
      return res.status(401).json({ message: 'Invalid credentials' })
    }

    const payload = await createAuthSession(user, req, res, Boolean(rememberMe))

    if (user.mustResetPassword && /^MHC-/i.test(input)) {
      payload.mustResetPassword = true
    }

    return res.status(200).json(payload)
  } catch (err) {
    return res.status(500).json({ message: err.message })
  }
})

router.post('/refresh', validateCsrfToken, refreshLimiter, async (req, res) => refreshUserSession(req, res))

router.post('/logout', validateCsrfToken, sensitiveHeaders, async (req, res) => {
  const refreshToken = req.cookies?.refreshToken
  if (refreshToken) {
    const tokenHash = hashToken(refreshToken)
    await RefreshToken.updateMany({ tokenHash }, { $set: { revokedAt: new Date() } })
  }

  clearAuthCookies(res)
  return res.status(200).json({ message: 'Logged out successfully.' })
})

router.get('/me', sensitiveHeaders, async (req, res) => {
  const accessToken = req.cookies?.accessToken
  if (!accessToken) {
    return res.status(401).json({ message: 'Not authenticated.' })
  }

  try {
    const decoded = jwt.verify(accessToken, process.env.JWT_SECRET)
    const user = await User.findById(decoded.id).select('-password -mhcetPassword')
    if (!user) {
      return res.status(401).json({ message: 'User not found.' })
    }
    return res.json(getUserPayload(user))
  } catch {
    return res.status(401).json({ message: 'Session expired.' })
  }
})

module.exports = router
