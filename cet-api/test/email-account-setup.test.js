const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const Module = require('node:module')

const rpcCalls = []
let rpcResult = { data: 'student-1', error: null }
const supabase = {
  rpc: async (...args) => {
    rpcCalls.push(args)
    return rpcResult
  },
}
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === '../config/supabase') return supabase
  if (request === './dbService') return {}
  return originalLoad.call(this, request, parent, isMain)
}

let emailNotifications
try {
  emailNotifications = require('../services/emailNotificationService')
} finally {
  Module._load = originalLoad
}

test('account setup sends only a SHA-256 token hash to the atomic one-use database function', async t => {
  t.after(() => {
    rpcCalls.length = 0
    rpcResult = { data: 'student-1', error: null }
  })
  const rawToken = 'random-single-use-setup-token'
  const passwordHash = '$2a$12$server-generated-password-hash'
  const userId = await emailNotifications.completeAccountSetup(rawToken, passwordHash)

  assert.equal(userId, 'student-1')
  assert.equal(rpcCalls.length, 1)
  assert.equal(rpcCalls[0][0], 'complete_account_setup')
  assert.equal(rpcCalls[0][1].p_token_hash, crypto.createHash('sha256').update(rawToken).digest('hex'))
  assert.notEqual(rpcCalls[0][1].p_token_hash, rawToken)
  assert.equal(rpcCalls[0][1].p_password_hash, passwordHash)
  assert.equal(emailNotifications.SETUP_TOKEN_TTL_MS, 24 * 60 * 60 * 1000)
})

test('expired or already-used setup tokens return no account', async t => {
  t.after(() => {
    rpcResult = { data: 'student-1', error: null }
  })
  rpcResult = { data: null, error: null }
  const userId = await emailNotifications.completeAccountSetup('expired-token', 'hash')
  assert.equal(userId, null)
})
