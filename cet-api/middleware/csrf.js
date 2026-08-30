/**
 * CSRF Protection Middleware
 * 
 * Protects against Cross-Site Request Forgery attacks by:
 * 1. Generating a CSRF token and storing it in a cookie
 * 2. Requiring the token to be sent back in a custom header for state-changing requests
 * 3. Validating the token matches between cookie and header
 * 
 * Security notes:
 * - The CSRF token is NOT HttpOnly so JavaScript can read it
 * - SameSite=Lax provides baseline CSRF protection
 * - Double-submit cookie pattern adds defense-in-depth
 */

const crypto = require('crypto')

// Store CSRF tokens in memory (use Redis in production for multi-server setups)
const csrfTokens = new Map()

/**
 * Generate CSRF token middleware
 * Creates a new CSRF token and sets it as a cookie
 */
const generateCsrfToken = (req, res, next) => {
  // Generate a new token for this session
  const token = crypto.randomBytes(32).toString('hex')
  
  // Store token (in production, use Redis or database)
  csrfTokens.set(token, {
    createdAt: Date.now(),
    expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
  })

  // Set CSRF token cookie (NOT HttpOnly so JS can read it)
  res.cookie('csrfToken', token, {
    httpOnly: false, // Must be readable by JavaScript
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/',
  })

  // Attach token to request for easy access
  req.csrfToken = token

  next()
}

/**
 * Validate CSRF token middleware
 * Verifies the CSRF token in the header matches the cookie
 * Apply to all state-changing routes (POST, PUT, PATCH, DELETE)
 */
const validateCsrfToken = (req, res, next) => {
  // Skip CSRF validation for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next()
  }

  // Skip for API key authentication (if used)
  if (req.headers['x-api-key']) {
    return next()
  }

  const cookieToken = req.cookies?.csrfToken
  const headerToken = req.headers['x-csrf-token'] || req.headers['x-xsrf-token']

  // Validate both tokens exist
  if (!cookieToken || !headerToken) {
    return res.status(403).json({ 
      message: 'CSRF token missing. Please refresh the page and try again.' 
    })
  }

  // Validate tokens match (constant-time comparison to prevent timing attacks)
  if (!crypto.timingSafeEqual(
    Buffer.from(cookieToken),
    Buffer.from(headerToken)
  )) {
    return res.status(403).json({ 
      message: 'CSRF token validation failed. Please refresh the page.' 
    })
  }

  // Validate token exists in our store
  const storedToken = csrfTokens.get(cookieToken)
  if (!storedToken || storedToken.expiresAt < Date.now()) {
    return res.status(403).json({ 
      message: 'CSRF token expired. Please refresh the page.' 
    })
  }

  next()
}

/**
 * Clean up expired tokens periodically
 */
setInterval(() => {
  const now = Date.now()
  for (const [token, data] of csrfTokens.entries()) {
    if (data.expiresAt < now) {
      csrfTokens.delete(token)
    }
  }
}, 60 * 60 * 1000) // Run every hour

module.exports = {
  generateCsrfToken,
  validateCsrfToken,
}
