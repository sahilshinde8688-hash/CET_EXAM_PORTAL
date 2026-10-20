const { rateLimit, ipKeyGenerator } = require('express-rate-limit')

const API_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
const authenticatedUserKey = (req, res) => {
  const userId = req.user?.id || req.user?._id
  return userId ? `user:${String(userId)}` : ipKeyGenerator(req, res)
}
let RedisStore = null
let redisClient = null

if (process.env.REDIS_URL) {
  try {
    const RedisStoreModule = require('rate-limit-redis')
    RedisStore = RedisStoreModule.default || RedisStoreModule
    const { createClient } = require('redis')
    redisClient = createClient({
      url: process.env.REDIS_URL,
    })
    redisClient.connect().catch((err) => {
      console.warn('⚠️ Redis rate limit connection error:', err.message)
    })
  } catch (err) {
    console.warn('Redis not configured, using memory rate limiting')
  }
}

/**
 * Sliding window rate limiter factory
 */
const createLimiter = ({ windowMs, max, message, keyGenerator }) => {
  return rateLimit({
    store:
      redisClient && RedisStore
        ? new RedisStore({
            sendCommand: (...command) => redisClient.sendCommand(command),
          })
        : undefined,
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res) => {
      res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)))
      res.status(429).json({
        success: false,
        message: message || 'Too many requests. Please try again later.',
        retryAfter: Math.ceil(windowMs / 1000),
      })
    },
  })
}

// ── Specific Rate Limiters ──────────────────────────────────────────

/**
 * Login rate limiter: 5 attempts per 15 mins in prod, 50 in dev
 */
const loginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 5 : 50,
  message: 'Too many login attempts. Please try again after 15 minutes.',
  keyGenerator: (req, res) => {
    const email = req.body?.email ? String(req.body.email).toLowerCase().trim() : ''
    const ip = ipKeyGenerator(req, res)
    return `login:${ip}:${email}`
  },
})

/**
 * Registration rate limiter: 3 attempts per hour in prod, 50 in dev
 */
const registerLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 5 : 50,
  message: 'Too many registration attempts. Please try again in an hour.',
})

/**
 * Password reset rate limiter
 */
const passwordResetLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 5 : 50,
  message: 'Too many password reset attempts. Please try again in an hour.',
})

/**
 * Token refresh rate limiter: 30 attempts per 5 minutes
 */
const refreshLimiter = createLimiter({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: 'Too many token refresh attempts. Please slow down.',
})

/**
 * General API rate limiter: 200 requests per 15 minutes
 */
const apiLimiter = createLimiter({
  windowMs: API_RATE_LIMIT_WINDOW_MS,
  max: 200,
  message: 'API rate limit exceeded. Please slow down.',
  keyGenerator: authenticatedUserKey,
})

/**
 * Test submission rate limiter: 15 submissions per 15 minutes per user.
 * More generous than the general limiter so a normal test-taking session
 * (load questions → submit → review) never triggers it.
 */
const testSubmitLimiter = createLimiter({
  windowMs: API_RATE_LIMIT_WINDOW_MS,
  max: 15,
  message: 'Too many test submissions. Please wait a moment before trying again.',
  keyGenerator: (req, res) => {
    // Key by user ID when authenticated, fall back to an IPv6-safe IP key
    const userId = req.user?.id || req.user?._id
    const ip = ipKeyGenerator(req, res)
    return userId ? `test_submit:${userId}` : `test_submit:ip:${ip}`
  },
})

/**
 * File upload rate limiter: 20 uploads per hour in prod, 100 in dev
 */
const uploadLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 20 : 100,
  message: 'Upload limit exceeded. Please try again later.',
})

module.exports = {
  loginLimiter,
  registerLimiter,
  passwordResetLimiter,
  refreshLimiter,
  apiLimiter,
  testSubmitLimiter,
  API_RATE_LIMIT_WINDOW_MS,
  uploadLimiter,
  createLimiter,
  getRedisStatus: () => {
    if (!process.env.REDIS_URL) return { status: 'unavailable', reason: 'Redis is not configured' }
    return redisClient?.isReady
      ? { status: 'running' }
      : { status: 'unknown', reason: 'Redis is configured but not connected' }
  },
}
