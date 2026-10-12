require('dotenv').config()
const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const dns = require('dns')
const { applySecurityHeaders, configureCors } = require('./middleware/securityHeaders')
const { generateCsrfToken } = require('./middleware/csrf')
const { maintenanceMode } = require('./middleware/maintenanceMode')

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

// API Usage Tracking and security metrics
const apiUsageLogger = require('./middleware/apiUsageLogger')
app.use('/api', apiUsageLogger)
app.use('/api', maintenanceMode)

// API Routes
app.use('/api/auth', require('./routes/authRoutes'))
app.use('/api/email', require('./routes/emailRoutes'))
app.use('/api/admin/dashboard', require('./routes/adminDashboardRoutes'))
app.use('/api/admin/settings', require('./routes/adminSettingsRoutes'))
app.use('/api/super-admin', require('./routes/superAdminRoutes'))
app.use('/api/users', require('./routes/userRoutes'))
app.use('/api/tests', require('./routes/testRoutes'))
app.use('/api/upload', require('./routes/uploadRoutes'))
app.use('/api/questions', require('./routes/questionRoutes'))
app.use('/api/mock-tests', require('./routes/mockTestRoutes'))
const mockTestAssignmentRoutes = require('./routes/mockTestAssignmentRoutes')
app.use('/api/admin/mock-tests', mockTestAssignmentRoutes.adminRouter)
app.use('/api/student/mock-tests', mockTestAssignmentRoutes.studentRouter)
app.use('/api/ai', require('./routes/aiRoutes'))
// Standard Health Checks
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  })
})

const os = require('os')
app.get('/api/system/network-info', (req, res) => {
  try {
    const interfaces = os.networkInterfaces()
    const addresses = []
    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name] || []) {
        if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
          addresses.push({ name, address: net.address })
        }
      }
    }
    // Prefer Wi-Fi or primary LAN IP
    const wifi = addresses.find(a => /wi-?fi|wlan|wireless/i.test(a.name))
    const preferred = wifi ? wifi.address : (addresses[0]?.address || '127.0.0.1')
    res.json({
      success: true,
      addresses,
      preferred,
      port: 5173,
    })
  } catch (err) {
    res.json({ success: false, preferred: '127.0.0.1', port: 5173 })
  }
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

const DEFAULT_PORT = Number(process.env.PORT || 5000)
let server = null

const startServer = (port) => {
  const currentPort = Number(port)

  server = app.listen(currentPort, '0.0.0.0', () => {
    console.log(`🚀 CET Exam Portal API running on port ${currentPort} (${process.env.NODE_ENV || 'development'})`)
  })

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      const fallbackPort = currentPort + 1
      console.warn(`[SERVER] Port ${currentPort} is busy. Retrying on ${fallbackPort}...`)
      server.close(() => {
        startServer(fallbackPort)
      })
      return
    }

    console.error('[SERVER] Unhandled server error:', err)
    process.exit(1)
  })
}

// Run bootstrap & listen only when executed directly
if (require.main === module) {
  require('./services/systemMetrics').startSystemMetricsCollection()
  startServer(DEFAULT_PORT)

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
