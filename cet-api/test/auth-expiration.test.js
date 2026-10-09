const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const test = require('node:test')

process.env.SESSION_INACTIVITY_TIMEOUT_MINUTES = '30'
process.env.JWT_SECRET = 'test-only-jwt-secret'

const jwt = require('jsonwebtoken')
const {
  ACCESS_TOKEN_MAX_AGE_SECONDS,
  DEFAULT_SESSION_INACTIVITY_TIMEOUT_SECONDS,
  SESSION_EXPIRED_MESSAGE,
  SESSION_INACTIVITY_TIMEOUT_SECONDS,
  getSessionExpiresAt,
  sendSessionExpired,
} = require('../config/auth')
const {
  setAuthCookies,
  clearSessionCookies,
  signAccessToken,
  signRefreshToken,
} = require('../utils/authHelpers')

test('defaults to a 30-minute inactivity timeout when unset', () => {
  const env = { ...process.env }
  delete env.SESSION_INACTIVITY_TIMEOUT_MINUTES
  const child = spawnSync(process.execPath, [
    '-e',
    "process.stdout.write(String(require('./config/auth').SESSION_INACTIVITY_TIMEOUT_SECONDS))",
  ], { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8' })

  assert.equal(child.status, 0, child.stderr)
  assert.equal(child.stdout, String(DEFAULT_SESSION_INACTIVITY_TIMEOUT_SECONDS))
})

test('uses the configured inactivity timeout and keeps access tokens short-lived', () => {
  assert.equal(SESSION_INACTIVITY_TIMEOUT_SECONDS, 1800)
  assert.equal(ACCESS_TOKEN_MAX_AGE_SECONDS, 900)

  const child = spawnSync(process.execPath, [
    '-e',
    "process.stdout.write(String(require('./config/auth').SESSION_INACTIVITY_TIMEOUT_SECONDS))",
  ], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, SESSION_INACTIVITY_TIMEOUT_MINUTES: '10' },
    encoding: 'utf8',
  })
  assert.equal(child.status, 0, child.stderr)
  assert.equal(child.stdout, '600')
})

test('session expiry follows last activity even beyond the former fixed lifetime', () => {
  const createdAt = Date.now() - 5 * 60 * 60 * 1000
  const lastActivity = Date.now() - 5 * 60 * 1000
  const expiry = getSessionExpiresAt({
    created_at: new Date(createdAt).toISOString(),
    last_activity: new Date(lastActivity).toISOString(),
  })

  assert.equal(expiry, lastActivity + SESSION_INACTIVITY_TIMEOUT_SECONDS * 1000)
  assert.ok(expiry > Date.now())
})

test('calculates inactivity expiry from last activity and fails closed on invalid timestamps', () => {
  const lastActivity = Date.now() - 60 * 1000
  assert.equal(
    getSessionExpiresAt({ last_activity: new Date(lastActivity).toISOString() }, 300),
    lastActivity + 300 * 1000,
  )
  assert.equal(getSessionExpiresAt({ expires_at: new Date(Date.now() + 3600000).toISOString() }), null)
  assert.equal(getSessionExpiresAt({ created_at: 'invalid', last_activity: 'invalid' }), null)
})

test('access token expiry is short while refresh tokens rely on server-side session state', () => {
  const access = jwt.decode(signAccessToken('user-id', 'session-id'))
  const shortAccess = jwt.decode(signAccessToken('user-id', 'session-id', 45))
  const refresh = jwt.decode(signRefreshToken('user-id', 'session-id', true))

  assert.ok(access.exp - access.iat <= ACCESS_TOKEN_MAX_AGE_SECONDS)
  assert.ok(shortAccess.exp - shortAccess.iat <= 45)
  assert.equal(refresh.exp, undefined)
})

test('sets secure HttpOnly auth cookies bounded by the rolling inactivity deadline', () => {
  const originalNodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  const cookies = new Map()
  const response = {
    cookie: (name, value, options) => cookies.set(name, { value, options }),
    setHeader: () => {},
  }
  const expiresAt = new Date(Date.now() + 60 * 1000).toISOString()

  try {
    setAuthCookies(response, 'access', 'refresh', 'csrf', expiresAt)
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
  }

  for (const name of ['accessToken', 'refreshToken']) {
    const options = cookies.get(name).options
    assert.equal(options.httpOnly, true)
    assert.equal(options.secure, true)
    assert.equal(options.sameSite, 'none')
    assert.ok(options.maxAge > 0 && options.maxAge <= 60 * 1000)
  }
})

test('expired-session cleanup clears auth cookies but preserves the CSRF cookie', () => {
  const clearedCookies = []
  clearSessionCookies({ clearCookie: name => clearedCookies.push(name) })
  assert.deepEqual(clearedCookies.sort(), ['accessToken', 'refreshToken'])
})

test('returns the machine-readable inactivity-expired response', () => {
  let status
  let body
  sendSessionExpired({
    status: value => {
      status = value
      return { json: value => { body = value } }
    },
  })

  assert.equal(status, 401)
  assert.equal(body.code, 'SESSION_EXPIRED')
  assert.equal(body.message, SESSION_EXPIRED_MESSAGE)
  assert.match(body.message, /inactive/i)
})