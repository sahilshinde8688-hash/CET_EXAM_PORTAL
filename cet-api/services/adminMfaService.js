const QRCode = require('qrcode')
const db = require('./dbService')
const {
  createChallengeToken,
  createRecoveryCodes,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  hashAdminIdentifier,
  hashOpaqueToken,
  hashRecoveryCode,
  matchTotpCounter,
} = require('../utils/adminMfa')

const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000
const TOTP_ISSUER = process.env.ADMIN_TOTP_ISSUER || 'CETNova'

const createAdminMfaChallenge = async (user, rememberMe = false) => {
  const token = createChallengeToken()
  const tokenHash = hashOpaqueToken(token)
  const expiresAt = new Date(Date.now() + CHALLENGE_LIFETIME_MS).toISOString()
  const isSetup = !user.totpEnabled
  let secret = null
  let qrCodeDataUrl = null

  if (isSetup) {
    secret = generateTotpSecret()
    const encryptedSecret = encryptTotpSecret(secret)
    await db.createAdminMfaChallenge({
      userId: user.id,
      tokenHash,
      purpose: 'setup',
      totpSecretEncrypted: encryptedSecret,
      rememberMe,
      expiresAt,
    })
    const label = `${TOTP_ISSUER}:${user.email}`
    const otpauthUrl = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(TOTP_ISSUER)}&algorithm=SHA1&digits=6&period=30`
    qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, { errorCorrectionLevel: 'M', margin: 2, width: 256 })
  } else {
    await db.createAdminMfaChallenge({
      userId: user.id,
      tokenHash,
      purpose: 'login',
      rememberMe,
      expiresAt,
    })
  }

  return {
    challengeToken: token,
    expiresAt,
    setupRequired: isSetup,
    ...(isSetup ? { qrCodeDataUrl, manualSecret: secret } : {}),
  }
}

const verifyAdminMfaChallenge = async (token, suppliedCode) => {
  if (typeof token !== 'string' || token.length < 40 || token.length > 128) return null
  const tokenHash = hashOpaqueToken(token)
  const challenge = await db.findAdminMfaChallenge(tokenHash)
  if (!challenge || challenge.used_at || Date.parse(challenge.expires_at) <= Date.now()) return null

  const user = await db.findMfaUserById(challenge.user_id)
  if (!user || !['admin', 'student'].includes(user.role) || user.status === 'pending' || user.status === 'rejected') return null
  if (user.isLocked) return { valid: false, locked: true, user }
  const identifierHash = hashAdminIdentifier(user.email)
  const lock = await db.getAdminAuthLock(identifierHash)
  if (lock?.is_locked) return { valid: false, locked: true, user }

  if (challenge.purpose === 'setup') {
    if (user.totpEnabled || !challenge.totp_secret_encrypted) return null
    const secret = decryptTotpSecret(challenge.totp_secret_encrypted)
    const counter = matchTotpCounter(secret, suppliedCode)
    if (counter === null) return { valid: false, user }

    const { codes, hashes } = createRecoveryCodes()
    const activated = await db.completeAdminTotpSetup({
      userId: user.id,
      tokenHash,
      counter,
      backupCodeHashes: hashes,
    })
    if (!activated) return null
    user.totpEnabled = true
    user.totpLastCounter = counter
    user.backupCodeHashes = hashes
    return { valid: true, user, rememberMe: challenge.remember_me, backupCodes: codes }
  }

  if (challenge.purpose !== 'login' || !user.totpEnabled || !user.totpSecretEncrypted) return null
  const secret = decryptTotpSecret(user.totpSecretEncrypted)
  const counter = matchTotpCounter(secret, suppliedCode, Date.now(), user.totpLastCounter)
  let validFactor = false

  if (counter !== null) {
    validFactor = await db.consumeAdminTotpCounter(user.id, counter)
  } else if (typeof suppliedCode === 'string' && suppliedCode.length <= 64) {
    validFactor = await db.consumeAdminBackupCode(user.id, hashRecoveryCode(suppliedCode))
  }

  if (!validFactor) return { valid: false, user }
  if (!await db.markAdminMfaChallengeUsed(tokenHash)) return null

  return { valid: true, user, rememberMe: challenge.remember_me, usedRecoveryCode: counter === null }
}

const verifyAdminSecondFactor = async (user, suppliedCode) => {
  if (!user?.totpEnabled || !user.totpSecretEncrypted) return false
  const secret = decryptTotpSecret(user.totpSecretEncrypted)
  const counter = matchTotpCounter(secret, suppliedCode, Date.now(), user.totpLastCounter)
  if (counter !== null && await db.consumeAdminTotpCounter(user.id, counter)) return true
  if (typeof suppliedCode !== 'string' || suppliedCode.length > 64) return false
  return db.consumeAdminBackupCode(user.id, hashRecoveryCode(suppliedCode))
}

module.exports = {
  createAdminMfaChallenge,
  hashAdminIdentifier,
  verifyAdminSecondFactor,
  verifyAdminMfaChallenge,
}
