const DEFAULT_SESSION_INACTIVITY_TIMEOUT_SECONDS = 30 * 60
const configuredTimeoutMinutes = Number(process.env.SESSION_INACTIVITY_TIMEOUT_MINUTES)
const SESSION_INACTIVITY_TIMEOUT_SECONDS = Number.isSafeInteger(configuredTimeoutMinutes)
  && configuredTimeoutMinutes >= 1
  && configuredTimeoutMinutes <= 1440
  ? configuredTimeoutMinutes * 60
  : DEFAULT_SESSION_INACTIVITY_TIMEOUT_SECONDS
const ACCESS_TOKEN_MAX_AGE_SECONDS = 15 * 60
const SESSION_EXPIRED_MESSAGE = 'Your session expired because you were inactive. Please sign in again.'

const getSessionExpiresAt = (session, inactivityTimeoutSeconds = SESSION_INACTIVITY_TIMEOUT_SECONDS) => {
  const lastActivity = Date.parse(session?.last_activity || session?.created_at || session?.login_at || '')
  if (!Number.isFinite(lastActivity)) return null
  return lastActivity + inactivityTimeoutSeconds * 1000
}

const sendSessionExpired = (res) => res.status(401).json({
  success: false,
  code: 'SESSION_EXPIRED',
  message: SESSION_EXPIRED_MESSAGE,
})

module.exports = {
  ACCESS_TOKEN_MAX_AGE_SECONDS,
  DEFAULT_SESSION_INACTIVITY_TIMEOUT_SECONDS,
  SESSION_EXPIRED_MESSAGE,
  SESSION_INACTIVITY_TIMEOUT_SECONDS,
  getSessionExpiresAt,
  sendSessionExpired,
}
