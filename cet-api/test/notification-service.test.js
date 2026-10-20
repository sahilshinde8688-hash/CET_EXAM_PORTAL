const test = require('node:test')
const assert = require('node:assert/strict')

const dbPath = require.resolve('../services/dbService')
const servicePath = require.resolve('../services/notificationService')
const originalDbModule = require.cache[dbPath]
const insertedRows = []
let enabledSetting = true

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    createNotifications: async rows => {
      insertedRows.push(...rows)
      return rows.map((_, index) => ({ id: String(index) }))
    },
    getSystemSetting: async () => enabledSetting,
    getApprovedStudentsForAssignment: async () => [{ id: 'student-a' }, { id: 'student-b' }],
  },
}

delete require.cache[servicePath]
const notifications = require('../services/notificationService')

test.after(() => {
  delete require.cache[servicePath]
  if (originalDbModule) require.cache[dbPath] = originalDbModule
  else delete require.cache[dbPath]
})

test('assignment notices are user-targeted and use a stable deduplication key', async () => {
  insertedRows.length = 0
  const assignment = {
    _id: 'assignment-1',
    status: 'active',
    visibility: 'available',
    studentIds: ['student-a', 'student-b', 'student-a'],
    mockTestName: 'Physics Mock',
  }

  await notifications.notifyAssignmentCreated(assignment)
  await notifications.notifyAssignmentCreated(assignment)

  assert.equal(insertedRows.length, 4)
  assert.ok(insertedRows.every(row => row.category === 'test_assignment'))
  assert.ok(insertedRows.every(row => row.targetPage === 'mocktests'))
  assert.ok(insertedRows.every(row => row.dedupeKey === 'assignment:assignment-1:created'))
  assert.deepEqual([...new Set(insertedRows.map(row => row.userId))], ['student-a', 'student-b'])
})

test('activated assignments create exam updates for their assigned students', async () => {
  insertedRows.length = 0
  await notifications.notifyAssignmentStarted({
    _id: 'assignment-started',
    studentIds: ['student-a'],
    mockTestName: 'Mathematics Mock',
  })

  assert.equal(insertedRows.length, 1)
  assert.equal(insertedRows[0].category, 'exam_update')
  assert.equal(insertedRows[0].targetPage, 'mocktests')
  assert.equal(insertedRows[0].targetType, 'assignment')
  assert.equal(insertedRows[0].dedupeKey, 'assignment:assignment-started:started')
})

test('scheduled reminders are only generated when in-app notifications are enabled', async () => {
  insertedRows.length = 0
  const now = Date.now()
  const assignments = [{
    _id: 'assignment-reminder',
    status: 'active',
    visibility: 'available',
    studentIds: ['student-a'],
    mockTestName: 'Chemistry Mock',
    startDateTime: new Date(now + 30 * 60 * 1000).toISOString(),
  }]

  enabledSetting = false
  await notifications.processScheduledNotifications(assignments, now + 120_000)
  assert.equal(insertedRows.length, 0)

  enabledSetting = true
  await notifications.processScheduledNotifications(assignments, now + 180_000)
  assert.equal(insertedRows.length, 1)
  assert.equal(insertedRows[0].category, 'reminder')
  assert.equal(insertedRows[0].targetType, 'assignment')
  assert.equal(insertedRows[0].dedupeKey, 'assignment:assignment-reminder:reminder:one-hour')
})

test('system announcements are sent only to approved student recipients', async () => {
  insertedRows.length = 0
  await notifications.publishSystemAlert({
    title: 'Schedule update',
    message: 'Review the new schedule.',
    targetPage: 'dashboard',
    dedupeKey: 'announcement:test',
  })

  assert.deepEqual(insertedRows.map(row => row.userId), ['student-a', 'student-b'])
  assert.ok(insertedRows.every(row => row.category === 'system_alert'))
  assert.ok(insertedRows.every(row => row.dedupeKey === 'announcement:test'))
})

test('published results link only to their owning student result', async () => {
  insertedRows.length = 0
  await notifications.notifyResultPublished({
    _id: 'result-1',
    userId: 'student-a',
    testName: 'Physics Mock',
  })

  assert.equal(insertedRows.length, 1)
  assert.equal(insertedRows[0].userId, 'student-a')
  assert.equal(insertedRows[0].category, 'result')
  assert.equal(insertedRows[0].targetPage, 'results')
  assert.equal(insertedRows[0].targetType, 'result')
  assert.equal(insertedRows[0].targetId, 'result-1')
  assert.equal(insertedRows[0].dedupeKey, 'result:result-1:published')
})
