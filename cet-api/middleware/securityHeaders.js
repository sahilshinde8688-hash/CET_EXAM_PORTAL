const helmet = require('helmet')

/**
 * Configure and apply security headers
 * Uses helmet.js with custom configurations
 */
const applySecurityHeaders = () => {
  const isProd = process.env.NODE_ENV === 'production'

  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'", // Needed for inline scripts in React/Vite
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
        connectSrc: [
          "'self'",
          process.env.FRONTEND_URL,
          process.env.CLIENT_URL,
          ...(process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim()),
          'https://*.supabase.co',
          'https://res.cloudinary.com',
        ].filter(Boolean),
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'", 'https:', 'blob:'],
        frameSrc: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        manifestSrc: ["'self'"],
      },
      reportOnly: false,
    },

    crossOriginEmbedderPolicy: false, // Avoid breaking external CDN fonts / images
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    crossOriginResourcePolicy: { policy: 'cross-origin' },

    referrerPolicy: {
      policy: ['strict-origin-when-cross-origin'],
    },

    hsts: isProd
      ? {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true,
        }
      : false,

    frameguard: { action: 'deny' },
    noSniff: true,
    xssFilter: true,
    dnsPrefetchControl: { allow: false },
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    ieNoOpen: true,
    hidePoweredBy: true,
  })
}

/**
 * Additional security headers for sensitive endpoints
 */
const sensitiveHeaders = (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  res.setHeader('Surrogate-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  next()
}

/**
 * CORS configuration helper
 * Enforces strict origin allowlist in production
 */
const configureCors = (options = {}) => {
  const isProd = process.env.NODE_ENV === 'production'

  const devOrigins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:3000',
  ]

  const configuredOrigins = [
    process.env.FRONTEND_URL,
    process.env.CLIENT_URL,
    ...(process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim()),
  ].filter(Boolean)

  const allowedOrigins = isProd
    ? Array.from(new Set(configuredOrigins))
    : Array.from(new Set([...configuredOrigins, ...devOrigins]))

  const defaultOptions = {
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. server-to-server or curl in dev)
      if (!origin) return callback(null, true)

      // Normalize origin by removing trailing slash
      const cleanOrigin = origin.replace(/\/$/, '')

      const isAllowed = allowedOrigins.some((allowed) => {
        return allowed && allowed.replace(/\/$/, '').toLowerCase() === cleanOrigin.toLowerCase()
      })

      if (isAllowed) {
        return callback(null, true)
      }

      if (!isProd) {
        // In local development, permit localhost ports
        if (/^http:\/\/localhost(:\d+)?$/.test(cleanOrigin) || /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(cleanOrigin)) {
          return callback(null, true)
        }
      }

      return callback(new Error(`CORS policy rejection: Origin ${origin} not permitted`), false)
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
      'X-CSRF-Token',
      'X-XSRF-Token',
    ],
    maxAge: 86400, // 24 hours
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
