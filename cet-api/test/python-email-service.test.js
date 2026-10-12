const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

const originalLoad = Module._load
const originalEnvironment = {
  PYTHON_EMAIL_SERVICE_URL: process.env.PYTHON_EMAIL_SERVICE_URL,
  PYTHON_EMAIL_SERVICE_TOKEN: process.env.PYTHON_EMAIL_SERVICE_TOKEN,
  EMAIL_SENDER_EMAIL: process.env.EMAIL_SENDER_EMAIL,
  EMAIL_SENDER_NAME: process.env.EMAIL_SENDER_NAME,
}
const requests = []
let getImplementation = async () => ({ data: { configured: true } })
let postImplementation = async () => ({ data: { messageId: '<message-1>' } })

Module._load = function (request, parent, isMain) {
  if (request === 'axios') {
    return {
      get: (...args) => {
        requests.push(args)
        return getImplementation(...args)
      },
      post: (...args) => {
        requests.push(args)
        return postImplementation(...args)
      },
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}

let emailService
try {
  emailService = require('../services/pythonEmailService')
} finally {
  Module._load = originalLoad
}

const configure = () => {
  process.env.PYTHON_EMAIL_SERVICE_URL = 'https://mailer.example.test/'
  process.env.PYTHON_EMAIL_SERVICE_TOKEN = 'test-only-service-token'
  process.env.EMAIL_SENDER_EMAIL = 'sender@example.test'
  process.env.EMAIL_SENDER_NAME = 'CETNova'
}

const restoreEnvironment = () => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  requests.length = 0
  getImplementation = async () => ({ data: { configured: true } })
  postImplementation = async () => ({ data: { messageId: '<message-1>' } })
}

test('sends messages to the authenticated Python mailer service', async t => {
  t.after(restoreEnvironment)
  configure()

  const result = await emailService.sendEmail({
    to: [{ email: 'student@example.test', name: 'Student' }],
    subject: 'Result',
    htmlContent: '<p>Result</p>',
    textContent: 'Result',
  })

  assert.deepEqual(result, { messageId: '<message-1>' })
  assert.equal(requests.length, 1)
  assert.equal(requests[0][0], 'https://mailer.example.test/send')
  assert.deepEqual(requests[0][1].to, [{ email: 'student@example.test', name: 'Student' }])
  assert.equal(requests[0][2].headers.Authorization, 'Bearer test-only-service-token')
  assert.equal(requests[0][2].timeout, 45_000)
})

test('reports missing service configuration without making a request', async t => {
  t.after(restoreEnvironment)
  delete process.env.PYTHON_EMAIL_SERVICE_URL

  await assert.rejects(
    emailService.sendEmail({ to: [{ email: 'student@example.test' }], subject: 'Result' }),
    error => error instanceof emailService.EmailDeliveryError
      && /PYTHON_EMAIL_SERVICE_URL/.test(error.message),
  )
  assert.equal(requests.length, 0)
})

test('checks that the Python mailer and its SMTP configuration are ready', async t => {
  t.after(restoreEnvironment)
  configure()

  assert.deepEqual(await emailService.validateEmailService(), { valid: true })
  assert.equal(requests[0][0], 'https://mailer.example.test/health')
  assert.equal(requests[0][1].headers.Authorization, 'Bearer test-only-service-token')
})

test('classifies transient service errors and uncertain transport failures', async t => {
  t.after(restoreEnvironment)
  configure()
  postImplementation = async () => {
    throw { response: { status: 503, data: { error: 'SMTP temporarily unavailable.', retryable: true } } }
  }
  await assert.rejects(
    emailService.sendEmail({ to: [{ email: 'student@example.test' }], subject: 'Result' }),
    error => error.retryable === true && error.statusCode === 503,
  )

  postImplementation = async () => { throw new Error('network disconnected') }
  await assert.rejects(
    emailService.sendEmail({ to: [{ email: 'student@example.test' }], subject: 'Result' }),
    error => error.uncertain === true && !error.retryable
      && !/network disconnected/.test(error.message),
  )
})

test('classifies a refused mailer connection as a definite retryable failure', async t => {
  t.after(restoreEnvironment)
  configure()
  postImplementation = async () => { throw Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' }) }

  await assert.rejects(
    emailService.sendEmail({ to: [{ email: 'student@example.test' }], subject: 'Result' }),
    error => error.retryable === true
      && !error.uncertain
      && /ECONNREFUSED/.test(error.message),
  )
})

test('does not expose SMTP credentials returned by a mailer error', async t => {
  t.after(restoreEnvironment)
  configure()
  postImplementation = async () => {
    throw { response: { status: 502, data: { error: 'SMTP authentication failed.' } } }
  }

  await assert.rejects(
    emailService.sendEmail({ to: [{ email: 'student@example.test' }], subject: 'Welcome' }),
    error => error.statusCode === 502
      && /authentication failed/i.test(error.message)
      && !error.message.includes('test-only-service-token'),
  )
})
