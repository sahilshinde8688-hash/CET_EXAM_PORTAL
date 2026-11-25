const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const {
  decryptTotpSecret,
  encryptTotpSecret,
  getTotpCode,
  hashOpaqueToken,
  hashRecoveryCode,
} = require('../utils/adminMfa')

process.env.ADMIN_TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')

const user = {
  id: 'admin-1',
  email: 'admin@example.test',
  role: 'admin',
  status: 'approved',
  totpEnabled: false,
  totpSecretEncrypted: null,
  totpLastCounter: null,
  backupCodeHashes: [],
}
const state = {
  user: { ...user },
  challenges: new Map(),
  lock: null,
}

const db = {
  createAdminMfaChallenge: async (challenge) => {
    state.challenges.set(challenge.tokenHash, {
      ...challenge,
      user_id: challenge.userId,
      totp_secret_encrypted: challenge.totpSecretEncrypted || null,
      remember_me: challenge.rememberMe,
      used_at: null,
    })
  },
  findAdminMfaChallenge: async (tokenHash) => state.challenges.get(tokenHash) || null,
  findMfaUserById: async () => state.user,
  getAdminAuthLock: async () => state.lock,
  completeAdminTotpSetup: async ({ userId, tokenHash, counter, backupCodeHashes }) => {
    const challenge = state.challenges.get(tokenHash)
    if (!challenge || challenge.user_id !== userId || challenge.used_at) return false
    state.user.totpSecretEncrypted = challenge.totpSecretEncrypted
    state.user.totpEnabled = true
    state.user.totpLastCounter = counter
    state.user.backupCodeHashes = backupCodeHashes
    challenge.used_at = new Date().toISOString()
    return true
  },
  consumeAdminTotpCounter: async (userId, counter) => {
    if (userId !== state.user.id || counter <= Number(state.user.totpLastCounter)) return false
    state.user.totpLastCounter = counter
    return true
  },
  consumeAdminBackupCode: async (userId, codeHash) => {
    if (userId !== state.user.id) return false
    const index = state.user.backupCodeHashes.indexOf(codeHash)
    if (index < 0) return false
    state.user.backupCodeHashes.splice(index, 1)
    return true
  },
  markAdminMfaChallengeUsed: async (tokenHash) => {
    const challenge = state.challenges.get(tokenHash)
    if (!challenge || challenge.used_at) return false
    challenge.used_at = new Date().toISOString()
    return true
  },
}

const dbModulePath = require.resolve('../services/dbService')
const dbModule = new Module(dbModulePath)
dbModule.filename = dbModulePath
dbModule.loaded = true
dbModule.exports = db
require.cache[dbModulePath] = dbModule

const {
  createAdminMfaChallenge,
  verifyAdminMfaChallenge,
} = require('../services/adminMfaService')

const resetState = () => {
  state.user = { ...user }
  state.challenges.clear()
  state.lock = null
}

const nextCode = (secret, lastCounter = null) => {
  const current = Math.floor(Date.now() / 1000 / 30)
  const counter = lastCounter === null ? current : Math.max(current, Number(lastCounter) + 1)
  return getTotpCode(secret, counter)
}

test('enrollment requires a valid code and returns recovery codes once', async () => {
  resetState()
  const challenge = await createAdminMfaChallenge(state.user)
  assert.equal(challenge.setupRequired, true)
  assert.match(challenge.qrCodeDataUrl, /^data:image\/png;base64,/)
  assert.ok(challenge.manualSecret)

  const code = nextCode(challenge.manualSecret)
  const invalidCode = `${code[0] === '0' ? '1' : '0'}${code.slice(1)}`
  const invalid = await verifyAdminMfaChallenge(challenge.challengeToken, invalidCode)
  assert.equal(invalid.valid, false)

  const result = await verifyAdminMfaChallenge(challenge.challengeToken, code)
  assert.equal(result.valid, true)
  assert.equal(result.backupCodes.length, 10)
  assert.equal(state.user.totpEnabled, true)
  assert.equal(decryptTotpSecret(state.user.totpSecretEncrypted), challenge.manualSecret)
  assert.equal(await verifyAdminMfaChallenge(challenge.challengeToken, code), null)
})

test('student accounts must enroll an authenticator before receiving a session', async () => {
  resetState()
  state.user = {
    ...user,
    id: 'student-1',
    email: 'student@example.test',
    role: 'student',
  }

  const challenge = await createAdminMfaChallenge(state.user)
  assert.equal(challenge.setupRequired, true)

  const result = await verifyAdminMfaChallenge(challenge.challengeToken, nextCode(challenge.manualSecret))
  assert.equal(result.valid, true)
  assert.equal(result.user.role, 'student')
  assert.equal(result.backupCodes.length, 10)
  assert.equal(state.user.totpEnabled, true)
})

test('login rejects expired and replayed authenticator codes and consumes recovery codes once', async () => {
  resetState()
  const secret = 'JBSWY3DPEHPK3PXP'
  state.user.totpEnabled = true
  state.user.totpSecretEncrypted = encryptTotpSecret(secret)
  state.user.totpLastCounter = Math.floor(Date.now() / 1000 / 30) - 1
  state.user.backupCodeHashes = [hashRecoveryCode('A1B2C3D4')]

  const challenge = await createAdminMfaChallenge(state.user)
  const code = nextCode(secret, state.user.totpLastCounter)
  const result = await verifyAdminMfaChallenge(challenge.challengeToken, code)
  assert.equal(result.valid, true)
  assert.equal(result.usedRecoveryCode, false)

  const replayChallenge = await createAdminMfaChallenge(state.user)
  const replay = await verifyAdminMfaChallenge(replayChallenge.challengeToken, code)
  assert.equal(replay.valid, false)

  const recoveryChallenge = await createAdminMfaChallenge(state.user)
  const recovery = await verifyAdminMfaChallenge(recoveryChallenge.challengeToken, 'A1B2C3D4')
  assert.equal(recovery.valid, true)
  assert.equal(recovery.usedRecoveryCode, true)
  assert.equal(await verifyAdminMfaChallenge(recoveryChallenge.challengeToken, 'A1B2C3D4'), null)

  const expiredChallenge = await createAdminMfaChallenge(state.user)
  const storedChallenge = state.challenges.get(hashOpaqueToken(expiredChallenge.challengeToken))
  storedChallenge.expires_at = new Date(Date.now() - 1000).toISOString()
  assert.equal(await verifyAdminMfaChallenge(expiredChallenge.challengeToken, '000000'), null)
})

test('locked administrator accounts cannot complete MFA', async () => {
  resetState()
  const secret = 'JBSWY3DPEHPK3PXP'
  state.user.totpEnabled = true
  state.user.totpSecretEncrypted = encryptTotpSecret(secret)
  state.user.totpLastCounter = Math.floor(Date.now() / 1000 / 30) - 1
  state.lock = { is_locked: true }

  const challenge = await createAdminMfaChallenge(state.user)
  const result = await verifyAdminMfaChallenge(challenge.challengeToken, nextCode(secret))
  assert.equal(result.valid, false)
  assert.equal(result.locked, true)
})
