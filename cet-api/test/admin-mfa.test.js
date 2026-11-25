const assert = require('node:assert/strict')
const test = require('node:test')
const {
  base32Decode,
  base32Encode,
  createRecoveryCodes,
  decryptTotpSecret,
  encryptTotpSecret,
  getTotpCode,
  hashRecoveryCode,
  isStrongAdminPassword,
  matchTotpCounter,
} = require('../utils/adminMfa')

test('RFC 6238 SHA-1 vector matches the six-digit authenticator code', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890', 'ascii'))
  assert.equal(base32Decode(secret).toString('ascii'), '12345678901234567890')
  assert.equal(getTotpCode(secret, 1), '287082')
  assert.equal(matchTotpCounter(secret, '287082', 59_000), 1)
})

test('TOTP matching accepts the adjacent clock window and rejects replayed counters', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890', 'ascii'))
  const now = 59_000
  const currentCounter = 1
  assert.equal(matchTotpCounter(secret, getTotpCode(secret, currentCounter), now), currentCounter)
  assert.equal(matchTotpCounter(secret, getTotpCode(secret, currentCounter), now, currentCounter), null)
  assert.equal(matchTotpCounter(secret, '12x456', now), null)
})

test('TOTP secrets use authenticated encryption at rest', () => {
  const originalKey = process.env.ADMIN_TOTP_ENCRYPTION_KEY
  process.env.ADMIN_TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
  try {
    const secret = 'JBSWY3DPEHPK3PXP'
    const encrypted = encryptTotpSecret(secret)
    assert.notEqual(encrypted, secret)
    assert.equal(decryptTotpSecret(encrypted), secret)
    const parts = encrypted.split('.')
    parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`
    assert.throws(() => decryptTotpSecret(parts.join('.')))
  } finally {
    if (originalKey === undefined) delete process.env.ADMIN_TOTP_ENCRYPTION_KEY
    else process.env.ADMIN_TOTP_ENCRYPTION_KEY = originalKey
  }
})

test('recovery codes are random, uniquely hashed, and meet the administrator password policy', () => {
  const { codes, hashes } = createRecoveryCodes()
  assert.equal(codes.length, 10)
  assert.equal(new Set(codes).size, codes.length)
  assert.equal(new Set(hashes).size, hashes.length)
  assert.equal(hashRecoveryCode(codes[0]), hashes[0])
  assert.ok(codes.every(code => /^[A-F0-9]{32}$/.test(code)))
  assert.equal(isStrongAdminPassword('Strong!AdminPass123'), true)
  assert.equal(isStrongAdminPassword('short'), false)
  assert.equal(isStrongAdminPassword('LongButNoDigit!'), false)
  assert.equal(isStrongAdminPassword(`A1!${'a'.repeat(70)}`), false)
})
