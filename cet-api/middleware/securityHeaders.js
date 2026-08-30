/**
 * Security Headers Middleware
 * 
 * Sets HTTP security headers to protect against common attacks:
 * - XSS (Cross-Site Scripting)
 * - Clickjacking
 * - MIME sniffing
 * - Information disclosure
 * - etc.
 */

const helmet = require('helmet')

/**
 * Configure and apply security headers
 * Uses helmet.js with custom configurations
 */
const applySecurityHeaders = () => {
  return helmet({
    // Content Security Policy - prevents XSS by controlling resource loading
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'", // Needed for some React setups, remove in production if possible
          "'unsafe-eval'", // Needed for some dev tools, remove in production
        ],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        connectSrc: ["'self'", "https://api.example.com"], // Add your API domains
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        manifestSrc: ["'self'"],
      },
      reportOnly: process.env.NODE_ENV === 'development', // Report only in dev
    },

    // Cross-Origin Embedder Policy - prevents cross-origin reads
    crossOriginEmbedderPolicy: true,

    // Cross-Origin Opener Policy - protects against Spectre attacks
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },

    // Cross-Origin Resource Policy - controls cross-origin resource access
    crossOriginResourcePolicy: { policy: "cross-origin" },

    // Referrer Policy - controls Referer header
    referrerPolicy: {
      policy: ["strict-origin-when-cross-origin"],
    },

    // Strict Transport Security - forces HTTPS
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },

    // X-Frame-Options - prevents clickjacking
    frameguard: { action: "deny" },

    // X-Content-Type-Options - prevents MIME sniffing
    noSniff: true,

    // X-XSS-Protection - enables XSS filter in older browsers
    xssFilter: true,

    // X-DNS-Prefetch-Control - controls DNS prefetching
    dnsPrefetchControl: { allow: false },

    // X-Permitted-Cross-Domain-Policies - controls cross-domain requests
    permittedCrossDomainPolicies: { permittedPolicies: "none" },

    // X-Download-Options - prevents IE from opening downloads
    ieNoOpen: true,

    // Cache-Control for sensitive routes
    ...(process.env.NODE_ENV === 'production' && {
      hidePoweredBy: true, // Hide X-Powered-By header
    }),
  })
}

/**
 * Additional security headers for sensitive endpoints
 */
const sensitiveHeaders = (req, res, next) => {
  // Prevent caching of sensitive responses
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  res.setHeader('Surrogate-Control', 'no-store')

  // Additional security headers
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')

  next()
}

/**
 * CORS configuration helper
 * Validates and sanitizes CORS origins
 */
const configureCors = (options = {}) => {
  const defaultOptions = {
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true)

      const allowedOrigins = [
        process.env.FRONTEND_URL,
        process.env.CLIENT_URL,
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:3000',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5174',
        'http://127.0.0.1:3000',
      ].filter(Boolean)

      if (allowedOrigins.includes(origin)) {
        return callback(null, true)
      }

      // In development, be more permissive
      if (process.env.NODE_ENV === 'development') {
        return callback(null, true)
      }

      return callback(new Error('Not allowed by CORS'), false)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-CSRF-Token',
      'X-XSRF-Token',
      'X-Requested-With',
    ],
    exposedHeaders: [
      'Set-Cookie',
      'Authorization',
    ],
    maxAge: 86400, // 24 hours - preflight cache
    preflightContinue: false,
    optionsSuccessStatus: 204,
  }

  return { ...defaultOptions, ...options }
}

module.exports = {
  applySecurityHeaders,
  sensitiveHeaders,
  configureCors,
}
