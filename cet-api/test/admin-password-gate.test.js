const test = require('node:test')
const assert = require('node:assert/strict')
process.env.SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test'
const { adminOnly } = require('../middleware/auth')

const makeResponse = () => ({
  statusCode: null,
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

test('requires a changed password before administrator routes are available', () => {
  const req = {
    user: {
      role: 'admin',
      status: 'approved',
      adminRole: 'Super Admin',
      mustResetPassword: true,
    },
    mfaVerified: true,
    method: 'GET',
    baseUrl: '/api/admin',
    path: '/overview',
  }
  const res = makeResponse()
  let nextCalled = false

  adminOnly(req, res, () => { nextCalled = true })

  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 403)
  assert.equal(res.body.code, 'ADMIN_PASSWORD_RESET_REQUIRED')
})

test('allows the authenticated administrator to complete the required password change', () => {
  const req = {
    user: {
      role: 'admin',
      status: 'approved',
      adminRole: 'Super Admin',
      mustResetPassword: true,
    },
    mfaVerified: true,
    method: 'POST',
    baseUrl: '/api/admin/security',
    path: '/password',
  }
  const res = makeResponse()
  let nextCalled = false

  adminOnly(req, res, () => { nextCalled = true })

  assert.equal(nextCalled, true)
  assert.equal(res.statusCode, null)
})
