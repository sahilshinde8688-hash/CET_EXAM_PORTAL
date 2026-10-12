const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

const db = {
  getActiveMockTestByTitle: async () => null,
  getMockTestAssignments: async () => [],
  calculateAndCreateTestResult: async () => null,
}
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === '../services/dbService') return db
  if (request === '../services/emailNotificationService') return emailNotifications
  if (request === '../middleware/auth') return { protect: pass, adminOnly: pass }
  if (request === '../middleware/rateLimit') return { apiLimiter: pass, testSubmitLimiter: pass }
  if (request === '../middleware/csrf') return { validateCsrfToken: pass }
  return originalLoad.call(this, request, parent, isMain)
}

function pass(req, res, next) {
  next()
}

const notificationCalls = []
const emailNotifications = {
  sendSavedResultNotifications: async resultId => notificationCalls.push(resultId),
}

let testRoutes
try {
  testRoutes = require('../routes/testRoutes')
} finally {
  Module._load = originalLoad
}

const submitHandler = testRoutes.stack
  .find(layer => layer.route?.path === '/' && layer.route.methods.post)
  .route.stack.at(-1).handle

const makeResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code
    return this
  },
  json(body) {
    this.body = body
    return this
  },
})

test('queues a result email only after authoritative result persistence resolves', async t => {
  t.after(() => {
    db.calculateAndCreateTestResult = async () => null
    notificationCalls.length = 0
  })
  const operations = []
  db.calculateAndCreateTestResult = async () => {
    operations.push('saved')
    return { _id: 'saved-result-1', score: 8, totalMarks: 10 }
  }
  emailNotifications.sendSavedResultNotifications = async id => {
    operations.push(`email:${id}`)
  }

  const response = makeResponse()
  await submitHandler({
    body: { testName: 'Practice', answers: {}, duration: 30 },
    user: { id: 'student-1' },
  }, response)

  assert.equal(response.statusCode, 201)
  assert.deepEqual(operations, ['saved', 'email:saved-result-1'])
})

test('does not queue result emails when result persistence fails', async t => {
  t.after(() => {
    db.calculateAndCreateTestResult = async () => null
    notificationCalls.length = 0
  })
  db.calculateAndCreateTestResult = async () => { throw new Error('database write failed') }
  let emailQueued = false
  emailNotifications.sendSavedResultNotifications = async () => { emailQueued = true }

  const response = makeResponse()
  await submitHandler({
    body: { testName: 'Practice', answers: {}, duration: 30 },
    user: { id: 'student-1' },
  }, response)

  assert.equal(response.statusCode, 500)
  assert.equal(emailQueued, false)
})

test('email queue failures do not prevent a successfully saved result response', async t => {
  t.after(() => {
    db.calculateAndCreateTestResult = async () => null
  })
  db.calculateAndCreateTestResult = async () => ({ _id: 'saved-result-2', score: 4, totalMarks: 10 })
  emailNotifications.sendSavedResultNotifications = async () => { throw new Error('outbox unavailable') }

  const response = makeResponse()
  await submitHandler({
    body: { testName: 'Practice', answers: {}, duration: 30 },
    user: { id: 'student-1' },
  }, response)

  assert.equal(response.statusCode, 201)
  assert.equal(response.body._id, 'saved-result-2')
})
