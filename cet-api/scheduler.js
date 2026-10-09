require('dotenv').config()

const requiredEnv = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
const missingEnv = requiredEnv.filter(name => !process.env[name])
if (missingEnv.length) {
  console.error(`[mock-test-scheduler] Missing required environment variables: ${missingEnv.join(', ')}`)
  process.exit(1)
}

const { startMockTestScheduler, stopMockTestScheduler } = require('./services/mockTestScheduler')

startMockTestScheduler()

const shutdown = signal => {
  console.info(`[mock-test-scheduler] Received ${signal}; stopping worker`)
  stopMockTestScheduler()
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
