const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { randomUUID } = require('crypto')

const ACCESS_TOKEN_TTL = '15m'
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex')

const createSessionId = () => randomUUID()

const signAccessToken = (userId, sessionId) =>
  jwt.sign({ id: userId, sessionId, type: 'access' }, process.env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL })

const signRefreshToken = (userId, sessionId) =>
  jwt.sign({ id: userId, sessionId, type: 'refresh', jti: randomUUID() }, process.env.JWT_SECRET, { expiresIn: REFRESH_TOKEN_TTL })

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
    maxAge: 15 * 60 * 1000,
  })

  res.cookie('refreshToken', refreshToken, {
    ...cookieOptions,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  })

  res.cookie('csrfToken', csrfToken, {
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
    maxAge: 15 * 60 * 1000,
  })
}

const clearAuthCookies = (res) => {
  res.clearCookie('accessToken', { path: '/' })
  res.clearCookie('refreshToken', { path: '/' })
  res.clearCookie('csrfToken', { path: '/' })
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
