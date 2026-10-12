const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const crypto = require('node:crypto')

const rows = {
  users: [],
  system_settings: [],
  account_setup_tokens: [],
  email_notifications: [],
}
let failNextNotificationInsert = false
let providerImplementation = async () => ({ messageId: 'smtp-message-1' })
const sentMessages = []

class Query {
  constructor(table) {
    this.table = table
    this.action = 'select'
    this.filters = []
    this.values = null
  }

  select() { return this }
  insert(values) { this.action = 'insert'; this.values = values; return this }
  update(values) { this.action = 'update'; this.values = values; return this }
  eq(key, value) { this.filters.push(row => row[key] === value); return this }
  neq(key, value) { this.filters.push(row => row[key] !== value); return this }
  is(key, value) { this.filters.push(row => row[key] === value); return this }
  gt(key, value) { this.filters.push(row => new Date(row[key]) > new Date(value)); return this }
  in(key, values) { this.filters.push(row => values.includes(row[key])); return this }
  lte(key, value) { this.filters.push(row => new Date(row[key]) <= new Date(value)); return this }
  lt(key, value) { this.filters.push(row => Number(row[key]) < Number(value)); return this }
  or() { return this }
  order() { return this }
  limit() { return this }
  single() { return this.execute(true) }
  maybeSingle() { return this.execute(false) }
  then(resolve, reject) { return this.execute(false).then(resolve, reject) }

  async execute(single) {
    const tableRows = rows[this.table]
    if (this.action === 'insert') {
      if (this.table === 'email_notifications' && failNextNotificationInsert) {
        failNextNotificationInsert = false
        return { data: null, error: { code: 'XX000', message: 'outbox database unavailable' } }
      }
      if (this.table === 'email_notifications' && tableRows.some(row => row.idempotency_key === this.values.idempotency_key)) {
        return { data: null, error: { code: '23505', message: 'duplicate idempotency key' } }
      }
      const data = {
        id: crypto.randomUUID(),
        retry_count: 0,
        status: 'pending',
        used_at: null,
        created_at: new Date().toISOString(),
        ...this.values,
      }
      tableRows.push(data)
      return { data, error: null }
    }

    const matched = tableRows.filter(row => this.filters.every(filter => filter(row)))
    if (this.action === 'update') {
      matched.forEach(row => Object.assign(row, this.values))
      return { data: single ? matched[0] || null : matched[0] || null, error: null }
    }
    const data = matched[0] || null
    return { data: single && !data ? null : data, error: null }
  }
}

const supabase = {
  from: table => new Query(table),
  rpc: async () => ({ data: null, error: null }),
}
const pythonEmailService = {
  getConfiguration: () => ({ senderEmail: 'verified@example.test', senderName: 'CETNova', serviceUrlConfigured: true, serviceTokenConfigured: true }),
  getConfigurationError: () => null,
  sendEmail: async message => {
    sentMessages.push(message)
    return providerImplementation(message)
  },
  validateEmailService: async () => ({ valid: true }),
}
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === '../config/supabase') return supabase
  if (request === './dbService') return {}
  if (request === './pythonEmailService') return pythonEmailService
  return originalLoad.call(this, request, parent, isMain)
}

let emailNotifications
try {
  emailNotifications = require('../services/emailNotificationService')
} finally {
  Module._load = originalLoad
}

const originalEncryptionKey = process.env.EMAIL_TOKEN_ENCRYPTION_KEY
process.env.EMAIL_TOKEN_ENCRYPTION_KEY = 'test-only-encryption-key-with-at-least-32-characters'
const student = {
  id: 'student-1',
  name: 'Test Student',
  email: 'student@example.test',
  mhcetId: 'MHC-2026-00001',
}

const resetState = () => {
  Object.values(rows).forEach(table => { table.length = 0 })
  failNextNotificationInsert = false
  providerImplementation = async () => ({ messageId: 'smtp-message-1' })
  sentMessages.length = 0
  process.env.EMAIL_TOKEN_ENCRYPTION_KEY = 'test-only-encryption-key-with-at-least-32-characters'
}

test('retry reuses the same valid setup link and does not send a duplicate after acceptance', async t => {
  t.after(() => {
    resetState()
    if (originalEncryptionKey === undefined) delete process.env.EMAIL_TOKEN_ENCRYPTION_KEY
    else process.env.EMAIL_TOKEN_ENCRYPTION_KEY = originalEncryptionKey
  })
  resetState()

  const invitation = await emailNotifications.createAccountSetupInvitation(student.id)
  const queued = await emailNotifications.sendStudentWelcome(student, invitation)
  const resendInvitation = await emailNotifications.createAccountSetupInvitation(student.id)
  const resent = await emailNotifications.sendStudentWelcome(student, resendInvitation)

  assert.equal(resendInvitation.id, invitation.id)
  assert.equal(resendInvitation.token, invitation.token)
  assert.equal(resent.notificationId, queued.notificationId)
  assert.equal(queued.status, 'accepted')
  assert.equal(resent.status, 'accepted')
  assert.equal(rows.account_setup_tokens.length, 1)
  assert.equal(rows.email_notifications.length, 1)
  assert.equal(rows.email_notifications[0].status, 'accepted')
  assert.equal(sentMessages.length, 1)
})

test('initial temporary password is encrypted in the outbox and recoverable for an admin until consumed', async t => {
  t.after(() => {
    resetState()
    if (originalEncryptionKey === undefined) delete process.env.EMAIL_TOKEN_ENCRYPTION_KEY
    else process.env.EMAIL_TOKEN_ENCRYPTION_KEY = originalEncryptionKey
  })
  resetState()
  const { password, ciphertext } = emailNotifications.createInitialTemporaryPassword()
  rows.users.push({
    id: student.id,
    role: 'student',
    status: 'approved',
    must_reset_password: true,
    initial_password_ciphertext: ciphertext,
  })

  const delivery = await emailNotifications.sendInitialTemporaryPassword({
    ...student,
    approvedAt: '2026-10-12T10:00:00.000Z',
  }, ciphertext)
  const adminCredential = await emailNotifications.getInitialTemporaryPasswordForAdmin(student.id)

  assert.equal(delivery.status, 'accepted')
  assert.equal(adminCredential.available, true)
  assert.equal(adminCredential.password, password)
  assert.notEqual(ciphertext, password)
  assert.equal(rows.email_notifications.length, 1)
  assert.equal(rows.email_notifications[0].payload.initialPasswordCiphertext, ciphertext)
  assert.doesNotMatch(JSON.stringify(rows.email_notifications[0].payload), new RegExp(password))
  assert.match(sentMessages[0].textContent, new RegExp(password))

  rows.users[0].must_reset_password = false
  assert.deepEqual(await emailNotifications.getInitialTemporaryPasswordForAdmin(student.id), {
    available: false,
    password: null,
  })
})

test('outbox database failure preserves the usable setup token for a later queue retry', async t => {
  t.after(() => {
    resetState()
    if (originalEncryptionKey === undefined) delete process.env.EMAIL_TOKEN_ENCRYPTION_KEY
    else process.env.EMAIL_TOKEN_ENCRYPTION_KEY = originalEncryptionKey
  })
  resetState()
  const originalConsoleError = console.error
  const diagnosticLogs = []
  console.error = (...args) => diagnosticLogs.push(args.join(' '))

  try {
    const invitation = await emailNotifications.createAccountSetupInvitation(student.id)
    failNextNotificationInsert = true
    await assert.rejects(emailNotifications.sendStudentWelcome(student, invitation), /outbox database unavailable/)

    const reusedInvitation = await emailNotifications.createAccountSetupInvitation(student.id)
    const delivery = await emailNotifications.sendStudentWelcome(student, reusedInvitation)

    assert.equal(reusedInvitation.token, invitation.token)
    assert.equal(reusedInvitation.id, invitation.id)
    assert.equal(delivery.notificationId, rows.email_notifications[0].id)
    assert.equal(delivery.status, 'accepted')
    assert.equal(rows.account_setup_tokens.length, 1)
    assert.equal(rows.email_notifications.length, 1)
    assert.equal(rows.email_notifications[0].status, 'accepted')
    assert.equal(sentMessages.length, 1)
    assert.match(diagnosticLogs.join('\n'), /"operation":"outbox_insert"/)
    assert.match(diagnosticLogs.join('\n'), /"code":"XX000"/)
    assert.doesNotMatch(diagnosticLogs.join('\n'), new RegExp(invitation.token))
    assert.doesNotMatch(diagnosticLogs.join('\n'), /student@example\.test/)
  } finally {
    console.error = originalConsoleError
  }
})

test('administrator notification retry reuses the persisted welcome email and its same setup link', async t => {
  t.after(() => {
    resetState()
    if (originalEncryptionKey === undefined) delete process.env.EMAIL_TOKEN_ENCRYPTION_KEY
    else process.env.EMAIL_TOKEN_ENCRYPTION_KEY = originalEncryptionKey
  })
  resetState()
  const originalConsoleError = console.error
  const diagnosticLogs = []
  console.error = (...args) => diagnosticLogs.push(args.join(' '))
  providerImplementation = async () => {
    throw Object.assign(new Error('provider rejected request'), {
      statusCode: 401,
      providerCode: 'unauthorized',
    })
  }

  try {
    const invitation = await emailNotifications.createAccountSetupInvitation(student.id)
    const delivery = await emailNotifications.sendStudentWelcome(student, invitation)
    const notificationId = delivery.notificationId
    const failed = rows.email_notifications[0]
    assert.equal(delivery.status, 'failed')
    assert.ok(delivery.safe_error)
    assert.equal(failed.status, 'failed')
    assert.equal(failed.payload.setupTokenCiphertext, invitation.tokenCiphertext)

    providerImplementation = async () => ({ messageId: 'smtp-message-retry' })
    const retry = await emailNotifications.retryNotification(notificationId)

    assert.equal(retry.retried, true)
    assert.equal(retry.status, 'accepted')
    assert.equal(rows.email_notifications.length, 1)
    assert.equal(rows.email_notifications[0].status, 'accepted')
    assert.equal(rows.email_notifications[0].payload.setupTokenCiphertext, invitation.tokenCiphertext)
    assert.equal(sentMessages.length, 2)
    assert.match(diagnosticLogs.join('\n'), /"operation":"python_email_delivery"/)
    assert.match(diagnosticLogs.join('\n'), /"httpStatus":401/)
    assert.match(diagnosticLogs.join('\n'), /"providerCode":"unauthorized"/)
    assert.doesNotMatch(diagnosticLogs.join('\n'), new RegExp(invitation.token))
  } finally {
    console.error = originalConsoleError
  }
})

test('welcome delivery reports SMTP acceptance, not mailbox delivery', async t => {
  t.after(() => {
    resetState()
    if (originalEncryptionKey === undefined) delete process.env.EMAIL_TOKEN_ENCRYPTION_KEY
    else process.env.EMAIL_TOKEN_ENCRYPTION_KEY = originalEncryptionKey
  })
  resetState()

  const invitation = await emailNotifications.createAccountSetupInvitation(student.id)
  const delivery = await emailNotifications.sendStudentWelcome(student, invitation)

  assert.equal(delivery.status, 'accepted')
  assert.ok(delivery.notificationId)
  assert.equal(rows.email_notifications[0].status, 'accepted')
  assert.notEqual(delivery.status, 'delivered')
})

test('manual resend creates a new delivery attempt after an uncertain initial send', async t => {
  t.after(() => {
    resetState()
    if (originalEncryptionKey === undefined) delete process.env.EMAIL_TOKEN_ENCRYPTION_KEY
    else process.env.EMAIL_TOKEN_ENCRYPTION_KEY = originalEncryptionKey
  })
  resetState()
  providerImplementation = async () => {
    throw Object.assign(new Error('mailer disconnected'), { uncertain: true })
  }

  const invitation = await emailNotifications.createAccountSetupInvitation(student.id)
  const firstDelivery = await emailNotifications.sendStudentWelcome(student, invitation)
  assert.equal(firstDelivery.status, 'unknown')
  assert.equal(rows.email_notifications.length, 1)
  assert.equal(sentMessages.length, 1)

  providerImplementation = async () => ({ messageId: 'smtp-message-manual-resend' })
  const resentDelivery = await emailNotifications.sendStudentWelcome(
    student,
    invitation,
    { forceResend: true },
  )

  assert.equal(resentDelivery.status, 'accepted')
  assert.equal(rows.email_notifications.length, 2)
  assert.notEqual(rows.email_notifications[0].idempotency_key, rows.email_notifications[1].idempotency_key)
  assert.equal(rows.email_notifications[0].payload.setupTokenCiphertext, invitation.tokenCiphertext)
  assert.equal(rows.email_notifications[1].payload.setupTokenCiphertext, invitation.tokenCiphertext)
  assert.equal(sentMessages.length, 2)
})

test('application rejection email uses the Python sender and escapes applicant-controlled content', async t => {
  t.after(() => {
    resetState()
    if (originalEncryptionKey === undefined) delete process.env.EMAIL_TOKEN_ENCRYPTION_KEY
    else process.env.EMAIL_TOKEN_ENCRYPTION_KEY = originalEncryptionKey
  })
  resetState()

  await emailNotifications.sendRejectionEmail(
    { name: '<Applicant>', email: 'applicant@example.test' },
    '<script>alert(1)</script>',
  )

  assert.equal(sentMessages.length, 1)
  assert.equal(sentMessages[0].to[0].email, 'applicant@example.test')
  assert.match(sentMessages[0].htmlContent, /&lt;Applicant&gt;/)
  assert.match(sentMessages[0].htmlContent, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.doesNotMatch(sentMessages[0].htmlContent, /<script>/)
})

test('welcome email with invalid student address is reported as skipped', async t => {
  t.after(() => {
    resetState()
    if (originalEncryptionKey === undefined) delete process.env.EMAIL_TOKEN_ENCRYPTION_KEY
    else process.env.EMAIL_TOKEN_ENCRYPTION_KEY = originalEncryptionKey
  })
  resetState()

  const invitation = await emailNotifications.createAccountSetupInvitation(student.id)
  const delivery = await emailNotifications.sendStudentWelcome({ ...student, email: 'invalid' }, invitation)

  assert.equal(delivery.status, 'skipped')
  assert.equal(delivery.notificationId, null)
  assert.equal(rows.email_notifications.length, 0)
  assert.equal(sentMessages.length, 0)
})
