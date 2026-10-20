const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const db = require('../services/dbService')
const { protect, adminOnly } = require('../middleware/auth')
const { apiLimiter, passwordResetLimiter } = require('../middleware/rateLimit')
const { validateCsrfToken } = require('../middleware/csrf')
const emailNotifications = require('../services/emailNotificationService')

// Generate the next MHT-CET ID from the highest assigned number, not total
// users, because IDs can remain after users are deleted.
const generateMhcetId = async () => {
  const year = new Date().getFullYear()
  const users = await db.getAllUsers()
  const prefix = `MHC-${year}-`
  const maxNumber = users.reduce((max, user) => {
    const match = String(user.mhcetId || '').match(new RegExp(`^${prefix}(\\d+)$`))
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  const num = String(maxNumber + 1).padStart(5, '0')
  return `MHC-${year}-${num}`
}

const isMhcetIdConflict = (error) => error?.code === '23505'
  && /users_mhcet_id_key|mhcet_id/i.test(String(error?.message || error?.details || ''))

const setupPreparationErrorMessage = error => {
  const message = String(error?.message || '')
  const code = String(error?.code || '')
  if (code === 'SETUP_TOKEN_KEY_MISMATCH') {
    return 'The existing setup link was encrypted with a different key. Restore the original key, or confirm issuing a new link to invalidate this unrecoverable link.'
  }
  if (/EMAIL_TOKEN_ENCRYPTION_KEY/.test(message)) {
    return 'Account setup encryption is not configured. Set EMAIL_TOKEN_ENCRYPTION_KEY (32+ characters) on both the API and scheduler services.'
  }
  if (/cannot be decrypted/i.test(message)) {
    return 'The existing setup link cannot be decrypted. Restore the original EMAIL_TOKEN_ENCRYPTION_KEY on the API and scheduler services.'
  }
  if (/account_setup_tokens|token_ciphertext|schema cache/i.test(message) || ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code)) {
    return 'The Supabase account-setup schema is missing or out of date. Apply the email-notification and account-setup migrations.'
  }
  return 'Account setup could not be prepared. Check the API logs for the setup-token operation and database error code.'
}

const approveStudent = async (user) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const mhcetId = await generateMhcetId()
    try {
      const { password: temporaryPassword, ciphertext } = emailNotifications.createInitialTemporaryPassword()
      const approvedUser = await db.updateUser(user.id, {
        status: 'approved',
        mhcetId,
        password: await bcrypt.hash(temporaryPassword, 12),
        mhcetPassword: null,
        mustResetPassword: true,
        initialPasswordCiphertext: ciphertext,
        approvedAt: new Date().toISOString(),
      })
      return { user: approvedUser, mhcetId, initialPasswordCiphertext: ciphertext }
    } catch (error) {
      if (!isMhcetIdConflict(error) || attempt === 4) throw error
    }
  }

  throw new Error('Unable to assign a unique MHT-CET ID.')
}

// GET /api/users/me — Profile of logged in user
router.get('/me', protect, apiLimiter, (req, res) => {
  const user = { ...req.user }
  delete user.password
  delete user.mhcetPassword
  res.json(user)
})

// PUT /api/users/profile — Update user profile
router.put('/profile', protect, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    const { name, email, phone, branch, batch, examType, guardianEmail, parentResultEmailConsent } = req.body
    const userId = req.user.id || req.user._id

    const user = await db.findUserById(userId)
    if (!user) return res.status(404).json({ success: false, message: 'User not found' })

    const updates = {}

    if (email && email.toLowerCase() !== user.email.toLowerCase()) {
      const cleanEmail = email.toLowerCase().trim()
      const emailUser = await db.findUserByEmail(cleanEmail)
      if (emailUser && emailUser.id !== user.id) {
        return res.status(400).json({ success: false, message: 'Email already in use' })
      }
      updates.email = cleanEmail
    }

    if (phone && phone !== user.phone) {
      const cleanPhone = String(phone).trim()
      const allUsers = await db.getAllUsers()
      const phoneUser = allUsers.find((u) => u.phone === cleanPhone && u.id !== user.id)
      if (phoneUser) return res.status(400).json({ success: false, message: 'Phone number already in use' })
      updates.phone = cleanPhone
    }

    if (name) updates.name = String(name).trim().slice(0, 100)
    if (branch && ['Byculla', 'Worli', 'Prabhadevi'].includes(branch)) updates.branch = branch
    if (batch) updates.batch = Number(batch)
    if (examType !== undefined) {
      if (examType !== null && !['PCM', 'PCB', 'PCMB'].includes(examType)) {
        return res.status(400).json({ success: false, message: 'Exam category must be PCM, PCB, or PCMB.' })
      }
      updates.examType = examType
    }
    if (guardianEmail !== undefined) {
      const cleanGuardianEmail = String(guardianEmail || '').trim().toLowerCase()
      if (cleanGuardianEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanGuardianEmail)) {
        return res.status(400).json({ success: false, message: 'Enter a valid parent or guardian email address.' })
      }
      updates.guardianEmail = cleanGuardianEmail || null
    }
    if (parentResultEmailConsent !== undefined) {
      if (typeof parentResultEmailConsent !== 'boolean') {
        return res.status(400).json({ success: false, message: 'Parent email consent must be true or false.' })
      }
      updates.parentResultEmailConsent = parentResultEmailConsent
    }
    if (updates.parentResultEmailConsent === true && !(updates.guardianEmail || user.guardianEmail)) {
      return res.status(400).json({ success: false, message: 'Add a parent or guardian email before enabling parent result emails.' })
    }

    const updatedUser = await db.updateUser(user.id, updates)
    delete updatedUser.password
    delete updatedUser.mhcetPassword

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: updatedUser,
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// GET /api/users — ADMIN ONLY: list students
router.get('/', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    const { status, page, pageSize, search, branch, batch } = req.query
    const isPaged = page !== undefined || pageSize !== undefined || search !== undefined || branch !== undefined || batch !== undefined
    if (isPaged) {
      const parsedPage = Number(page || 1)
      const parsedPageSize = Number(pageSize || 50)
      if (!Number.isInteger(parsedPage) || parsedPage < 1
        || !Number.isInteger(parsedPageSize) || parsedPageSize < 1 || parsedPageSize > 100) {
        return res.status(400).json({ success: false, message: 'Page must be positive and pageSize must be between 1 and 100.' })
      }
      if (status && !['pending', 'approved', 'rejected'].includes(String(status))) {
        return res.status(400).json({ success: false, message: 'Unsupported student status filter.' })
      }
      if (branch && branch !== 'All' && !['Byculla', 'Worli', 'Prabhadevi'].includes(String(branch))) {
        return res.status(400).json({ success: false, message: 'Unsupported student branch filter.' })
      }
      if (batch && batch !== 'All' && (!/^\d{4}$/.test(String(batch)) || Number(batch) < 2000 || Number(batch) > 2100)) {
        return res.status(400).json({ success: false, message: 'Unsupported student batch filter.' })
      }

      const result = await db.getUsersPage({
        status: typeof status === 'string' ? status : undefined,
        search: typeof search === 'string' ? search : undefined,
        branch: typeof branch === 'string' && branch !== 'All' ? branch : undefined,
        batch: typeof batch === 'string' && batch !== 'All' ? Number(batch) : undefined,
        limit: parsedPageSize,
        offset: (parsedPage - 1) * parsedPageSize,
      })
      const sanitizedUsers = result.users.map(user => {
        const userObj = { ...user, _id: user.id }
        delete userObj.password
        delete userObj.mhcetPassword
        return userObj
      })
      res.set('Cache-Control', 'private, no-store')
      return res.json({ users: sanitizedUsers, total: result.total, page: parsedPage, pageSize: parsedPageSize })
    }

    const filter = { role: 'student' }
    if (status) filter.status = status
    const users = await db.getAllUsers(filter)
    const sanitizedUsers = users.map((u) => {
      const userObj = { ...u, _id: u.id }
      delete userObj.password
      delete userObj.mhcetPassword
      return userObj
    })
    res.json(sanitizedUsers)
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// GET /api/users/:id/report — ADMIN ONLY: one student's report data
router.get('/:id/report', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    const { from, to } = req.query
    const parseDate = (value, endOfDay) => {
      if (!value) return null
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN
      const timestamp = Date.parse(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
      if (!Number.isFinite(timestamp)) return NaN
      return new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : NaN
    }
    const fromTime = parseDate(from, false)
    const toTime = parseDate(to, true)
    if ((from && !Number.isFinite(fromTime)) || (to && !Number.isFinite(toTime)) || (fromTime !== null && toTime !== null && fromTime > toTime)) {
      return res.status(400).json({ success: false, message: 'Select a valid report date range.' })
    }

    const student = await db.findUserById(req.params.id)
    if (!student || student.role !== 'student') {
      return res.status(404).json({ success: false, message: 'Student not found.' })
    }
    const inRange = value => {
      const time = Date.parse(value || '')
      return Number.isFinite(time) && (fromTime === null || time >= fromTime) && (toTime === null || time <= toTime)
    }

    const [allResults, allAssignments] = await Promise.all([
      db.getTestResultsByUserId(student.id),
      db.getMockTestAssignments(),
    ])
    const results = allResults.filter(result => inRange(result.attemptedAt))
    const assignments = allAssignments.filter(assignment => {
      if (assignment.status !== 'active' || assignment.visibility === 'draft' || !Array.isArray(assignment.studentIds) || !assignment.studentIds.includes(String(student.id))) return false
      const startsAt = Date.parse(assignment.startDateTime)
      const endsAt = Date.parse(assignment.endDateTime)
      return (fromTime === null || endsAt >= fromTime) && (toTime === null || startsAt <= toTime)
    })

    const attemptsByAssignment = await Promise.all(assignments.map(assignment => db.getMockTestAttempts(assignment._id, student.id)))
    const attempts = attemptsByAssignment.flat()
      .filter(attempt => inRange(attempt.startedAt))
      .map(attempt => ({
        id: attempt._id,
        assignmentId: attempt.assignmentId,
        testName: assignments.find(assignment => assignment._id === attempt.assignmentId)?.mockTestName || 'Assigned Mock Test',
        status: attempt.status,
        attemptNumber: attempt.attemptNumber,
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt,
        score: attempt.score,
        totalMarks: attempt.totalMarks,
        resultId: attempt.resultId || null,
      }))

    const questionIds = [...new Set(results.flatMap(result => result.questionIds || []).map(String))]
    const questions = questionIds.length
      ? await db.getQuestions({ ids: questionIds }, { isAdmin: true })
      : []
    const questionsById = new Map(questions.map(question => [String(question._id), question]))
    const safeResults = results.map(result => {
      const subjectQuestionStats = new Map()
      for (const questionId of result.questionIds || []) {
        const question = questionsById.get(String(questionId))
        if (!question) continue
        const subject = question.subject || 'General'
        const stats = subjectQuestionStats.get(subject) || { totalQuestions: 0, correct: 0, incorrect: 0, unattempted: 0 }
        stats.totalQuestions += 1
        const selected = result.answers?.[String(questionId)]
        if (selected === undefined || selected === null) stats.unattempted += 1
        else if (Number(selected) === Number(question.correctIndex)) stats.correct += 1
        else stats.incorrect += 1
        subjectQuestionStats.set(subject, stats)
      }
      return {
        id: result._id,
        testName: result.testName,
        subject: result.subject,
        mockTestId: result.mockTestId || null,
        mockTestAttemptId: result.mockTestAttemptId || null,
        attemptedAt: result.attemptedAt,
        score: Number(result.score) || 0,
        totalMarks: Number(result.totalMarks) || 0,
        percentile: Number.isFinite(Number(result.percentile)) ? Number(result.percentile) : null,
        duration: Number(result.duration) || 0,
        correct: Number(result.correct) || 0,
        incorrect: Number(result.incorrect) || 0,
        unanswered: Number(result.unanswered) || 0,
        totalQuestions: Number(result.totalQuestions) || 0,
        subjectWiseScores: Array.isArray(result.subjectWiseScores) ? result.subjectWiseScores : [],
        subjectQuestionStats: Object.fromEntries(subjectQuestionStats),
      }
    })

    const safeStudent = { ...student }
    delete safeStudent.password
    delete safeStudent.mhcetPassword
    res.set('Cache-Control', 'private, no-store')
    return res.json({
      success: true,
      student: { ...safeStudent, _id: safeStudent.id },
      results: safeResults,
      assignments: assignments.map(assignment => ({
        id: assignment._id,
        testName: assignment.mockTestName,
        startDateTime: assignment.startDateTime,
        endDateTime: assignment.endDateTime,
        status: assignment.status,
        visibility: assignment.visibility,
      })),
      attempts,
      reportPeriod: { from: from || null, to: to || null },
    })
  } catch (err) {
    console.error('Failed to generate student report data:', err)
    return res.status(500).json({ success: false, message: 'Could not load student report data.' })
  }
})

router.get('/:id/temporary-password/status', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    const user = await db.findUserById(req.params.id)
    if (!user || user.role !== 'student') return res.status(404).json({ success: false, message: 'Student not found.' })
    res.set('Cache-Control', 'no-store')
    return res.json({
      available: user.status === 'approved' && user.mustResetPassword === true && user.initialPasswordAvailable === true,
    })
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Could not check temporary password availability.' })
  }
})

router.get('/:id/temporary-password', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    const user = await db.findUserById(req.params.id)
    if (!user || user.role !== 'student') return res.status(404).json({ success: false, message: 'Student not found.' })
    const credential = await emailNotifications.getInitialTemporaryPasswordForAdmin(user.id || user._id)
    res.set('Cache-Control', 'no-store')
    if (!credential.available) return res.json({ available: false, password: null })
    return res.json(credential)
  } catch (err) {
    console.error('[auth] Could not reveal initial temporary password:', err.message)
    return res.status(500).json({ success: false, message: 'Could not retrieve the temporary password.' })
  }
})

router.post('/:id/temporary-password/reset', protect, adminOnly, validateCsrfToken, passwordResetLimiter, async (req, res) => {
  if (req.body?.confirm !== true) {
    return res.status(400).json({ success: false, message: 'Explicit confirmation is required to reset this student’s password.' })
  }

  try {
    const user = await db.findUserById(req.params.id)
    if (!user || user.role !== 'student') {
      return res.status(404).json({ success: false, message: 'Student not found.' })
    }
    if (user.status !== 'approved' || !user.mhcetId) {
      return res.status(400).json({ success: false, message: 'Only an approved student with an assigned CET ID can receive a temporary password.' })
    }

    const { password, ciphertext } = emailNotifications.createInitialTemporaryPassword()
    const updatedUser = await db.updateUser(user.id || user._id, {
      password: await bcrypt.hash(password, 12),
      mhcetPassword: null,
      mustResetPassword: true,
      initialPasswordCiphertext: ciphertext,
    })

    res.set('Cache-Control', 'no-store')
    let emailStatus = 'failed'
    try {
      const delivery = await emailNotifications.sendInitialTemporaryPassword(updatedUser, ciphertext, {
        idempotencyKey: `student-welcome-reset:${user.id || user._id}:${crypto.randomUUID()}`,
      })
      emailStatus = delivery.status
    } catch (emailError) {
      if (!emailError.emailDiagnosticLogged) {
        emailNotifications.logEmailFailure(emailError.operation || 'initial_password_email_enqueue', emailError)
      }
    }

    const emailMessages = {
      accepted: 'SMTP accepted the email; final mailbox delivery is not confirmed.',
      delivered: 'The email is marked delivered.',
      pending: 'The welcome email is queued for delivery.',
      disabled: 'Student welcome emails are disabled; share the temporary password with the student securely.',
      skipped: 'No email was sent; check the student’s email address and share the temporary password securely.',
      failed: 'The password was reset, but the email could not be sent. Share the temporary password with the student securely.',
      unknown: 'Email delivery could not be confirmed. Check the notification log before retrying.',
      cancelled: 'The email was not sent. Share the temporary password with the student securely.',
    }

    return res.json({
      success: true,
      available: true,
      password,
      emailStatus,
      message: `A new temporary password is active. ${emailMessages[emailStatus] || 'Review the email notification status.'}`,
    })
  } catch (err) {
    console.error('[auth] Could not reset student temporary password:', err.message)
    return res.status(500).json({ success: false, message: 'Could not reset the student’s temporary password.' })
  }
})

// POST /api/users/reset-password — Student resets password
router.post('/reset-password', protect, validateCsrfToken, passwordResetLimiter, async (req, res) => {
  try {
    const { newPassword } = req.body
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' })
    }

    const userId = req.user.id || req.user._id
    const user = await db.findUserById(userId)
    if (!user) return res.status(404).json({ success: false, message: 'User not found' })

    const hashedPassword = await bcrypt.hash(String(newPassword), 10)
    const updatedUser = await db.updateUser(userId, {
      password: hashedPassword,
      mhcetPassword: null,
      mustResetPassword: false,
      initialPasswordCiphertext: null,
    })

    delete updatedUser.password
    delete updatedUser.mhcetPassword
    try {
      await emailNotifications.sendPasswordChangedNotification(updatedUser)
    } catch (emailError) {
      console.error('[email] Could not queue password-change notification:', emailError.message)
    }

    res.json({
      success: true,
      message: 'Password reset successful',
      user: updatedUser,
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// GET /api/users/stats — ADMIN ONLY: dashboard stats
router.get('/stats', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    const stats = await db.getStudentRegistrationStats()
    res.set('Cache-Control', 'private, no-store')
    res.json({ ...stats, total: stats.pending + stats.approved + stats.rejected })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// POST /api/users/:id/approve — ADMIN ONLY: approve student
router.post('/:id/approve', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    const user = await db.findUserById(req.params.id)
    if (!user) return res.status(404).json({ success: false, message: 'User not found' })
    if (user.status === 'approved') return res.status(400).json({ success: false, message: 'Already approved' })

    const { user: updatedUser, mhcetId, initialPasswordCiphertext } = await approveStudent(user)

    const sanitizedUser = { ...updatedUser }
    delete sanitizedUser.password
    delete sanitizedUser.mhcetPassword

    let emailWarning = ''
    try {
      const delivery = await emailNotifications.sendInitialTemporaryPassword(updatedUser, initialPasswordCiphertext)
      if (['failed', 'unknown', 'skipped', 'cancelled', 'disabled'].includes(delivery.status)) {
        emailWarning = ` The account is approved, but the temporary password email status is ${delivery.status}. Use Resend setup email or check the email notification log.`
      }
    } catch (emailErr) {
      if (!emailErr.emailDiagnosticLogged) emailNotifications.logEmailFailure(emailErr.operation || 'student_welcome_enqueue', emailErr)
      emailWarning = ' The account is approved, but the temporary password email could not be queued. Use the resend setup email action if needed.'
    }

    res.json({
      success: true,
      message: `Student approved. MHT-CET ID: ${mhcetId}${emailWarning}`,
      mhcetId,
      user: sanitizedUser,
    })
  } catch (err) {
    if (err.operation && !err.emailDiagnosticLogged) emailNotifications.logEmailFailure(err.operation, err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// POST /api/users/:id/resend-credentials — ADMIN ONLY: issue new credentials & email
router.post('/:id/resend-credentials', protect, adminOnly, validateCsrfToken, async (req, res) => {
  try {
    const user = await db.findUserById(req.params.id)
    if (!user) return res.status(404).json({ success: false, message: 'User not found' })
    if (user.status !== 'approved' || !user.mhcetId) {
      return res.status(400).json({ success: false, message: 'User is not approved yet' })
    }

    const invitation = await emailNotifications.createAccountSetupInvitation(user.id, {
      resetUnrecoverableToken: req.body?.resetUnrecoverableToken === true,
    })
    try {
      const delivery = await emailNotifications.sendStudentWelcome(user, invitation, { forceResend: true })
      const statusMessages = {
        accepted: `The SMTP server accepted the password setup email for ${user.email}. Final mailbox delivery is not confirmed; ask the student to check spam/junk if it does not arrive.`,
        delivered: `The password setup email for ${user.email} was marked delivered.`,
        pending: `The password setup email for ${user.email} is queued and awaiting delivery.`,
        failed: `The SMTP server could not send the password setup email. ${delivery.safe_error || 'Review the email notification log before retrying.'}`,
        unknown: `The SMTP server may have accepted the email, but CETNova could not confirm the result. ${delivery.safe_error || 'Check the recipient mailbox before retrying to avoid duplicates.'}`,
        cancelled: 'The password setup email was not sent because welcome emails are disabled in administrator settings.',
        disabled: 'Student welcome emails are disabled in administrator settings.',
        skipped: delivery.safe_error || 'The student does not have a valid email address.',
      }
      const success = ['accepted', 'delivered', 'pending', 'disabled'].includes(delivery.status)
      const statusCode = delivery.status === 'failed' ? 503
        : delivery.status === 'unknown' ? 502
          : delivery.status === 'skipped' || delivery.status === 'cancelled' ? 400
            : delivery.status === 'pending' ? 202 : 200
      res.status(statusCode).json({
        success,
        status: delivery.status,
        notificationId: delivery.notificationId,
        message: statusMessages[delivery.status] || 'Email delivery status is unavailable. Review the administrator notification log.',
      })
    } catch (emailErr) {
      if (!emailErr.emailDiagnosticLogged) emailNotifications.logEmailFailure(emailErr.operation || 'student_welcome_enqueue', emailErr)
      res.status(503).json({ success: false, message: 'The account setup link was created, but its email could not be queued. Please retry.' })
    }
  } catch (err) {
    if (err.operation && !err.emailDiagnosticLogged) emailNotifications.logEmailFailure(err.operation, err)
    if (err.code === 'SETUP_TOKEN_KEY_MISMATCH') {
      return res.status(409).json({
        success: false,
        code: err.code,
        message: setupPreparationErrorMessage(err),
      })
    }
    res.status(500).json({
      success: false,
      message: setupPreparationErrorMessage(err),
      ...(err.code ? { code: String(err.code).slice(0, 40) } : {}),
    })
  }
})

// POST /api/users/:id/reject — ADMIN ONLY: reject student
router.post('/:id/reject', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    const { reason } = req.body
    const user = await db.findUserById(req.params.id)
    if (!user) return res.status(404).json({ success: false, message: 'User not found' })

    const rejectionReason = reason || 'Application did not meet requirements'

    try {
      await emailNotifications.sendRejectionEmail(user, rejectionReason)
    } catch (emailErr) {
      console.warn('[email] Rejection notification failed:', emailErr.message)
    }

    await db.deleteUser(req.params.id)

    res.json({ success: true, message: 'Student rejected and removed.' })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// POST /api/users/bulk-approve — ADMIN ONLY: approve multiple students
router.post('/bulk-approve', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    const { ids } = req.body
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'No student IDs provided' })
    }

    const results = []
    let emailFailures = 0
    for (const id of ids) {
      try {
        const user = await db.findUserById(id)
        if (!user || user.status === 'approved') continue

        const { user: updatedUser, initialPasswordCiphertext } = await approveStudent(user)

        const sanitized = { ...updatedUser }
        delete sanitized.password
        delete sanitized.mhcetPassword

        try {
          const delivery = await emailNotifications.sendInitialTemporaryPassword(updatedUser, initialPasswordCiphertext)
          if (!['accepted', 'delivered', 'pending'].includes(delivery.status)) emailFailures += 1
        } catch (emailError) {
          emailFailures += 1
          if (!emailError.emailDiagnosticLogged) emailNotifications.logEmailFailure(emailError.operation || 'bulk_student_welcome_enqueue', emailError)
        }

        results.push(sanitized)
      } catch (innerErr) {
        console.error(`Error approving user ${id}:`, innerErr.message)
      }
    }

    res.json({
      success: true,
      count: results.length,
      message: `Successfully approved ${results.length} student(s).${emailFailures ? ` ${emailFailures} temporary password email(s) were not confirmed; check the email notification log.` : ''}`,
      users: results,
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// POST /api/users/bulk-reject — ADMIN ONLY: reject multiple students
router.post('/bulk-reject', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    const { ids, reason } = req.body
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'No student IDs provided' })
    }

    let count = 0
    for (const id of ids) {
      try {
        const user = await db.findUserById(id)
        if (!user) continue

        try {
          await emailNotifications.sendRejectionEmail(
            user,
            reason || 'Application did not meet requirements',
          )
        } catch (emailErr) {
          console.warn('[email] Bulk rejection notification failed:', emailErr.message)
        }

        await db.deleteUser(id)
        count++
      } catch (innerErr) {
        console.error(`Error rejecting user ${id}:`, innerErr.message)
      }
    }

    res.json({
      success: true,
      count,
      message: `Successfully rejected ${count} applicant(s).`,
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// GET /api/users/export — ADMIN ONLY: Export students to Excel (.xlsx) batch-wise
router.get('/export', protect, adminOnly, async (req, res) => {
  try {
    const XLSX = require('xlsx')
    const { batch, status } = req.query
    const filter = { role: 'student' }
    if (status && status !== 'All') filter.status = status
    if (batch && batch !== 'All') filter.batch = Number(batch)

    const students = await db.getAllUsers(filter)

    const formatRow = (s) => ({
      'Name of the student': s.name || '',
      'Email ID': s.email || '',
      'Student Unique No.': s.mhcetId || s.id || 'Pending',
      'Username': s.mhcetId || s.email || '',
      'Batch': s.batch ? `Batch ${s.batch}` : 'N/A',
      'Branch': s.branch || 'N/A',
      'Phone Number': s.phone || 'N/A',
      'Status': s.status ? (s.status.charAt(0).toUpperCase() + s.status.slice(1)) : 'Pending',
      'Registered Date': s.createdAt ? new Date(s.createdAt).toLocaleDateString('en-IN') : 'N/A',
    })

    const wb = XLSX.utils.book_new()
    const rows = students.map(formatRow)
    const wsAll = XLSX.utils.json_to_sheet(rows)

    const colWidths = [
      { wch: 25 }, // Name
      { wch: 28 }, // Email
      { wch: 20 }, // Student Unique No.
      { wch: 20 }, // Username
      { wch: 14 }, // Batch
      { wch: 16 }, // Branch
      { wch: 16 }, // Phone
      { wch: 14 }, // Status
      { wch: 16 }, // Date
    ]
    wsAll['!cols'] = colWidths
    XLSX.utils.book_append_sheet(wb, wsAll, 'All Students')

    // Add separate tabs for each batch
    const distinctBatches = [...new Set(students.map((s) => s.batch).filter(Boolean))].sort()
    distinctBatches.forEach((b) => {
      const batchStudents = students.filter((s) => s.batch === b)
      if (batchStudents.length > 0) {
        const wsBatch = XLSX.utils.json_to_sheet(batchStudents.map(formatRow))
        wsBatch['!cols'] = colWidths
        XLSX.utils.book_append_sheet(wb, wsBatch, `Batch ${b}`)
      }
    })

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const filename = `Students_Export_${batch ? `Batch_${batch}` : 'All_Batches'}_${new Date().toISOString().slice(0, 10)}.xlsx`

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.send(buffer)
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// PUT /api/users/:id — ADMIN ONLY: update any student details
router.put('/:id', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    const { name, email, phone, branch, batch, status } = req.body
    const user = await db.findUserById(req.params.id)
    if (!user) return res.status(404).json({ success: false, message: 'User not found' })

    const updates = {}
    if (name) updates.name = String(name).trim().slice(0, 100)
    if (email) updates.email = String(email).trim().toLowerCase()
    if (phone) updates.phone = String(phone).trim()
    if (branch) updates.branch = branch
    if (batch) updates.batch = Number(batch)
    if (status) updates.status = status

    const updatedUser = await db.updateUser(req.params.id, updates)
    delete updatedUser.password
    delete updatedUser.mhcetPassword

    res.json({
      success: true,
      message: 'Student updated successfully',
      user: updatedUser,
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// DELETE /api/users/:id — ADMIN ONLY: delete student
router.delete('/:id', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    const user = await db.findUserById(req.params.id)
    if (!user) return res.status(404).json({ success: false, message: 'User not found' })

    await db.deleteUser(req.params.id)
    res.json({ success: true, message: 'User deleted' })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router