const crypto = require('crypto')

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const TOTP_PERIOD_SECONDS = 30
const TOTP_DIGITS = 6
const RECOVERY_CODE_COUNT = 10

const base32Encode = (input) => {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of input) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return output
}

const base32Decode = (input) => {
  let bits = 0
  let value = 0
  const output = []
  for (const character of String(input).toUpperCase().replace(/=+$/g, '')) {
    const index = BASE32_ALPHABET.indexOf(character)
    if (index < 0) throw new Error('Invalid TOTP secret encoding.')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(output)
}

const generateTotpSecret = () => base32Encode(crypto.randomBytes(20))

const getTotpCode = (secret, counter) => {
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter))
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(counterBuffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, '0')
}

const matchTotpCounter = (secret, token, now = Date.now(), lastCounter = null) => {
  const supplied = String(token || '').replace(/\s/g, '')
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(supplied)) return null

  const currentCounter = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS)
  for (const counter of [currentCounter, currentCounter - 1, currentCounter + 1]) {
    if (counter < 0 || (lastCounter !== null && lastCounter !== undefined && counter <= Number(lastCounter))) continue
    const expected = getTotpCode(secret, counter)
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return counter
  }
  return null
}

const encryptionKey = () => {
  const configured = process.env.ADMIN_TOTP_ENCRYPTION_KEY
  if (!configured) throw new Error('ADMIN_TOTP_ENCRYPTION_KEY is required for MFA.')
  const key = /^[\da-f]{64}$/i.test(configured)
    ? Buffer.from(configured, 'hex')
    : Buffer.from(configured, 'base64')
  if (key.length !== 32) throw new Error('ADMIN_TOTP_ENCRYPTION_KEY must decode to exactly 32 bytes.')
  return key
}

const hashAdminIdentifier = (identifier) => crypto
  .createHmac('sha256', encryptionKey())
  .update(String(identifier || '').trim().toLowerCase())
  .digest('hex')

const encryptTotpSecret = (secret) => {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
}

const decryptTotpSecret = (value) => {
  const [version, ivValue, tagValue, encryptedValue] = String(value || '').split('.')
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) {
    throw new Error('Stored MFA secret is invalid.')
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

const createChallengeToken = () => crypto.randomBytes(32).toString('base64url')
const hashOpaqueToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex')
const hashRecoveryCode = (code) => crypto.createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex')

const createRecoveryCodes = () => {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => crypto.randomBytes(16).toString('hex').toUpperCase())
  return { codes, hashes: codes.map(hashRecoveryCode) }
}

const isStrongAdminPassword = (password) => {
  const value = String(password || '')
  return Buffer.byteLength(value, 'utf8') <= 72
    && value.length >= 12
    && /[a-z]/.test(value)
    && /[A-Z]/.test(value)
    && /\d/.test(value)
    && /[^A-Za-z0-9]/.test(value)
}

module.exports = {
  TOTP_PERIOD_SECONDS,
  base32Encode,
  base32Decode,
  createChallengeToken,
  createRecoveryCodes,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  getTotpCode,
  hashAdminIdentifier,
  hashOpaqueToken,
  hashRecoveryCode,
  isStrongAdminPassword,
  matchTotpCounter,
}
