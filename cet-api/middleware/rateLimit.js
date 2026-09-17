const rateLimit = require('express-rate-limit')

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
    keyGenerator:
      keyGenerator ||
      ((req) => {
        return req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown'
      }),
    handler: (req, res) => {
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
  keyGenerator: (req) => {
    const email = req.body?.email ? String(req.body.email).toLowerCase().trim() : ''
    const ip = req.ip || req.socket.remoteAddress || ''
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
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: 'API rate limit exceeded. Please slow down.',
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
  uploadLimiter,
  createLimiter,
}
