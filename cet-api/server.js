require('dotenv').config()
const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const dns = require('dns')
const { applySecurityHeaders, configureCors } = require('./middleware/securityHeaders')
const { generateCsrfToken } = require('./middleware/csrf')
const { bootstrapAdminAccount } = require('./services/dbService')

// Startup Environment Validation
const requiredEnv = ['JWT_SECRET', 'SUPABASE_URL']
const missingEnv = requiredEnv.filter((key) => !process.env[key])

if (missingEnv.length > 0) {
  if (process.env.NODE_ENV === 'production') {
    console.error(`❌ Critical Error: Missing required environment variables: ${missingEnv.join(', ')}`)
    process.exit(1)
  } else {
    console.warn(`⚠️ Warning: Missing environment variables in development: ${missingEnv.join(', ')}`)
  }
}

// Fallback DNS servers for restrictive network environments
try {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1'])
} catch (e) {
  // Ignore DNS set errors in restrictive container environments
}

const app = express()

// Trust reverse proxy (Railway, Cloudflare, AWS ALB)
// Uses 1 hop by default for standard cloud deployment
app.set('trust proxy', 1)

// Security headers (Helmet)
app.use(applySecurityHeaders())

// CORS configuration with strict allowlist
const corsOptions = configureCors()
app.use(cors(corsOptions))

// Body parsing with safe size limits to prevent DoS
app.use(express.json({ limit: '50kb' }))
app.use(express.urlencoded({ extended: true, limit: '50kb' }))

// Cookie parser
app.use(cookieParser())

// Generate CSRF token for all requests
app.use(generateCsrfToken)

// API Routes
app.use('/api/auth', require('./routes/authRoutes'))
app.use('/api/users', require('./routes/userRoutes'))
app.use('/api/tests', require('./routes/testRoutes'))
app.use('/api/upload', require('./routes/uploadRoutes'))
app.use('/api/questions', require('./routes/questionRoutes'))
app.use('/api/mock-tests', require('./routes/mockTestRoutes'))

// Standard Health Checks
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  })
})

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'CET Exam Portal API is online' })
})

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Resource not found' })
})

// Centralized Safe Error Handling Middleware
// Prevents internal stack traces and secrets from leaking to clients
app.use((err, req, res, next) => {
  console.error(`[SERVER ERROR] ${req.method} ${req.url}:`, err.message || err)
  const isProd = process.env.NODE_ENV === 'production'
  const statusCode = err.status || err.statusCode || 500
  const message = isProd && statusCode === 500
    ? 'Internal server error. Please contact support.'
    : err.message || 'An error occurred.'

  res.status(statusCode).json({
    success: false,
    message,
    ...(isProd ? {} : { stack: err.stack }),
  })
})

const PORT = process.env.PORT || 5000

let server = null

// Run bootstrap & listen only when executed directly
if (require.main === module) {
  const defaultAdminEmail = process.env.ADMIN_EMAIL || 'admin@1234'
  const defaultAdminPassword = process.env.ADMIN_PASSWORD || 'admin@1234'
  bootstrapAdminAccount(defaultAdminEmail, defaultAdminPassword)

  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 CET Exam Portal API running on port ${PORT} (${process.env.NODE_ENV || 'development'})`)
  })

  // Graceful shutdown handling
  const shutdown = (signal) => {
    console.log(`\nReceived ${signal}. Gracefully shutting down...`)
    if (server) {
      server.close(() => {
        console.log('HTTP server closed.')
        process.exit(0)
      })
      setTimeout(() => {
        console.error('Forced exit after timeout.')
        process.exit(1)
      }, 10000)
    } else {
      process.exit(0)
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

module.exports = app
