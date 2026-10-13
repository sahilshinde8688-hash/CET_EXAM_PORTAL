const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const Module = require('node:module')
const express = require('express')

let testEmailCalls = 0
let testEmailImplementation = async () => ({ status: 'accepted' })
const pass = (req, res, next) => next()
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === '../middleware/auth') {
    return {
      protect: (req, res, next) => {
        if (req.headers.authorization !== 'Bearer test-admin-session') {
          return res.status(401).json({ success: false, message: 'Authentication required.' })
        }
        req.user = req.headers['x-test-role'] === 'admin'
          ? { id: 'admin-1', role: 'admin', email: 'admin@example.test' }
          : { id: 'student-1', role: 'student', email: 'student@example.test' }
        return next()
      },
      adminOnly: (req, res, next) => req.user.role === 'admin'
        ? next()
        : res.status(403).json({ success: false, message: 'Admin privileges required.' }),
    }
  }
  if (request === '../middleware/csrf') return { validateCsrfToken: pass }
  if (request === '../middleware/rateLimit') {
    return { apiLimiter: pass, createLimiter: () => pass }
  }
  if (request === '../services/emailTemplates') return { escapeHtml: value => String(value) }
  if (request === '../services/emailNotificationService') {
    return {
      sendAdminTestEmail: async user => {
        testEmailCalls += 1
        return testEmailImplementation(user)
      },
      getEmailAdminInfo: async () => ({ configuration: {}, notifications: [] }),
      validatePythonEmailService: async () => ({ valid: true }),
      retryNotification: async () => ({}),
      getParentReport: async () => null,
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}

let emailRouter
try {
  emailRouter = require('../routes/emailRoutes')
} finally {
  Module._load = originalLoad
}

const request = (port, authorization, role) => new Promise((resolve, reject) => {
  const req = http.request({
    hostname: '127.0.0.1',
    port,
    path: '/admin/test',
    method: 'POST',
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      ...(role ? { 'X-Test-Role': role } : {}),
    },
  }, res => {
    let body = ''
    res.setEncoding('utf8')
    res.on('data', chunk => { body += chunk })
    res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }))
  })
  req.on('error', reject)
  req.end()
})

test('administrator test-email route blocks unauthenticated and non-admin requests', async t => {
  testEmailCalls = 0
  testEmailImplementation = async () => ({ status: 'accepted' })
  const app = express()
  app.use(express.json())
  app.use(emailRouter)
  const server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const { port } = server.address()

  const anonymous = await request(port)
  assert.equal(anonymous.status, 401)
  const student = await request(port, 'Bearer test-admin-session', 'student')
  assert.equal(student.status, 403)
  assert.equal(testEmailCalls, 0)

  const admin = await request(port, 'Bearer test-admin-session', 'admin')
  assert.equal(admin.status, 200)
  assert.equal(admin.body.success, true)
  assert.equal(testEmailCalls, 1)
})

test('administrator test-email route reports invalid profile email without attempting delivery', async t => {
  testEmailCalls = 0
  testEmailImplementation = async () => {
    const error = new Error('The signed-in administrator account has no valid email address.')
    error.code = 'ADMIN_EMAIL_INVALID'
    throw error
  }
  const app = express()
  app.use(emailRouter)
  const server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const { port } = server.address()

  const response = await request(port, 'Bearer test-admin-session', 'admin')
  assert.equal(response.status, 400)
  assert.equal(response.body.code, 'ADMIN_EMAIL_INVALID')
  assert.equal(testEmailCalls, 1)
})
