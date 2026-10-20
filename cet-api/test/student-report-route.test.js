const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

const db = {
  findUserById: async () => null,
  updateUser: async () => null,
  getTestResultsByUserId: async () => [],
  getUsersPage: async () => ({ users: [], total: 0 }),
  getStudentRegistrationStats: async () => ({ pending: 0, approved: 0, rejected: 0 }),
  getMockTestAssignments: async () => [],
  getMockTestAttempts: async () => [],
  getQuestions: async () => [],
  getTestResultById: async () => null,
}
const originals = { ...db }
const emailNotifications = {
  createInitialTemporaryPassword: () => ({ password: 'new-temporary-password', ciphertext: 'encrypted-temporary-password' }),
  sendInitialTemporaryPassword: async () => ({ status: 'accepted' }),
  logEmailFailure: () => {},
}
const originalEmailNotifications = { ...emailNotifications }
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === '../services/dbService') return db
  if (request === '../services/emailNotificationService') return emailNotifications
  return originalLoad.call(this, request, parent, isMain)
}
let userRoutes
let testRoutes
let adminOnly
try {
  userRoutes = require('../routes/userRoutes')
  testRoutes = require('../routes/testRoutes')
  ;({ adminOnly } = require('../middleware/auth'))
} finally {
  Module._load = originalLoad
}
const reportRoute = userRoutes.stack.find(layer => layer.route?.path === '/:id/report').route
const reportHandler = reportRoute.stack[reportRoute.stack.length - 1].handle
const usersListRoute = userRoutes.stack.find(layer => layer.route?.path === '/').route
const usersListHandler = usersListRoute.stack[usersListRoute.stack.length - 1].handle
const userStatsRoute = userRoutes.stack.find(layer => layer.route?.path === '/stats').route
const userStatsHandler = userStatsRoute.stack[userStatsRoute.stack.length - 1].handle
const temporaryPasswordStatusRoute = userRoutes.stack.find(layer => layer.route?.path === '/:id/temporary-password/status')
const temporaryPasswordRoute = userRoutes.stack.find(layer => layer.route?.path === '/:id/temporary-password')
const resetTemporaryPasswordRoute = userRoutes.stack.find(layer => layer.route?.path === '/:id/temporary-password/reset').route
const resetTemporaryPasswordHandler = resetTemporaryPasswordRoute.stack[resetTemporaryPasswordRoute.stack.length - 1].handle
const reviewRoute = testRoutes.stack.find(layer => layer.route?.path === '/:id/review').route
const reviewHandler = reviewRoute.stack[reviewRoute.stack.length - 1].handle

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(statusCode) {
    this.statusCode = statusCode
    return this
  },
  json(body) {
    this.body = body
    return this
  },
  set(name, value) {
    this.headers = { ...this.headers, [name]: value }
    return this
  },
})

const student = { id: 'student-1', role: 'student', name: 'Riya', password: 'hidden', mhcetPassword: 'hidden' }
const result = {
  _id: 'result-1',
  testName: 'Assigned mock test',
  subject: 'PCM',
  mockTestId: 'mock-1',
  mockTestAttemptId: 'attempt-1',
  attemptedAt: '2026-10-15T05:00:00.000Z',
  score: 8,
  totalMarks: 10,
  duration: 600,
  correct: 1,
  incorrect: 0,
  unanswered: 0,
  totalQuestions: 1,
  questionIds: ['question-1'],
  answers: { 'question-1': 0 },
  subjectWiseScores: [],
}
const assignment = {
  _id: 'assignment-1',
  mockTestName: 'Assigned mock test',
  status: 'active',
  visibility: 'published',
  studentIds: ['student-1'],
  startDateTime: '2026-10-15T04:00:00.000Z',
  endDateTime: '2026-10-15T06:00:00.000Z',
}
const attempt = {
  _id: 'attempt-1',
  assignmentId: 'assignment-1',
  status: 'submitted',
  attemptNumber: 1,
  startedAt: '2026-10-15T04:30:00.000Z',
  submittedAt: '2026-10-15T05:00:00.000Z',
  score: 8,
  totalMarks: 10,
  resultId: 'result-1',
}

test('admin temporary-password endpoints are registered as top-level routes', () => {
  assert.ok(temporaryPasswordStatusRoute?.route)
  assert.ok(temporaryPasswordRoute?.route)
})

const restoreDb = () => Object.assign(db, originals)
const restoreEmailNotifications = () => Object.assign(emailNotifications, originalEmailNotifications)

test('paginated student list validates paging and filters before querying', async () => {
  const response = createResponse()
  await usersListHandler({ query: { page: '1', pageSize: '101' } }, response)
  assert.equal(response.statusCode, 400)

  const invalidFilterResponse = createResponse()
  await usersListHandler({ query: { page: '1', batch: 'invalid' } }, invalidFilterResponse)
  assert.equal(invalidFilterResponse.statusCode, 400)
})

test('paginated student list returns a sanitized page with database total', async t => {
  t.after(restoreDb)
  let receivedFilters
  db.getUsersPage = async filters => {
    receivedFilters = filters
    return {
      total: 51,
      users: [{
        id: 'student-1',
        role: 'student',
        name: 'Riya',
        password: 'must-not-leak',
        mhcetPassword: 'must-not-leak',
      }],
    }
  }
  const response = createResponse()
  await usersListHandler({
    query: { page: '2', pageSize: '25', status: 'approved', search: 'Riya', branch: 'Byculla', batch: '2026' },
  }, response)

  assert.equal(response.statusCode, 200)
  assert.equal(response.body.total, 51)
  assert.equal(response.body.users[0]._id, 'student-1')
  assert.equal(response.body.users[0].password, undefined)
  assert.equal(response.body.users[0].mhcetPassword, undefined)
  assert.deepEqual(receivedFilters, {
    status: 'approved',
    search: 'Riya',
    branch: 'Byculla',
    batch: 2026,
    limit: 25,
    offset: 25,
  })
})

test('registration stats use counts rather than loading every user', async t => {
  t.after(restoreDb)
  db.getStudentRegistrationStats = async () => ({ pending: 2, approved: 10, rejected: 1 })
  db.getAllUsers = async () => {
    throw new Error('registration stats must not load all users')
  }
  const response = createResponse()
  await userStatsHandler({}, response)

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.body, { pending: 2, approved: 10, rejected: 1, total: 13 })
})

test('temporary-password reset requires explicit confirmation', async t => {
  t.after(restoreDb)
  let lookupCalled = false
  db.findUserById = async () => {
    lookupCalled = true
    return null
  }

  const response = createResponse()
  await resetTemporaryPasswordHandler({ params: { id: 'student-1' }, body: {} }, response)

  assert.equal(response.statusCode, 400)
  assert.equal(lookupCalled, false)
})

test('admin reset generates a hashed temporary password and returns it without caching', async t => {
  t.after(() => {
    restoreDb()
    restoreEmailNotifications()
  })
  const approvedStudent = {
    id: 'student-1',
    role: 'student',
    status: 'approved',
    mhcetId: 'MHC-2026-00001',
    approvedAt: '2026-10-13T00:00:00.000Z',
  }
  let update
  let notification
  db.findUserById = async () => approvedStudent
  db.updateUser = async (id, values) => {
    update = { id, values }
    return { ...approvedStudent, ...values }
  }
  emailNotifications.createInitialTemporaryPassword = () => ({
    password: 'new-temporary-password',
    ciphertext: 'encrypted-temporary-password',
  })
  emailNotifications.sendInitialTemporaryPassword = async (...args) => {
    notification = args
    return { status: 'accepted' }
  }
  const response = createResponse()

  await resetTemporaryPasswordHandler({
    params: { id: approvedStudent.id },
    body: { confirm: true },
  }, response)

  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['Cache-Control'], 'no-store')
  assert.equal(update.id, approvedStudent.id)
  assert.equal(await require('bcryptjs').compare('new-temporary-password', update.values.password), true)
  assert.equal(update.values.mustResetPassword, true)
  assert.equal(update.values.initialPasswordCiphertext, 'encrypted-temporary-password')
  assert.equal(update.values.mhcetPassword, null)
  assert.equal(response.body.password, 'new-temporary-password')
  assert.equal(response.body.emailStatus, 'accepted')
  assert.equal(notification[1], 'encrypted-temporary-password')
  assert.match(notification[2].idempotencyKey, /^student-welcome-reset:student-1:/)
})

test('student report is scoped to the requested student and retains assigned attempt data', async t => {
  t.after(restoreDb)
  const requestedIds = []
  db.findUserById = async id => id === student.id ? student : null
  db.getTestResultsByUserId = async id => {
    requestedIds.push(id)
    return [result]
  }
  db.getMockTestAssignments = async () => [
    assignment,
    { ...assignment, _id: 'other-assignment', studentIds: ['student-2'] },
    { ...assignment, _id: 'draft-assignment', visibility: 'draft' },
  ]
  db.getMockTestAttempts = async (assignmentId, studentId) => {
    assert.equal(assignmentId, assignment._id)
    assert.equal(studentId, student.id)
    return [attempt]
  }
  db.getQuestions = async () => [{ _id: 'question-1', subject: 'Physics', correctIndex: 0 }]

  const response = createResponse()
  await reportHandler({ params: { id: student.id }, query: {} }, response)

  assert.equal(response.statusCode, 200)
  assert.deepEqual(requestedIds, [student.id])
  assert.deepEqual(response.body.assignments.map(item => item.id), [assignment._id])
  assert.equal(response.body.results[0].id, result._id)
  assert.equal(response.body.results[0].subjectQuestionStats.Physics.correct, 1)
  assert.equal(response.body.attempts[0].resultId, result._id)
  assert.equal(response.body.student.password, undefined)
  assert.equal(response.body.student.mhcetPassword, undefined)
})

test('student report rejects impossible dates before reading student data', async t => {
  t.after(restoreDb)
  let lookupCalled = false
  db.findUserById = async () => {
    lookupCalled = true
    return student
  }

  const response = createResponse()
  await reportHandler({ params: { id: student.id }, query: { from: '2026-02-30' } }, response)

  assert.equal(response.statusCode, 400)
  assert.equal(lookupCalled, false)
})

test('student report returns not found for non-students or missing IDs', async t => {
  t.after(restoreDb)
  db.findUserById = async () => ({ id: 'admin-1', role: 'admin' })

  const response = createResponse()
  await reportHandler({ params: { id: 'admin-1' }, query: {} }, response)

  assert.equal(response.statusCode, 404)
  assert.match(response.body.message, /Student not found/)
})

test('admin authorization rejects students from the report route', () => {
  const response = createResponse()
  let passed = false
  adminOnly({ user: { role: 'student' } }, response, () => {
    passed = true
  })

  assert.equal(response.statusCode, 403)
  assert.equal(passed, false)
})

test('test review returns authorized questions in saved attempt order', async t => {
  t.after(restoreDb)
  db.getTestResultById = async () => ({
    _id: 'result-1',
    userId: 'student-1',
    questionIds: ['question-2', 'question-1'],
    answers: { 'question-2': 1 },
  })
  db.getMockTestAssignments = async () => []
  db.getQuestions = async () => [
    { _id: 'question-1', correctIndex: 0 },
    { _id: 'question-2', correctIndex: 1 },
  ]

  const response = createResponse()
  await reviewHandler({ params: { id: 'result-1' }, user: { id: 'student-1', role: 'student' } }, response)

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.body.questions.map(question => question._id), ['question-2', 'question-1'])
})

test('test review denies access to another student before loading answers', async t => {
  t.after(restoreDb)
  db.getTestResultById = async () => ({
    _id: 'result-1',
    userId: 'student-1',
    questionIds: ['question-1'],
    answers: {},
  })
  let questionsRequested = false
  db.getQuestions = async () => {
    questionsRequested = true
    return []
  }

  const response = createResponse()
  await reviewHandler({ params: { id: 'result-1' }, user: { id: 'student-2', role: 'student' } }, response)

  assert.equal(response.statusCode, 403)
  assert.equal(questionsRequested, false)
})
