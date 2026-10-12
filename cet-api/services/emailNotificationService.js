const crypto = require('crypto')
const supabase = require('../config/supabase')
const db = require('./dbService')
const {
  getConfiguration,
  getConfigurationError,
  sendEmail,
  validateEmailService,
} = require('./pythonEmailService')
const {
  resultEmail,
  parentResultEmail,
  welcomeEmail,
  passwordChangedEmail,
} = require('./emailTemplates')

const MAX_RETRIES = 5
const SETUP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000
const PARENT_REPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const hashToken = token => crypto.createHash('sha256').update(token).digest('hex')
const emailOperationError = (error, operation) => {
  const normalized = error instanceof Error
    ? error
    : Object.assign(new Error(String(error?.message || 'Email operation failed.')), {
      code: error?.code || null,
      statusCode: Number(error?.statusCode || error?.status) || null,
      providerCode: error?.providerCode || null,
      retryable: Boolean(error?.retryable),
      uncertain: Boolean(error?.uncertain),
    })
  if (!normalized.operation) normalized.operation = operation
  return normalized
}
const logEmailFailure = (operation, error) => {
  const message = String(error?.message || 'Email operation failed.')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
    .replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{40,}\b/g, '[redacted]')
    .replace(/(api[-_ ]?key|password|token|secret)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/[\r\n\t]/g, ' ')
    .slice(0, 240)
  console.error('[email] Operation failed:', JSON.stringify({
    operation,
    code: error?.code || null,
    httpStatus: Number(error?.statusCode) || null,
    providerCode: error?.providerCode || null,
    message,
  }))
  if (error && typeof error === 'object') error.emailDiagnosticLogged = true
}
const encryptionKey = () => {
  const secret = process.env.EMAIL_TOKEN_ENCRYPTION_KEY
  if (!secret || secret.length < 32) {
    throw new Error('Set the same EMAIL_TOKEN_ENCRYPTION_KEY on the API and scheduler to protect setup links.')
  }
  return crypto.createHash('sha256').update(secret).digest()
}
const encryptSecret = value => {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.')
}
const decryptSecret = value => {
  const [iv, tag, ciphertext] = String(value || '').split('.').map(part => Buffer.from(part, 'base64url'))
  if (!iv || !tag || !ciphertext) throw new Error('The account setup link could not be recovered.')
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
const frontendUrl = () => (process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '')
const backendUrl = () => (
  process.env.PUBLIC_API_URL
  || process.env.RENDER_EXTERNAL_URL
  || 'https://cet-portal-3vas.onrender.com'
).replace(/\/+$/, '')

const settingEnabled = async (key, defaultValue) => {
  const { data, error } = await supabase.from('system_settings').select('value').eq('key', key).maybeSingle()
  if (error) throw emailOperationError(error, 'settings_read')
  if (data?.value === undefined || data?.value === null) return defaultValue
  return data.value === true || data.value === 'true'
}

const notificationEnabled = async type => {
  if (type === 'exam_result') return settingEnabled('transactional_result_emails_enabled', true)
  if (type === 'parent_result') return settingEnabled('parent_result_emails_enabled', false)
  if (type === 'password_changed') return settingEnabled('email_notifications', true)
  return settingEnabled('student_welcome_emails_enabled', true)
}

const getEmailAdminInfo = async () => {
  const [configuration, configurationError, { data, error }] = await Promise.all([
    Promise.resolve(getConfiguration()),
    Promise.resolve(getConfigurationError()),
    supabase.from('email_notifications')
      .select('id,notification_type,student_id,test_result_id,recipient_email,status,provider_message_id,safe_error,retry_count,last_attempt_at,created_at')
      .order('created_at', { ascending: false })
      .limit(50),
  ])
  if (error) throw error

  const notifications = data || []
  const studentIds = [...new Set(notifications.map(row => row.student_id).filter(Boolean))]
  const resultIds = [...new Set(notifications.map(row => row.test_result_id).filter(Boolean))]
  const [usersResult, resultsResult] = await Promise.all([
    studentIds.length
      ? supabase.from('users').select('id,name').in('id', studentIds)
      : Promise.resolve({ data: [], error: null }),
    resultIds.length
      ? supabase.from('test_results').select('id,test_name').in('id', resultIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (usersResult.error) throw usersResult.error
  if (resultsResult.error) throw resultsResult.error
  const usersById = new Map((usersResult.data || []).map(row => [row.id, row.name]))
  const resultsById = new Map((resultsResult.data || []).map(row => [row.id, row.test_name]))

  return {
    configuration: {
      ...configuration,
      ready: !configurationError,
      error: configurationError,
      setupEncryptionConfigured: Boolean(process.env.EMAIL_TOKEN_ENCRYPTION_KEY && process.env.EMAIL_TOKEN_ENCRYPTION_KEY.length >= 32),
    },
    notifications: notifications.map(row => ({
      ...row,
      student_name: usersById.get(row.student_id) || null,
      exam_name: resultsById.get(row.test_result_id) || null,
    })),
  }
}

const createNotification = async (values) => {
  const { data, error } = await supabase.from('email_notifications')
    .insert({
      notification_type: values.type,
      student_id: values.studentId || null,
      test_result_id: values.resultId || null,
      recipient_email: values.recipient,
      idempotency_key: values.idempotencyKey,
      payload: values.payload || {},
      ...(values.parentReportTokenHash ? { parent_report_token_hash: values.parentReportTokenHash } : {}),
      ...(values.parentReportExpiresAt ? { parent_report_expires_at: values.parentReportExpiresAt } : {}),
    })
    .select('*')
    .single()
  if (error?.code === '23505') {
    const { data: existing, error: lookupError } = await supabase.from('email_notifications')
      .select('*').eq('idempotency_key', values.idempotencyKey).maybeSingle()
    if (lookupError) throw lookupError
    if (existing) return existing
  }
  if (error) throw emailOperationError(error, 'outbox_insert')
  return data
}

const templateFor = async notification => {
  const payload = notification.payload || {}
  if (notification.notification_type === 'exam_result') {
    return resultEmail({
      studentName: payload.studentName,
      testName: payload.testName,
      result: payload.result,
      reportUrl: payload.reportUrl,
    })
  }
  if (notification.notification_type === 'parent_result') {
    const token = crypto.randomBytes(32).toString('base64url')
    const tokenHash = hashToken(token)
    const expiresAt = new Date(Date.now() + PARENT_REPORT_TTL_MS).toISOString()
    const { error } = await supabase.from('email_notifications').update({
      parent_report_token_hash: tokenHash,
      parent_report_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }).eq('id', notification.id)
    if (error) throw error
    return parentResultEmail({
      studentName: payload.studentName,
      testName: payload.testName,
      result: payload.result,
      reportUrl: `${backendUrl()}/api/email/parent-report/${token}`,
    })
  }
  if (notification.notification_type === 'student_welcome') {
    if (payload.initialPasswordCiphertext) {
      return welcomeEmail({
        studentName: payload.studentName,
        username: payload.username,
        loginUrl: `${frontendUrl()}/login`,
        temporaryPassword: decryptSecret(payload.initialPasswordCiphertext),
      })
    }
    return welcomeEmail({
      studentName: payload.studentName,
      username: payload.username,
      loginUrl: `${frontendUrl()}/login`,
      setupUrl: `${frontendUrl()}/login?setup_token=${encodeURIComponent(decryptSecret(payload.setupTokenCiphertext))}`,
    })
  }
  if (notification.notification_type === 'password_changed') {
    return passwordChangedEmail({
      studentName: payload.studentName,
      loginUrl: `${frontendUrl()}/login`,
    })
  }
  if (notification.notification_type === 'admin_test') {
    const loginUrl = `${frontendUrl()}/login`
    return {
      subject: 'CETNova email test',
      htmlContent: `<p>CETNova email sending is connected. Test sent to ${String(payload.adminName || 'administrator').replace(/[&<>"']/g, '')}.</p><p><a href="${loginUrl}">Open CETNova</a></p>`,
      textContent: `CETNova email sending is connected. Open CETNova: ${loginUrl}`,
    }
  }
  throw new Error('Unsupported email notification type.')
}

const createInitialTemporaryPassword = () => {
  const password = crypto.randomBytes(18).toString('base64url')
  return { password, ciphertext: encryptSecret(password) }
}

const getInitialTemporaryPasswordForAdmin = async userId => {
  const { data, error } = await supabase.from('users')
    .select('initial_password_ciphertext,status,role,must_reset_password')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data || data.role !== 'student' || data.status !== 'approved' || !data.must_reset_password) {
    return { available: false, password: null }
  }
  if (!data.initial_password_ciphertext) return { available: false, password: null }
  return { available: true, password: decryptSecret(data.initial_password_ciphertext) }
}

const recordDeliveryFailure = async (notification, error) => {
  const retryCount = Number(notification.retry_count || 0) + 1
  const retryable = Boolean(error.retryable) && retryCount < MAX_RETRIES
  const delayMinutes = Math.min(60, 2 ** Math.min(retryCount, 6))
  const { error: updateError } = await supabase.from('email_notifications').update({
    status: error.uncertain ? 'unknown' : 'failed',
    safe_error: error.message || 'Email delivery failed.',
    retry_count: retryCount,
    last_attempt_at: new Date().toISOString(),
    next_attempt_at: retryable
      ? new Date(Date.now() + delayMinutes * 60_000).toISOString()
      : new Date('9999-12-31T23:59:59.999Z').toISOString(),
    locked_until: null,
    updated_at: new Date().toISOString(),
  }).eq('id', notification.id)
  if (updateError) throw updateError
}

const sendNotification = async id => {
  const { data: notification, error } = await supabase.from('email_notifications')
    .select('*').eq('id', id).maybeSingle()
  if (error) throw emailOperationError(error, 'outbox_read')
  if (!notification) return null
  if (['accepted', 'delivered'].includes(notification.status)) return notification
  if (notification.status === 'unknown') return notification
  if (notification.status === 'failed'
    && (Number(notification.retry_count || 0) >= MAX_RETRIES
      || new Date(notification.next_attempt_at).getTime() > Date.now())) return notification

  const now = new Date().toISOString()
  const claimedRetryCount = Number(notification.retry_count || 0) + 1
  const { data: claimed, error: claimError } = await supabase.from('email_notifications')
    .update({
      locked_until: new Date(Date.now() + 2 * 60_000).toISOString(),
      last_attempt_at: now,
      retry_count: claimedRetryCount,
      updated_at: now,
    })
    .eq('id', id)
    .in('status', ['pending', 'failed'])
    .or(`locked_until.is.null,locked_until.lt.${now}`)
    .select('*')
    .maybeSingle()
  if (claimError) throw emailOperationError(claimError, 'outbox_claim')
  if (!claimed) return notification

  if (!await notificationEnabled(claimed.notification_type)) {
    const { data: cancelled, error: cancelError } = await supabase.from('email_notifications').update({
      status: 'cancelled',
      safe_error: 'Delivery was disabled in administrator settings.',
      locked_until: null,
      updated_at: new Date().toISOString(),
    }).eq('id', id).select('*').single()
    if (cancelError) throw cancelError
    return cancelled
  }

  let message
  try {
    message = await templateFor(claimed)
  } catch (templateError) {
    const err = emailOperationError(templateError, 'notification_template_render')
    logEmailFailure(err.operation, err)
    await recordDeliveryFailure({ ...claimed, retry_count: Number(claimed.retry_count) - 1 }, err)
    return null
  }

  let result
  try {
    result = await sendEmail({
      to: [{ email: claimed.recipient_email, name: claimed.payload?.recipientName || undefined }],
      ...message,
    })
  } catch (deliveryError) {
    const err = emailOperationError(deliveryError, 'python_email_delivery')
    logEmailFailure(err.operation, err)
    await recordDeliveryFailure({ ...claimed, retry_count: Number(claimed.retry_count) - 1 }, err)
    return null
  }

  const { data: accepted, error: updateError } = await supabase.from('email_notifications').update({
    status: 'accepted',
    provider_message_id: result.messageId,
    safe_error: null,
    next_attempt_at: new Date('9999-12-31T23:59:59.999Z').toISOString(),
    locked_until: null,
    updated_at: new Date().toISOString(),
  }).eq('id', id).select('*').single()
  if (updateError) {
    const { error: unknownError } = await supabase.from('email_notifications').update({
      status: 'unknown',
      provider_message_id: result.messageId,
      safe_error: 'The SMTP server accepted this email, but CETNova could not record the acceptance. Do not retry automatically.',
      next_attempt_at: new Date('9999-12-31T23:59:59.999Z').toISOString(),
      locked_until: null,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (unknownError) {
      console.error(`[email] Provider accepted notification ${id}, but its status could not be recorded:`, unknownError.message)
      throw unknownError
    }
    return null
  }
  return accepted
}

const deliverQueuedNotification = async values => {
  let notification
  try {
    notification = await createNotification(values)
  } catch (error) {
    const err = emailOperationError(error, 'outbox_insert')
    logEmailFailure(err.operation, err)
    throw err
  }
  try {
    await sendNotification(notification.id)
  } catch (error) {
    const err = emailOperationError(error, 'notification_delivery_process')
    logEmailFailure(err.operation, err)
  }
  return notification.id
}

const getNotificationDeliveryState = async id => {
  const { data, error } = await supabase.from('email_notifications')
    .select('status,safe_error')
    .eq('id', id)
    .single()
  if (error) throw emailOperationError(error, 'outbox_status_read')
  return data
}

const sendSavedResultNotifications = async resultId => {
  const [enabled, parentEnabled] = await Promise.all([
    settingEnabled('transactional_result_emails_enabled', true),
    settingEnabled('parent_result_emails_enabled', false),
  ])
  if (!enabled && !parentEnabled) return

  const result = await db.getTestResultById(resultId)
  if (!result) throw new Error('Cannot notify about a test result that has not been saved.')
  const student = await db.findUserById(result.userId)
  if (!student || student.role !== 'student') return

  const total = Number(result.totalMarks) || 0
  const percentage = total > 0 ? (Number(result.score) / total) * 100 : 0
  const reportUrl = `${frontendUrl()}/results`
  const sharedPayload = {
    studentName: student.name || 'Student',
    testName: result.testName || 'MHT-CET Mock Test',
    result: {
      score: result.score,
      totalMarks: result.totalMarks,
      percentile: result.percentile,
      correct: result.correct,
      incorrect: result.incorrect,
      unanswered: result.unanswered,
      duration: result.duration,
      attemptedAt: result.attemptedAt,
    },
  }

  if (enabled && emailPattern.test(String(student.email || ''))) {
    await deliverQueuedNotification({
      type: 'exam_result',
      studentId: student.id || student._id,
      resultId,
      recipient: student.email,
      idempotencyKey: `exam-result:${resultId}:${String(student.email).toLowerCase()}`,
      payload: { ...sharedPayload, recipientName: student.name, reportUrl },
    })
  }

  const guardianEmail = String(student.guardianEmail || '').trim().toLowerCase()
  if (parentEnabled && student.parentResultEmailConsent === true && emailPattern.test(guardianEmail)) {
    await deliverQueuedNotification({
      type: 'parent_result',
      studentId: student.id || student._id,
      resultId,
      recipient: guardianEmail,
      idempotencyKey: `parent-result:${resultId}:${guardianEmail}`,
      payload: { ...sharedPayload, recipientName: student.name },
    })
  }
}

const createAccountSetupInvitation = async userId => {
  const now = new Date().toISOString()
  try {
    const { data: existing, error: lookupError } = await supabase.from('account_setup_tokens')
      .select('id,expires_at,token_ciphertext')
      .eq('user_id', userId)
      .is('used_at', null)
      .gt('expires_at', now)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lookupError) throw lookupError
    if (existing?.token_ciphertext) {
      let token
      try {
        token = decryptSecret(existing.token_ciphertext)
      } catch {
        throw new Error('The existing setup link cannot be decrypted. Restore the EMAIL_TOKEN_ENCRYPTION_KEY that was used to create it.')
      }
      return {
        token,
        tokenCiphertext: existing.token_ciphertext,
        id: existing.id,
        expiresAt: existing.expires_at,
      }
    }

    const rawToken = crypto.randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + SETUP_TOKEN_TTL_MS).toISOString()
    const tokenCiphertext = encryptSecret(rawToken)
    const { data, error } = await supabase.from('account_setup_tokens')
      .insert({
        user_id: userId,
        token_hash: hashToken(rawToken),
        token_ciphertext: tokenCiphertext,
        expires_at: expiresAt,
      })
      .select('id')
      .single()
    if (error) throw error

    const { error: revokeError } = await supabase.from('account_setup_tokens')
      .update({ used_at: now })
      .eq('user_id', userId)
      .is('used_at', null)
      .neq('id', data.id)
    if (revokeError) throw revokeError
    return { token: rawToken, tokenCiphertext, id: data.id, expiresAt }
  } catch (error) {
    throw emailOperationError(error, 'setup_token_persistence')
  }
}

const completeAccountSetup = async (token, passwordHash) => {
  const { data, error } = await supabase.rpc('complete_account_setup', {
    p_token_hash: hashToken(token),
    p_password_hash: passwordHash,
  })
  if (error) throw error
  return Array.isArray(data) ? data[0] || null : data || null
}

const sendStudentWelcome = async (user, invitation, { forceResend = false } = {}) => {
  try {
    let enabled
    try {
      enabled = await settingEnabled('student_welcome_emails_enabled', true)
    } catch (error) {
      throw emailOperationError(error, 'welcome_email_setting_read')
    }
    if (!enabled) return { status: 'disabled', notificationId: null, safe_error: null }
    const recipient = String(user.email || '').trim().toLowerCase()
    if (!emailPattern.test(recipient)) {
      return {
        status: 'skipped',
        notificationId: null,
        safe_error: 'The student does not have a valid email address.',
      }
    }
    const notificationId = await deliverQueuedNotification({
      type: 'student_welcome',
      studentId: user.id || user._id,
      recipient,
      idempotencyKey: forceResend
        ? `student-welcome-resend:${invitation.id}:${crypto.randomUUID()}`
        : `student-welcome:${invitation.id}`,
      payload: {
        studentName: user.name || 'Student',
        username: user.mhcetId || recipient,
        recipientName: user.name,
        setupTokenCiphertext: invitation.tokenCiphertext,
      },
    })
    return { notificationId, ...await getNotificationDeliveryState(notificationId) }
  } catch (error) {
    const err = emailOperationError(error, 'welcome_notification_enqueue')
    if (!err.emailDiagnosticLogged) logEmailFailure(err.operation, err)
    throw err
  }
}

const sendInitialTemporaryPassword = async (user, ciphertext) => {
  try {
    const enabled = await settingEnabled('student_welcome_emails_enabled', true)
    if (!enabled) return { status: 'disabled', notificationId: null, safe_error: null }
    const recipient = String(user.email || '').trim().toLowerCase()
    if (!emailPattern.test(recipient)) {
      return { status: 'skipped', notificationId: null, safe_error: 'The student does not have a valid email address.' }
    }
    const notificationId = await deliverQueuedNotification({
      type: 'student_welcome',
      studentId: user.id || user._id,
      recipient,
      idempotencyKey: `student-welcome-initial:${user.id || user._id}:${user.approvedAt || crypto.randomUUID()}`,
      payload: {
        studentName: user.name || 'Student',
        username: user.mhcetId || recipient,
        recipientName: user.name,
        initialPasswordCiphertext: ciphertext,
      },
    })
    return { notificationId, ...await getNotificationDeliveryState(notificationId) }
  } catch (error) {
    const err = emailOperationError(error, 'initial_password_email_enqueue')
    if (!err.emailDiagnosticLogged) logEmailFailure(err.operation, err)
    throw err
  }
}

const sendPasswordChangedNotification = async user => {
  const enabled = await settingEnabled('email_notifications', true)
  const recipient = String(user.email || '').trim().toLowerCase()
  if (!enabled || !emailPattern.test(recipient)) return null
  return deliverQueuedNotification({
    type: 'password_changed',
    studentId: user.id || user._id,
    recipient,
    idempotencyKey: `password-changed:${user.id || user._id}:${crypto.randomUUID()}`,
    payload: { studentName: user.name || 'Student', recipientName: user.name },
  })
}

const sendAdminTestEmail = async admin => {
  const recipient = String(admin.email || '').trim().toLowerCase()
  if (!emailPattern.test(recipient)) throw new Error('The authenticated administrator does not have a valid email address.')
  const notificationId = await deliverQueuedNotification({
    type: 'admin_test',
    recipient,
    idempotencyKey: `admin-test:${crypto.randomUUID()}`,
    payload: { adminName: admin.name || 'administrator', recipientName: admin.name },
  })
  const { data, error } = await supabase.from('email_notifications')
    .select('status,safe_error').eq('id', notificationId).single()
  if (error) throw error
  return { notificationId, ...data }
}

const validatePythonEmailService = async () => {
  try {
    return await validateEmailService()
  } catch (error) {
    const diagnostic = emailOperationError(error, 'python_email_service_validation')
    logEmailFailure('python_email_service_validation', diagnostic)
    throw diagnostic
  }
}

const sendRejectionEmail = async (user, reason) => {
  const recipient = String(user.email || '').trim().toLowerCase()
  if (!emailPattern.test(recipient)) throw new Error('The rejected applicant does not have a valid email address.')
  const safeName = String(user.name || 'Applicant').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]))
  const safeReason = String(reason || 'Application did not meet requirements')
    .replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]))
  const loginUrl = `${frontendUrl()}/login`
  await sendEmail({
    to: [{ email: recipient, name: user.name || undefined }],
    subject: 'CETNova application update',
    htmlContent: `<p>Hello ${safeName},</p><p>We are unable to approve your application at this time.</p><p><strong>Reason:</strong> ${safeReason}</p><p>If you believe this is an error, please contact your institution's support team.</p><p><a href="${loginUrl}">Visit CETNova</a></p>`,
    textContent: `Hello ${user.name || 'Applicant'},\n\nWe are unable to approve your application at this time.\nReason: ${reason || 'Application did not meet requirements'}\n\nIf you believe this is an error, please contact your institution's support team.\n${loginUrl}\n\nCETNova`,
  })
}

const retryNotification = async id => {
  const { data: notification, error } = await supabase.from('email_notifications')
    .select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!notification) return { notFound: true }
  if (notification.status !== 'failed') return { conflict: true, status: notification.status }
  if (Number(notification.retry_count) >= MAX_RETRIES) return { exhausted: true }
  const { error: updateError } = await supabase.from('email_notifications').update({
    status: 'pending',
    safe_error: null,
    next_attempt_at: new Date().toISOString(),
    locked_until: null,
    updated_at: new Date().toISOString(),
  }).eq('id', id).eq('status', 'failed')
  if (updateError) throw updateError
  await sendNotification(id)
  return { retried: true, ...await getNotificationDeliveryState(id) }
}

const runDueEmailNotifications = async () => {
  const now = new Date().toISOString()
  const { data, error } = await supabase.from('email_notifications')
    .select('id')
    .in('status', ['pending', 'failed'])
    .lte('next_attempt_at', now)
    .lt('retry_count', MAX_RETRIES)
    .or(`locked_until.is.null,locked_until.lt.${now}`)
    .order('created_at', { ascending: true })
    .limit(25)
  if (error) throw error
  for (const notification of data || []) {
    try {
      await sendNotification(notification.id)
    } catch (sendError) {
      console.error(`[email] Retry failed for notification ${notification.id}:`, sendError.message)
    }
  }
}

const getParentReport = async rawToken => {
  if (typeof rawToken !== 'string' || rawToken.length < 32 || rawToken.length > 128) return null
  const { data: notification, error } = await supabase.from('email_notifications')
    .select('status,student_id,test_result_id,payload,parent_report_expires_at')
    .eq('parent_report_token_hash', hashToken(rawToken))
    .maybeSingle()
  if (error) throw error
  if (!notification || !['accepted', 'delivered'].includes(notification.status) || !notification.parent_report_expires_at
    || new Date(notification.parent_report_expires_at).getTime() <= Date.now()) return null
  const result = notification.test_result_id ? await db.getTestResultById(notification.test_result_id) : null
  if (!result) return null
  return {
    studentName: notification.payload?.studentName || 'Student',
    testName: result.testName || 'MHT-CET Mock Test',
    score: result.score,
    totalMarks: result.totalMarks,
    percentage: result.percentile !== null && result.percentile !== undefined
      ? Number(result.percentile)
      : Number(result.totalMarks) > 0 ? (Number(result.score) / Number(result.totalMarks)) * 100 : 0,
    correct: result.correct,
    incorrect: result.incorrect,
    unanswered: result.unanswered,
    duration: result.duration,
    attemptedAt: result.attemptedAt,
  }
}

module.exports = {
  MAX_RETRIES,
  PARENT_REPORT_TTL_MS,
  SETUP_TOKEN_TTL_MS,
  createAccountSetupInvitation,
  completeAccountSetup,
  createInitialTemporaryPassword,
  getNotificationDeliveryState,
  getInitialTemporaryPasswordForAdmin,
  getEmailAdminInfo,
  getParentReport,
  hashToken,
  logEmailFailure,
  retryNotification,
  runDueEmailNotifications,
  sendAdminTestEmail,
  sendRejectionEmail,
  validatePythonEmailService,
  sendPasswordChangedNotification,
  sendSavedResultNotifications,
  sendStudentWelcome,
  sendInitialTemporaryPassword,
}
