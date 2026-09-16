require('dotenv').config()
const express   = require('express')
const cors      = require('cors')
const cookieParser = require('cookie-parser')
const dns       = require('dns')
const supabase  = require('./config/supabase')
const { applySecurityHeaders, configureCors } = require('./middleware/securityHeaders')
const { generateCsrfToken } = require('./middleware/csrf')
const { apiLimiter } = require('./middleware/rateLimit')

const requiredEnv = ['JWT_SECRET']
const missingEnv = requiredEnv.filter((key) => !process.env[key])

if (missingEnv.length > 0) {
  console.error(`❌ Missing required environment variables: ${missingEnv.join(', ')}`)
  console.error('Add them in Render Environment Variables or a local .env file before starting the app.')
  process.exit(1)
}

if (!process.env.FRONTEND_URL && !process.env.CLIENT_URL) {
  console.warn('⚠️ No FRONTEND_URL/CLIENT_URL configured. Add the Vercel domain to allow browser requests in production.')
}

// Use Google DNS to bypass restrictive network DNS
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1'])

const app = express()

// Security headers (Helmet)
app.use(applySecurityHeaders())

// CORS configuration
const corsOptions = configureCors()
app.use(cors(corsOptions))

// Body parsing with size limits
app.use(express.json({ limit: '10kb' })) // Limit payload size
app.use(express.urlencoded({ extended: true, limit: '10kb' }))

// Cookie parser
app.use(cookieParser())

// Generate CSRF token for all requests
app.use(generateCsrfToken)

// Routes with their own specific rate limiters
app.use('/api/auth',   require('./routes/authRoutes'))
app.use('/api/users',  require('./routes/userRoutes'))
app.use('/api/tests',  require('./routes/testRoutes'))
app.use('/api/upload', require('./routes/uploadRoutes'))
app.use('/api/questions', require('./routes/questionRoutes'))
app.use('/api/mock-tests', require('./routes/mockTestRoutes'))

// Health check
app.get('/', (req, res) => res.json({ status: 'CET API is running ✅ (Supabase DB)' }))

// 404 handler
app.use((req, res) => res.status(404).json({ message: 'Route not found' }))

const PORT = process.env.PORT || 5000

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on http://localhost:${PORT}`))

