const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const STUDENT_A_NOTIFICATION = '11111111-1111-4111-8111-111111111111'
const STUDENT_B_NOTIFICATION = '22222222-2222-4222-8222-222222222222'

const moduleStubs = {
  '../services/dbService': {
    getNotifications: async userId => ({
      notifications: [{ _id: userId === 'student-a' ? STUDENT_A_NOTIFICATION : STUDENT_B_NOTIFICATION, title: 'Private' }],
      unreadCount: 1,
      total: 1,
      hasMore: false,
    }),
    markNotificationRead: async (userId, id) => id === (userId === 'student-a' ? STUDENT_A_NOTIFICATION : STUDENT_B_NOTIFICATION) ? { _id: id, readAt: 'now' } : null,
    markAllNotificationsRead: async () => {},
    deleteNotification: async (userId, id) => id === (userId === 'student-a' ? STUDENT_A_NOTIFICATION : STUDENT_B_NOTIFICATION),
    clearNotifications: async () => {},
    getSystemSetting: async () => true,
  },
  '../services/notificationService': {
    publishSystemAlert: async () => {},
  },
  '../middleware/auth': {
    protect: (req, res, next) => {
      req.user = { id: req.headers['x-test-user'] || 'student-a', role: req.headers['x-test-role'] || 'student' }
      next()
    },
    adminOnly: (req, res, next) => req.user.role === 'admin' ? next() : res.sendStatus(403),
  },
  '../middleware/rateLimit': { apiLimiter: (req, res, next) => next() },
  '../middleware/csrf': { validateCsrfToken: (req, res, next) => next() },
}

const originalModules = new Map()
for (const [request, exports] of Object.entries(moduleStubs)) {
  const resolved = require.resolve(request, { paths: [__dirname] })
  originalModules.set(resolved, require.cache[resolved])
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }
}

const routerPath = require.resolve('../routes/notificationRoutes')
const originalRouter = require.cache[routerPath]
delete require.cache[routerPath]
const notificationRouter = require('../routes/notificationRoutes')

const makeServer = async t => {
  const app = express()
  app.use(express.json())
  app.use('/notifications', notificationRouter)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  t.after(() => new Promise(resolve => server.close(resolve)))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return `http://127.0.0.1:${address.port}/notifications`
}

test.after(() => {
  delete require.cache[routerPath]
  if (originalRouter) require.cache[routerPath] = originalRouter
  for (const [resolved, original] of originalModules) {
    if (original) require.cache[resolved] = original
    else delete require.cache[resolved]
  }
})

test('notification listing is scoped to the authenticated student', async t => {
  const url = await makeServer(t)
  const [studentA, studentB] = await Promise.all([
    fetch(url, { headers: { 'x-test-user': 'student-a' } }).then(response => response.json()),
    fetch(url, { headers: { 'x-test-user': 'student-b' } }).then(response => response.json()),
  ])

  assert.equal(studentA.notifications[0]._id, STUDENT_A_NOTIFICATION)
  assert.equal(studentB.notifications[0]._id, STUDENT_B_NOTIFICATION)
  assert.notEqual(studentA.notifications[0]._id, studentB.notifications[0]._id)
})

test('notification mutations cannot read or delete another student notification', async t => {
  const url = await makeServer(t)
  const headers = { 'x-test-user': 'student-a', 'content-type': 'application/json' }
  const readResponse = await fetch(`${url}/${STUDENT_B_NOTIFICATION}/read`, { method: 'PATCH', headers, body: '{}' })
  const deleteResponse = await fetch(`${url}/${STUDENT_B_NOTIFICATION}`, { method: 'DELETE', headers })

  assert.equal(readResponse.status, 404)
  assert.equal(deleteResponse.status, 404)
})

test('system announcement publishing requires an administrator', async t => {
  const url = await makeServer(t)
  const studentResponse = await fetch(`${url}/announcements`, {
    method: 'POST',
    headers: { 'x-test-user': 'student-a', 'x-test-role': 'student', 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Update', message: 'Message', requestId: '11111111-1111-4111-8111-111111111111' }),
  })

  assert.equal(studentResponse.status, 403)
})
