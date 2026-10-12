const axios = require('axios')

const getConfiguration = () => ({
  senderEmail: process.env.EMAIL_SENDER_EMAIL?.trim() || '',
  senderName: process.env.EMAIL_SENDER_NAME?.trim() || 'CETNova',
  serviceUrlConfigured: Boolean(process.env.PYTHON_EMAIL_SERVICE_URL?.trim()),
  serviceTokenConfigured: Boolean(process.env.PYTHON_EMAIL_SERVICE_TOKEN?.trim()),
})

const getConfigurationError = () => {
  const config = getConfiguration()
  if (!config.serviceUrlConfigured) return 'Set PYTHON_EMAIL_SERVICE_URL to the Python mailer service URL.'
  if (!config.serviceTokenConfigured) return 'Set PYTHON_EMAIL_SERVICE_TOKEN on the API, scheduler, and Python mailer.'
  if (!config.senderEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.senderEmail)) {
    return 'Set EMAIL_SENDER_EMAIL to a valid sender address.'
  }
  return null
}

const requestOptions = () => ({
  headers: { Authorization: `Bearer ${process.env.PYTHON_EMAIL_SERVICE_TOKEN}` },
  timeout: 45_000,
})

class EmailDeliveryError extends Error {
  constructor(message, { statusCode = null, retryable = false, uncertain = false } = {}) {
    super(message)
    this.name = 'EmailDeliveryError'
    this.statusCode = statusCode
    this.retryable = retryable
    this.uncertain = uncertain
  }
}

const requestError = error => {
  const response = error.response
  if (!response) {
    const code = String(error.code || '')
    if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
      return new EmailDeliveryError(
        `Could not connect to the Python email service (${code}); the email was not submitted.`,
        { retryable: true },
      )
    }
    return new EmailDeliveryError(
      'The Python email service did not respond; delivery status is unknown.',
      { uncertain: true },
    )
  }

  const responseError = response.data || {}
  const message = typeof responseError.error === 'string'
    ? responseError.error.slice(0, 240)
    : 'The Python email service could not send the message.'
  return new EmailDeliveryError(message, {
    statusCode: Number(response.status) || null,
    retryable: responseError.retryable === true,
    uncertain: responseError.uncertain === true,
  })
}

const validateEmailService = async () => {
  const configurationError = getConfigurationError()
  if (configurationError) throw new EmailDeliveryError(configurationError)
  try {
    const url = `${process.env.PYTHON_EMAIL_SERVICE_URL.replace(/\/+$/, '')}/health`
    const { data } = await axios.get(url, requestOptions())
    if (data?.configured !== true) {
      throw new EmailDeliveryError('The Python email service is running but its SMTP configuration is incomplete.')
    }
    return { valid: true }
  } catch (error) {
    if (error instanceof EmailDeliveryError) throw error
    throw requestError(error)
  }
}

const sendEmail = async ({ to, subject, htmlContent, textContent }) => {
  const configurationError = getConfigurationError()
  if (configurationError) throw new EmailDeliveryError(configurationError)
  if (!Array.isArray(to) || to.length === 0
    || to.some(recipient => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email || ''))) {
    throw new EmailDeliveryError('The notification recipient address is invalid.')
  }

  try {
    const url = `${process.env.PYTHON_EMAIL_SERVICE_URL.replace(/\/+$/, '')}/send`
    const { data } = await axios.post(url, { to, subject, htmlContent, textContent }, requestOptions())
    return { messageId: data?.messageId || null }
  } catch (error) {
    if (error instanceof EmailDeliveryError) throw error
    throw requestError(error)
  }
}

module.exports = { EmailDeliveryError, getConfiguration, getConfigurationError, sendEmail, validateEmailService }
