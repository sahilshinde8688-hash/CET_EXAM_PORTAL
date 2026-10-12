const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

const rpcCalls = []
let rpcResult = { data: true, error: null }
const supabase = {
  rpc: async (...args) => {
    rpcCalls.push(args)
    return rpcResult
  },
}
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === '../config/supabase') return supabase
  return originalLoad.call(this, request, parent, isMain)
}

let db
try {
  db = require('../services/dbService')
} finally {
  Module._load = originalLoad
}

test('first-login password consumption calls the atomic Supabase cleanup function', async t => {
  t.after(() => {
    rpcCalls.length = 0
    rpcResult = { data: true, error: null }
  })

  const consumed = await db.consumeInitialTemporaryPassword('student-1')

  assert.equal(consumed, true)
  assert.deepEqual(rpcCalls, [[
    'consume_initial_temporary_password',
    { p_user_id: 'student-1' },
  ]])
})

test('first-login cleanup propagates database failures', async t => {
  t.after(() => {
    rpcResult = { data: true, error: null }
  })
  rpcResult = { data: null, error: new Error('database unavailable') }

  await assert.rejects(db.consumeInitialTemporaryPassword('student-1'), /database unavailable/)
})
