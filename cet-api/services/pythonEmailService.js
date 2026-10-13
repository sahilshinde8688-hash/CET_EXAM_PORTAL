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
  constructor(message, { statusCode = null, category = null, retryable = false, uncertain = false } = {}) {
    super(message)
    this.name = 'EmailDeliveryError'
    this.statusCode = statusCode
    this.category = category
    this.retryable = retryable
    this.uncertain = uncertain
  }
}

const requestError = (error, { validation = false } = {}) => {
  const response = error.response
  if (!response) {
    const code = String(error.code || '')
    if (code === 'ECONNREFUSED') {
      return new EmailDeliveryError(
        validation
          ? `Could not connect to the Python email service (${code}). Check the mailer URL and Render service status.`
          : `Could not connect to the Python email service (${code}); the email was not submitted.`,
        { category: 'mailer_connection_refused', retryable: true },
      )
    }
    if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
      return new EmailDeliveryError(
        'DNS lookup for the Python email service failed. Check PYTHON_EMAIL_SERVICE_URL.',
        { category: 'mailer_dns', retryable: true },
      )
    }
    return new EmailDeliveryError(
      validation
        ? 'The Python email service readiness check timed out or could not connect. Check Render service status and URL.'
        : 'The Python email service did not respond; delivery status is unknown.',
      { category: 'mailer_timeout_or_transport', uncertain: !validation, retryable: validation },
    )
  }

  const responseError = response.data || {}
  const category = typeof responseError.category === 'string' ? responseError.category : null
  const missing = Array.isArray(responseError.missing)
    ? responseError.missing.filter(value => typeof value === 'string')
    : []
  const message = response.status === 401 ? 'The Python email service rejected its service token. Ensure the API and mailer tokens match.'
    : missing.length ? `Python mailer configuration is incomplete. Missing: ${missing.join(', ')}.`
    : typeof responseError.error === 'string' ? responseError.error.slice(0, 240)
      : response.status === 503 ? 'The Python email service is not ready or SMTP is temporarily unavailable. Check mailer configuration and Render logs.'
        : 'The Python email service could not send the message.'
  return new EmailDeliveryError(message, {
    statusCode: Number(response.status) || null,
    category,
    retryable: responseError.retryable === true,
    uncertain: responseError.uncertain === true,
  })
}

const validateEmailService = async () => {
  const configurationError = getConfigurationError()
  if (configurationError) throw new EmailDeliveryError(configurationError)
  try {
    const baseUrl = process.env.PYTHON_EMAIL_SERVICE_URL.replace(/\/+$/, '')
    const health = await axios.get(`${baseUrl}/health`, {
      ...requestOptions(),
      timeout: 65_000,
    })
    if (health.data?.status !== 'ok') {
      throw new EmailDeliveryError('The Python email service health check returned an unexpected response.', {
        category: 'mailer_health_response',
      })
    }
    const { data } = await axios.get(`${baseUrl}/ready`, {
      ...requestOptions(),
      timeout: 15_000,
    })
    if (data?.configured !== true) {
      const missing = Array.isArray(data?.missing) ? data.missing.filter(value => typeof value === 'string') : []
      const detail = missing.length ? ` Missing configuration: ${missing.join(', ')}.` : ''
      throw new EmailDeliveryError(`The Python email service is running but SMTP configuration is incomplete.${detail}`, {
        statusCode: 503,
        category: 'mailer_configuration',
      })
    }
    return { valid: true, message: 'Mailer configuration is complete. This check does not test SMTP connectivity; send a test email to verify delivery.' }
  } catch (error) {
    if (error instanceof EmailDeliveryError) throw error
    throw requestError(error, { validation: true })
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
