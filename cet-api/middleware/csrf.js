const crypto = require('crypto')

const CSRF_SECRET = process.env.CSRF_SECRET || process.env.JWT_SECRET || 'cet_prep_csrf_internal_secret_key'
const CSRF_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours

/**
 * Generate a cryptographically signed CSRF token:
 * format: timestamp.nonce.signature
 */
const createCsrfToken = () => {
  const timestamp = Date.now().toString()
  const nonce = crypto.randomBytes(16).toString('hex')
  const data = `${timestamp}:${nonce}`
  const signature = crypto.createHmac('sha256', CSRF_SECRET).update(data).digest('hex')
  return `${timestamp}.${nonce}.${signature}`
}

/**
 * Verify a token's HMAC signature and expiration
 */
const verifyCsrfToken = (token) => {
  if (!token || typeof token !== 'string') return false
  const parts = token.split('.')
  if (parts.length !== 3) return false

  const [timestampStr, nonce, signature] = parts
  const timestamp = parseInt(timestampStr, 10)
  if (isNaN(timestamp)) return false

  // Check expiration
  if (Date.now() - timestamp > CSRF_TTL_MS || timestamp > Date.now() + 60000) {
    return false
  }

  const expectedSignature = crypto
    .createHmac('sha256', CSRF_SECRET)
    .update(`${timestampStr}:${nonce}`)
    .digest('hex')

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  } catch {
    return false
  }
}

/**
 * Middleware to generate CSRF token and attach to request / response
 */
const generateCsrfToken = (req, res, next) => {
  const isProd = process.env.NODE_ENV === 'production'
  let token = req.cookies?.csrfToken

  if (!token || !verifyCsrfToken(token)) {
    token = createCsrfToken()
    res.cookie('csrfToken', token, {
      httpOnly: false, // Must be readable by client-side JavaScript for double-submit
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      path: '/',
      maxAge: CSRF_TTL_MS,
    })
  }

  req.csrfToken = token
  res.setHeader('X-CSRF-Token', token)
  next()
}

/**
 * Middleware to validate CSRF token on mutating requests
 */
const validateCsrfToken = (req, res, next) => {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS']
  if (safeMethods.includes(req.method)) {
    return next()
  }

  const headerToken = req.headers['x-csrf-token'] || req.headers['x-xsrf-token']
  const bodyToken = req.body?._csrf
  const submittedToken = headerToken || bodyToken

  if (!submittedToken) {
    return res.status(403).json({
      success: false,
      message: 'CSRF token missing. Please ensure X-CSRF-Token header is provided.',
    })
  }

  if (!verifyCsrfToken(submittedToken)) {
    return res.status(403).json({
      success: false,
      message: 'CSRF token invalid or expired.',
    })
  }

  // If cookie exists, verify double-submit match
  const cookieToken = req.cookies?.csrfToken
  if (cookieToken && cookieToken !== submittedToken) {
    // Both must match if cookie is provided
    return res.status(403).json({
      success: false,
      message: 'CSRF token mismatch between cookie and header.',
    })
  }

  next()
}

module.exports = {
  createCsrfToken,
  verifyCsrfToken,
  generateCsrfToken,
  validateCsrfToken,
}
