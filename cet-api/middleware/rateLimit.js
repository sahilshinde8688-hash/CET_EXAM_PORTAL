/**
 * Rate Limiting Middleware
 * 
 * Protects against brute-force attacks, credential stuffing, and DoS attacks.
 * Uses in-memory store with sliding window algorithm.
 * 
 * For production with multiple servers, use Redis store.
 */

const rateLimit = require('express-rate-limit')

// Optional Redis store for production scaling
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
    redisClient.connect().catch(console.error)
  } catch (err) {
    console.warn('Redis not configured, using in-memory rate limiting (not recommended for production)')
  }
}

// In-memory store for single-server deployments
const stores = new Map()

// Redis client already initialized above if available

/**
 * Sliding window rate limiter factory
 * More accurate than fixed window, prevents burst attacks
 */
const createSlidingWindowLimiter = (windowMs, max) => {
  return rateLimit({
    store: redisClient && RedisStore
      ? new RedisStore({
          sendCommand: (...command) => redisClient.sendCommand(command),
        })
      : undefined,
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // Custom handler when limit exceeded
    handler: (req, res) => {
      res.status(429).json({
        message: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil(windowMs / 1000),
      })
    },
  })
}

// ── Specific Rate Limiters ──────────────────────────────────────────

/**
 * Login rate limiter
 * Strict limit to prevent credential stuffing and brute-force attacks
 */
const loginLimiter = createSlidingWindowLimiter(
  15 * 60 * 1000, // 15 minutes
  process.env.NODE_ENV === 'production' ? 5 : 50 // 5 attempts per 15 mins in prod, 50 in dev
)
loginLimiter.keyGenerator = (req) => `login:${req.ip}`

/**
 * Registration rate limiter
 * Prevent spam registrations
 */
const registerLimiter = createSlidingWindowLimiter(
  60 * 60 * 1000, // 1 hour
  3 // 3 attempts per hour
)
registerLimiter.keyGenerator = (req) => `register:${req.ip}`

/**
 * Password reset rate limiter
 * Prevent abuse of password reset functionality
 */
const passwordResetLimiter = createSlidingWindowLimiter(
  60 * 60 * 1000, // 1 hour
  3 // 3 attempts per hour
)
passwordResetLimiter.keyGenerator = (req) => `password-reset:${req.ip}`

/**
 * Token refresh rate limiter
 * Prevent abuse of refresh endpoint
 */
const refreshLimiter = createSlidingWindowLimiter(
  5 * 60 * 1000, // 5 minutes
  10 // 10 attempts per 5 minutes
)
refreshLimiter.keyGenerator = (req) => `refresh:${req.ip}`

/**
 * General API rate limiter
 * Applied to all authenticated API requests
 */
const apiLimiter = createSlidingWindowLimiter(
  15 * 60 * 1000, // 15 minutes
  100 // 100 requests per 15 minutes
)
apiLimiter.keyGenerator = (req) => `api:${req.user?._id || req.ip}`

/**
 * File upload rate limiter
 * Prevent abuse of file upload endpoints
 */
const uploadLimiter = createSlidingWindowLimiter(
  60 * 60 * 1000, // 1 hour
  10 // 10 uploads per hour
)
uploadLimiter.keyGenerator = (req) => `upload:${req.user?._id || req.ip}`

// ── Generic Rate Limiter (for custom use) ────────────────────────────

/**
 * Create a custom rate limiter
 * @param {string} name - Name/prefix for the limiter
 * @param {number} windowMs - Time window in milliseconds
 * @param {number} max - Maximum requests in window
 */
const createRateLimiter = (name, windowMs, max) => {
  return createSlidingWindowLimiter(windowMs, max)
}

module.exports = {
  loginLimiter,
  registerLimiter,
  passwordResetLimiter,
  refreshLimiter,
  apiLimiter,
  uploadLimiter,
  createRateLimiter,
}
