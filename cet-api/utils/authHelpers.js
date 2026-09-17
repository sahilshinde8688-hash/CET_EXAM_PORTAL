const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { randomUUID } = require('crypto')
const { createCsrfToken } = require('../middleware/csrf')

const ACCESS_TOKEN_TTL = '15m'
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60 // 30 days in seconds

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex')

const createSessionId = () => randomUUID()

const signAccessToken = (userId, sessionId) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is missing')
  }
  return jwt.sign(
    { id: userId, sessionId, type: 'access' },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  )
}

const signRefreshToken = (userId, sessionId) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is missing')
  }
  return jwt.sign(
    { id: userId, sessionId, type: 'refresh', jti: randomUUID() },
    process.env.JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_TTL }
  )
}

const setAuthCookies = (res, accessToken, refreshToken, csrfToken) => {
  const isProd = process.env.NODE_ENV === 'production'
  const cookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
  }

  res.cookie('accessToken', accessToken, {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000, // 15 mins
  })

  res.cookie('refreshToken', refreshToken, {
    ...cookieOptions,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  })

  const csrf = csrfToken || createCsrfToken()
  res.cookie('csrfToken', csrf, {
    httpOnly: false, // Accessible to JavaScript for double-submit header
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
    maxAge: 2 * 60 * 60 * 1000,
  })

  res.setHeader('X-CSRF-Token', csrf)
}

const clearAuthCookies = (res) => {
  const isProd = process.env.NODE_ENV === 'production'
  const clearOptions = {
    path: '/',
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
  }
  res.clearCookie('accessToken', clearOptions)
  res.clearCookie('refreshToken', clearOptions)
  res.clearCookie('csrfToken', clearOptions)
}

module.exports = {
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL,
  hashToken,
  createSessionId,
  signAccessToken,
  signRefreshToken,
  setAuthCookies,
  clearAuthCookies,
}
