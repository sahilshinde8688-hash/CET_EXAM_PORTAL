const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { randomUUID } = require('crypto')
const { createCsrfToken } = require('../middleware/csrf')
const { ACCESS_TOKEN_MAX_AGE_SECONDS } = require('../config/auth')

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex')

const createSessionId = () => randomUUID()

const signAccessToken = (userId, sessionId, expiresInSeconds = ACCESS_TOKEN_MAX_AGE_SECONDS) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is missing')
  }
  return jwt.sign(
    { id: userId, sessionId, type: 'access' },
    process.env.JWT_SECRET,
    { expiresIn: Math.max(1, Math.min(ACCESS_TOKEN_MAX_AGE_SECONDS, Math.floor(expiresInSeconds))) }
  )
}

const signRefreshToken = (userId, sessionId, rememberMe = false) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is missing')
  }
  return jwt.sign(
    { id: userId, sessionId, type: 'refresh', jti: randomUUID(), rememberMe },
    process.env.JWT_SECRET
  )
}

const setAuthCookies = (res, accessToken, refreshToken, csrfToken, sessionExpiresAt) => {
  const isProd = process.env.NODE_ENV === 'production'
  const remainingMs = Date.parse(sessionExpiresAt) - Date.now()
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    throw new Error('Cannot set authentication cookies for an expired session.')
  }
  const cookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
  }

  res.cookie('accessToken', accessToken, {
    ...cookieOptions,
    maxAge: Math.min(ACCESS_TOKEN_MAX_AGE_SECONDS * 1000, remainingMs),
  })

  res.cookie('refreshToken', refreshToken, {
    ...cookieOptions,
    maxAge: remainingMs,
  })

  const csrf = csrfToken || createCsrfToken()
  res.cookie('csrfToken', csrf, {
    httpOnly: false, // Accessible to JavaScript for double-submit header
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
    maxAge: remainingMs,
  })

  res.setHeader('X-CSRF-Token', csrf)
}

const getCookieClearOptions = () => {
  const isProd = process.env.NODE_ENV === 'production'
  return {
    path: '/',
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
  }
}

const clearSessionCookies = (res) => {
  const clearOptions = getCookieClearOptions()
  res.clearCookie('accessToken', clearOptions)
  res.clearCookie('refreshToken', clearOptions)
}

const clearAuthCookies = (res) => {
  const clearOptions = getCookieClearOptions()
  clearSessionCookies(res)
  res.clearCookie('csrfToken', clearOptions)
}

module.exports = {
  ACCESS_TOKEN_MAX_AGE_SECONDS,
  hashToken,
  createSessionId,
  signAccessToken,
  signRefreshToken,
  setAuthCookies,
  clearSessionCookies,
  clearAuthCookies,
}
