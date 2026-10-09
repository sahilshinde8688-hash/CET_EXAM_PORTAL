const express = require('express')
const db = require('../services/dbService')
const { protect, adminOnly } = require('../middleware/auth')
const { apiLimiter } = require('../middleware/rateLimit')
const { validateCsrfToken } = require('../middleware/csrf')
const { evaluateAndSaveMockTestAttempt } = require('../services/mockTestEvaluation')
const { getMockTestScheduleState } = require('../utils/mockTestSchedule')

const adminRouter = express.Router()
const studentRouter = express.Router()
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const branches = new Set(['Byculla', 'Worli', 'Prabhadevi'])
const examTypes = new Set(['PCM', 'PCB', 'PCMB'])
const visibilities = new Set(['scheduled', 'available', 'draft'])
const resultVisibilities = new Set(['immediate', 'after_close', 'admin_only', 'hidden'])

const currentAssignmentScheduleStatus = assignment => {
  if (assignment.status !== 'active' || assignment.schedulingStatus === 'cancelled') return 'cancelled'
  if (assignment.visibility === 'draft') return 'draft'
  return getMockTestScheduleState(assignment.startDateTime, assignment.endDateTime)
}

const safeError = (res, status, message, error) =>
  res.status(status).json({ success: false, message, error: error || message })

const normalizeRequest = (body, test) => {
  const startsAt = new Date(body.startDateTime)
  const endsAt = new Date(body.endDateTime)
  const timeZone = typeof body.timeZone === 'string' && body.timeZone.trim()
    ? body.timeZone.trim()
    : 'Asia/Kolkata'
  const attemptLimit = body.attemptLimit === null || body.attemptLimit === 'unlimited'
    ? null
    : Number(body.attemptLimit)
  const duration = Number(test.duration)

  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) {
    throw Object.assign(new Error('Enter valid start and end dates.'), { status: 400 })
  }
  if (startsAt >= endsAt) throw Object.assign(new Error('Expiry date and time must be later than the start date and time.'), { status: 400 })
  if (endsAt.getTime() <= Date.now()) throw Object.assign(new Error('The expiry date and time must be in the future.'), { status: 400 })
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
  } catch {
    throw Object.assign(new Error('Select a valid time zone.'), { status: 400 })
  }
  if (!Number.isInteger(duration) || duration <= 0) throw Object.assign(new Error('The mock test duration is invalid.'), { status: 400 })
  if (attemptLimit !== null && (!Number.isInteger(attemptLimit) || attemptLimit < 1)) {
    throw Object.assign(new Error('Attempt limit must be a positive number or unlimited.'), { status: 400 })
  }
  if (!visibilities.has(body.visibility)) throw Object.assign(new Error('Select a valid test visibility.'), { status: 400 })
  if (!resultVisibilities.has(body.resultVisibility)) throw Object.assign(new Error('Select a valid result visibility.'), { status: 400 })

  return {
    startDateTime: startsAt.toISOString(),
    endDateTime: endsAt.toISOString(),
    timeZone,
    duration,
    attemptLimit,
    visibility: body.visibility,
    resultVisibility: body.resultVisibility,
    randomizeQuestions: Boolean(body.randomizeQuestions),
    randomizeOptions: Boolean(body.randomizeOptions),
    allowBackNavigation: Boolean(body.allowBackNavigation),
    allowResume: Boolean(body.allowResume),
  }
}

const resolveStudents = async (body) => {
  const allStudents = await db.getApprovedStudentsForAssignment()
  let students
  if (body.assignedTo === 'all') {
    students = allStudents
  } else if (body.assignedTo === 'students') {
    if (!Array.isArray(body.studentIds) || body.studentIds.length === 0) {
      throw Object.assign(new Error('Select at least one student.'), { status: 400 })
    }
    if (body.studentIds.some(id => typeof id !== 'string' || !UUID_RE.test(id))) {
      throw Object.assign(new Error('One or more selected student IDs are invalid.'), { status: 400 })
    }
    const ids = new Set(body.studentIds.map(id => id.toLowerCase()))
    students = allStudents.filter(student => ids.has(String(student.id || student._id)))
    if (students.length !== ids.size) throw Object.assign(new Error('One or more selected students are unavailable.'), { status: 400 })
  } else if (body.assignedTo === 'batch') {
    const batchId = Number(body.batchId)
    if (!Number.isInteger(batchId)) throw Object.assign(new Error('Select a valid batch.'), { status: 400 })
    students = allStudents.filter(student => Number(student.batch) === batchId)
  } else if (body.assignedTo === 'branch') {
    if (!branches.has(body.branch)) throw Object.assign(new Error('Select a valid branch.'), { status: 400 })
    students = allStudents.filter(student => student.branch === body.branch)
  } else if (body.assignedTo === 'examType') {
    if (!examTypes.has(body.examType)) throw Object.assign(new Error('Select a valid exam category.'), { status: 400 })
    students = allStudents.filter(student => student.examType === body.examType)
  } else {
    throw Object.assign(new Error('Select a valid student group.'), { status: 400 })
  }

  if (!students.length) throw Object.assign(new Error('No approved students match the selected group.'), { status: 400 })
  return students.map(student => String(student.id || student._id))
}

const validateTestQuestions = async (test) => {
  if (!Array.isArray(test.questionIds) || test.questionIds.length === 0) {
    throw Object.assign(new Error('This mock test does not contain saved questions.'), { status: 400 })
  }
  if (test.questionIds.some(id => typeof id !== 'string' || !UUID_RE.test(id))) {
    throw Object.assign(new Error('This mock test contains an invalid question ID.'), { status: 400 })
  }
  if (!Number.isInteger(Number(test.questions)) || Number(test.questions) <= 0) {
    throw Object.assign(new Error('The mock test question count is invalid.'), { status: 400 })
  }
  const questions = await db.getQuestions({ ids: test.questionIds, isActive: true }, { isAdmin: true })
  const questionsById = new Map(questions.map(question => [String(question._id), question]))
  if (questionsById.size !== test.questionIds.length) {
    throw Object.assign(new Error('One or more mock-test questions are missing or inactive.'), { status: 400 })
  }
  let totalMarks = 0
  for (const id of test.questionIds) {
    const question = questionsById.get(String(id))
    const marks = Number(question.marks)
    if (!Array.isArray(question.options) || question.options.length < 2
      || !Number.isInteger(Number(question.correctIndex))
      || Number(question.correctIndex) < 0
      || Number(question.correctIndex) >= question.options.length
      || !Number.isFinite(marks) || marks <= 0) {
      throw Object.assign(new Error(`Question ${id} has invalid answer options or marks.`), { status: 400 })
    }
    totalMarks += marks
  }
  if (!Number.isFinite(totalMarks) || totalMarks <= 0) {
    throw Object.assign(new Error('The mock test must have valid marks.'), { status: 400 })
  }
  return { questions, totalMarks }
}

const prepareAssignment = async (body, existing) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Assignment details are required.'), { status: 400 })
  }
  const mockTestId = existing?.mockTestId || body.mockTestId
  if (typeof mockTestId !== 'string' || !UUID_RE.test(mockTestId)) {
    throw Object.assign(new Error('Select a valid mock test.'), { status: 400 })
  }
  const test = await db.getMockTestById(mockTestId)
  if (!test) throw Object.assign(new Error('Mock test not found.'), { status: 404 })
  await validateTestQuestions(test)
  const settings = normalizeRequest(body, test)
  const assignedTo = body.assignedTo
  const studentIds = await resolveStudents(body)
  return {
    ...settings,
    mockTestId,
    mockTestName: test.title,
    assignedTo,
    studentIds,
    batchId: assignedTo === 'batch' ? Number(body.batchId) : null,
    branch: assignedTo === 'branch' ? body.branch : null,
    examType: assignedTo === 'examType' ? body.examType : (test.examType || null),
    subject: test.subject,
    questionCount: test.questionIds.length,
  }
}

adminRouter.use(protect, adminOnly)

adminRouter.post('/assign', validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    const payload = await prepareAssignment(req.body)
    const existingAssignments = await db.getMockTestAssignments()
    const overlaps = existingAssignments.some(assignment =>
      assignment.status === 'active'
      && assignment.mockTestId === payload.mockTestId
      && assignment.studentIds.some(id => payload.studentIds.includes(id)))
    if (overlaps && req.body.allowDuplicateAssignment !== true) {
      return safeError(res, 409, 'This mock test is already assigned to one or more selected students.', 'Set allowDuplicateAssignment to true only when a deliberate repeat assignment is required.')
    }
    const assignment = await db.createMockTestAssignment({
      ...payload,
      allowDuplicateAssignment: req.body.allowDuplicateAssignment === true,
      createdBy: req.user.id || req.user._id,
    })
    console.info(`[mock-test-schedule] Created assignment ${assignment._id} (${assignment.schedulingStatus})`)
    return res.status(201).json({ success: true, message: 'Mock test assigned successfully.', assignmentId: assignment._id, assignment })
  } catch (error) {
    if (error.code === '23505') return safeError(res, 409, 'This mock test is already assigned to one or more selected students.')
    return safeError(res, error.status || 500, error.status ? error.message : 'Mock test assignment failed.', error.status ? error.message : 'The assignment could not be saved. Please retry.')
  }
})

adminRouter.get('/assignments', apiLimiter, async (req, res) => {
  try {
    const assignments = await db.getMockTestAssignments()
    const enriched = await Promise.all(assignments.map(async assignment => {
      const attempts = await db.getMockTestAttempts(assignment._id)
      return {
        ...assignment,
        schedulingStatus: currentAssignmentScheduleStatus(assignment),
        assignedStudentCount: assignment.studentIds.length,
        attemptCount: attempts.length,
      }
    }))
    return res.json({ success: true, assignments: enriched })
  } catch (error) {
    return safeError(res, 500, 'Failed to load mock-test assignments.', 'The assignment list could not be loaded.')
  }
})

adminRouter.get('/assignments/:id', apiLimiter, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return safeError(res, 400, 'Invalid assignment ID.')
    const assignment = await db.getMockTestAssignmentById(req.params.id)
    if (!assignment) return safeError(res, 404, 'Assignment not found.')
    return res.json({
      success: true,
      assignment: { ...assignment, schedulingStatus: currentAssignmentScheduleStatus(assignment) },
      assignedStudentCount: assignment.studentIds.length,
    })
  } catch (error) {
    return safeError(res, 500, 'Failed to load assignment.')
  }
})

adminRouter.put('/assignments/:id', validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return safeError(res, 400, 'Invalid assignment ID.')
    const existing = await db.getMockTestAssignmentById(req.params.id)
    if (!existing) return safeError(res, 404, 'Assignment not found.')
    if (existing.status !== 'active') return safeError(res, 409, 'Cancelled or archived assignments cannot be edited.')
    const test = await db.getMockTestById(existing.mockTestId)
    if (!test) return safeError(res, 404, 'Source mock test not found.')
    const recipientIds = Array.isArray(req.body.studentIds) ? req.body.studentIds.map(id => String(id).toLowerCase()).sort() : null
    const existingRecipientIds = [...existing.studentIds].map(id => String(id).toLowerCase()).sort()
    if (req.body.assignedTo && req.body.assignedTo !== existing.assignedTo
      || recipientIds && (recipientIds.length !== existingRecipientIds.length || recipientIds.some((id, index) => id !== existingRecipientIds[index]))
      || existing.assignedTo === 'batch' && req.body.batchId !== undefined && Number(req.body.batchId) !== existing.batchId
      || existing.assignedTo === 'branch' && req.body.branch !== undefined && req.body.branch !== existing.branch
      || existing.assignedTo === 'examType' && req.body.examType !== undefined && req.body.examType !== existing.examType) {
      return safeError(res, 409, 'Use Reassign to change the assigned students. Create a new assignment instead.')
    }
    const scheduleChanged = req.body.startDateTime !== undefined
      || req.body.endDateTime !== undefined
      || req.body.timeZone !== undefined
    const currentScheduleStatus = currentAssignmentScheduleStatus(existing)
    if (scheduleChanged && ['active', 'expired'].includes(currentScheduleStatus)
      && req.body.confirmReschedule !== true) {
      return safeError(res, 409, 'Rescheduling an active or expired test requires explicit confirmation.', 'Retry with confirmReschedule set to true.')
    }
    if (scheduleChanged && ['active', 'expired'].includes(currentScheduleStatus)) {
      const attempts = await db.getMockTestAttempts(existing._id)
      if (attempts.some(attempt => attempt.status === 'in_progress')) {
        return safeError(res, 409, 'A test with an in-progress student attempt cannot be rescheduled.')
      }
    }
    const payload = normalizeRequest({
      ...existing,
      ...req.body,
      startDateTime: req.body.startDateTime ?? existing.startDateTime,
      endDateTime: req.body.endDateTime ?? existing.endDateTime,
      timeZone: req.body.timeZone ?? existing.timeZone,
    }, test)
    payload.schedulingStatus = payload.visibility === 'draft'
      ? 'draft'
      : getMockTestScheduleState(payload.startDateTime, payload.endDateTime)
    payload.activatedAt = payload.schedulingStatus === 'active' ? new Date().toISOString() : null
    payload.expiredAt = payload.schedulingStatus === 'expired' ? payload.endDateTime : null
    const updated = await db.updateMockTestAssignment(req.params.id, payload, {
      schedulingStatus: existing.schedulingStatus,
      startDateTime: existing.startDateTime,
      endDateTime: existing.endDateTime,
    })
    if (!updated) return safeError(res, 409, 'This schedule changed while you were editing it. Refresh and retry.')
    console.info(`[mock-test-schedule] Updated assignment ${updated._id} (${updated.schedulingStatus})`)
    return res.json({ success: true, message: 'Assignment updated successfully.', assignment: updated })
  } catch (error) {
    return safeError(res, error.status || 500, error.status ? error.message : 'Assignment update failed.')
  }
})

adminRouter.delete('/assignments/:id', validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return safeError(res, 400, 'Invalid assignment ID.')
    const assignment = await db.getMockTestAssignmentById(req.params.id)
    if (!assignment) return safeError(res, 404, 'Assignment not found.')
    const attempts = await db.getMockTestAttempts(assignment._id)
    if (attempts.length === 0) {
      const deleted = await db.deleteMockTestAssignment(assignment._id)
      if (!deleted) return safeError(res, 404, 'Assignment not found.')
      console.info(`[mock-test-schedule] Deleted assignment ${assignment._id}`)
      return res.json({ success: true, message: 'Schedule deleted.' })
    }
    const updated = await db.updateMockTestAssignment(assignment._id, {
      status: 'archived',
      schedulingStatus: 'cancelled',
    })
    console.info(`[mock-test-schedule] Archived assignment ${updated._id}; preserving ${attempts.length} attempt(s)`)
    return res.json({ success: true, message: 'Assignment archived; existing attempts and results were preserved.', assignment: updated })
  } catch (error) {
    return safeError(res, 500, 'Failed to cancel assignment.')
  }
})

adminRouter.get('/assignments/:id/attempts', apiLimiter, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return safeError(res, 400, 'Invalid assignment ID.')
    const assignment = await db.getMockTestAssignmentById(req.params.id)
    if (!assignment) return safeError(res, 404, 'Assignment not found.')
    const attempts = await db.getMockTestAttempts(assignment._id)
    return res.json({ success: true, attempts })
  } catch (error) {
    return safeError(res, 500, 'Failed to load student attempts.')
  }
})

const studentIdFor = req => String(req.user.id || req.user._id)
const studentCanAccess = (assignment, studentId) =>
  assignment && assignment.status === 'active' && assignment.studentIds.includes(studentId)
const publicAssignmentForStudent = assignment => {
  const { studentIds, createdBy, ...publicAssignment } = assignment
  return publicAssignment
}

const shuffle = values => {
  const output = [...values]
  for (let index = output.length - 1; index > 0; index -= 1) {
    const next = Math.floor(Math.random() * (index + 1))
    ;[output[index], output[next]] = [output[next], output[index]]
  }
  return output
}

const questionsForAttempt = async (attempt) => {
  const fullQuestions = await db.getQuestions({ ids: attempt.questionIds, isActive: true }, { isAdmin: true })
  const questionsById = new Map(fullQuestions.map(question => [String(question._id), question]))
  return attempt.questionIds.map(id => {
    const question = questionsById.get(String(id))
    if (!question) throw Object.assign(new Error('A question in this test is no longer available.'), { status: 409 })
    const { correctIndex, solution, ...safeQuestion } = question
    const optionOrder = attempt.optionOrders[String(id)] || question.options.map((_, index) => index)
    return { ...safeQuestion, options: optionOrder.map(index => question.options[index]) }
  })
}

studentRouter.use(protect, (req, res, next) => {
  if (req.user.role !== 'student') return safeError(res, 403, 'Student access is required.')
  return next()
})

studentRouter.get('/assigned', apiLimiter, async (req, res) => {
  try {
    const studentId = studentIdFor(req)
    const assignments = (await db.getMockTestAssignments()).filter(assignment =>
      assignment.studentIds.includes(studentId) && assignment.status === 'active' && assignment.visibility !== 'draft')
    const assigned = await Promise.all(assignments.map(async assignment => {
      const attempts = await db.getMockTestAttempts(assignment._id, studentId)
      const test = await db.getMockTestById(assignment.mockTestId)
      const assignedQuestions = test?.questionIds?.length
        ? await db.getQuestions({ ids: test.questionIds, isActive: true }, { isAdmin: true })
        : []
      const activeAttempt = attempts.find(attempt => attempt.status === 'in_progress') || null
      const completedAttempts = attempts.filter(attempt => attempt.status === 'submitted').length
      const now = Date.now()
      const canSeeResults = assignment.resultVisibility === 'immediate'
        || assignment.resultVisibility === 'after_close' && now >= new Date(assignment.endDateTime).getTime()
      const results = canSeeResults
        ? (await Promise.all(attempts.filter(attempt => ['submitted', 'expired'].includes(attempt.status) && attempt.resultId)
          .map(attempt => db.getTestResultById(attempt.resultId))))
          .filter(Boolean)
          .map(result => ({ score: result.score, totalMarks: result.totalMarks, attemptedAt: result.attemptedAt }))
        : []
      let status = 'Available'
      if (now < new Date(assignment.startDateTime).getTime()) status = 'Upcoming'
      else if (now >= new Date(assignment.endDateTime).getTime() || assignment.schedulingStatus === 'expired') status = 'Expired'
      else if (activeAttempt) status = 'In Progress'
      else if (completedAttempts && assignment.attemptLimit !== null && completedAttempts >= assignment.attemptLimit) status = 'Submitted'
      else if (assignment.visibility === 'draft') status = 'Upcoming'
      return {
        ...publicAssignmentForStudent(assignment),
        subject: test?.subject || '',
        examType: test?.examType || assignment.examType,
        questionCount: assignedQuestions.length,
        totalMarks: assignedQuestions.reduce((total, question) => total + (Number(question.marks) || 0), 0),
        status,
        attemptsUsed: attempts.length,
        hasSubmittedAttempt: completedAttempts > 0,
        attemptsRemaining: assignment.attemptLimit === null ? null : Math.max(0, assignment.attemptLimit - attempts.length),
        activeAttemptId: activeAttempt?._id || null,
        results,
      }
    }))
    return res.json({ success: true, assignments: assigned })
  } catch (error) {
    return safeError(res, 500, 'Failed to load assigned mock tests.')
  }
})

studentRouter.get('/assigned/:id', apiLimiter, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return safeError(res, 400, 'Invalid assignment ID.')
    const assignment = await db.getMockTestAssignmentById(req.params.id)
    if (!studentCanAccess(assignment, studentIdFor(req)) || assignment.visibility === 'draft') return safeError(res, 404, 'Assigned mock test not found.')
    const attempts = await db.getMockTestAttempts(assignment._id, studentIdFor(req))
    const canSeeResults = assignment.resultVisibility === 'immediate'
      || assignment.resultVisibility === 'after_close' && Date.now() >= new Date(assignment.endDateTime).getTime()
    return res.json({
      success: true,
      assignment: publicAssignmentForStudent(assignment),
      attempts: attempts.map(({ answers, questionIds, optionOrders, score, resultId, ...attempt }) => ({
        ...attempt,
        ...(canSeeResults ? { score, resultId } : {}),
      })),
    })
  } catch (error) {
    return safeError(res, 500, 'Failed to load assigned mock test.')
  }
})

studentRouter.post('/:assignmentId/start', validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.assignmentId)) return safeError(res, 400, 'Invalid assignment ID.')
    const studentId = studentIdFor(req)
    const assignment = await db.getMockTestAssignmentById(req.params.assignmentId)
    if (!studentCanAccess(assignment, studentId)) return safeError(res, 404, 'Assigned mock test not found.')
    if (assignment.visibility === 'draft') return safeError(res, 403, 'This test is not available to students.')
    const now = Date.now()
    if (now < new Date(assignment.startDateTime).getTime()) return safeError(res, 403, 'This test has not started yet.')
    if (now >= new Date(assignment.endDateTime).getTime() || assignment.schedulingStatus === 'expired') return safeError(res, 410, 'This test has expired.')

    const attempts = await db.getMockTestAttempts(assignment._id, studentId)
    const activeAttempt = attempts.find(attempt => attempt.status === 'in_progress')
    if (activeAttempt) {
      if (!assignment.allowResume) return safeError(res, 409, 'An attempt is already in progress and resume is disabled.')
      const questions = await questionsForAttempt(activeAttempt)
      return res.json({ success: true, message: 'Resuming your attempt.', assignment: publicAssignmentForStudent(assignment), attempt: activeAttempt, questions, resumed: true })
    }
    if (assignment.attemptLimit !== null && attempts.length >= assignment.attemptLimit) {
      return safeError(res, 409, 'You have used all attempts for this mock test.')
    }

    const test = await db.getMockTestById(assignment.mockTestId)
    if (!test) return safeError(res, 404, 'The source mock test is no longer available.')
    const { questions: validatedQuestions, totalMarks } = await validateTestQuestions(test)
    const questionIds = assignment.randomizeQuestions ? shuffle(test.questionIds) : [...test.questionIds]
    const optionOrders = {}
    for (const questionId of questionIds) {
      const question = validatedQuestions.find(item => String(item._id) === String(questionId))
      optionOrders[String(questionId)] = assignment.randomizeOptions
        ? shuffle(question.options.map((_, index) => index))
        : question.options.map((_, index) => index)
    }
    let attempt
    try {
      attempt = await db.createMockTestAttempt({
        assignmentId: assignment._id,
        mockTestId: assignment.mockTestId,
        studentId,
        attemptNumber: attempts.length + 1,
        totalMarks,
        questionIds,
        optionOrders,
      })
    } catch (error) {
      if (error.code === '23505') return safeError(res, 409, 'An attempt was just started for this assignment. Refresh to resume it.')
      throw error
    }
    const responseQuestions = await questionsForAttempt(attempt)
    return res.status(201).json({ success: true, message: 'Mock test started.', assignment: publicAssignmentForStudent(assignment), attempt, questions: responseQuestions, resumed: false })
  } catch (error) {
    return safeError(res, error.status || 500, error.status ? error.message : 'Could not start mock test.', error.status ? error.message : 'Please retry starting this test.')
  }
})

studentRouter.put('/attempts/:attemptId/progress', validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.attemptId)) return safeError(res, 400, 'Invalid attempt ID.')
    const attempt = await db.getMockTestAttemptById(req.params.attemptId)
    if (!attempt || attempt.studentId !== studentIdFor(req)) return safeError(res, 404, 'Attempt not found.')
    if (attempt.status !== 'in_progress') return safeError(res, 409, attempt.status === 'expired' ? 'This attempt has expired.' : 'This attempt has already been submitted.')
    const assignment = await db.getMockTestAssignmentById(attempt.assignmentId)
    if (!studentCanAccess(assignment, studentIdFor(req))) return safeError(res, 403, 'This assignment is no longer active.')
    const now = Date.now()
    const deadline = Math.min(
      new Date(assignment.endDateTime).getTime(),
      new Date(attempt.startedAt).getTime() + assignment.duration * 60_000,
    )
    if (now >= deadline) {
      const timeSpent = Math.max(0, Math.floor((deadline - new Date(attempt.startedAt).getTime()) / 1000))
      const expired = await db.expireMockTestAttempt(attempt._id, new Date(deadline).toISOString(), timeSpent)
      if (expired) {
        try {
          await evaluateAndSaveMockTestAttempt(expired, assignment)
        } catch (error) {
          console.error(`Failed to evaluate expired mock-test attempt ${attempt._id}:`, error)
          return safeError(res, 503, 'The attempt expired and was saved. Result evaluation is pending; the scheduler will retry.')
        }
      }
      return safeError(res, 410, 'The test deadline has passed. Previously saved answers were preserved.')
    }
    const elapsedSeconds = Math.max(0, Math.floor((now - new Date(attempt.startedAt).getTime()) / 1000))
    if (!req.body.answers || typeof req.body.answers !== 'object' || Array.isArray(req.body.answers)) return safeError(res, 400, 'Attempt answers must be an object.')
    const answers = {}
    for (const [questionId, value] of Object.entries(req.body.answers)) {
      const optionCount = attempt.optionOrders[questionId]?.length || 0
      if (!attempt.questionIds.includes(questionId) || !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) >= optionCount) {
        return safeError(res, 400, 'Attempt answers contain an invalid question or option.')
      }
      answers[questionId] = Number(value)
    }
    const updated = await db.updateMockTestAttempt(attempt._id, {
      answers,
      timeSpent: Math.min(elapsedSeconds, assignment.duration * 60),
    })
    return res.json({ success: true, message: 'Attempt progress saved.', attempt: updated })
  } catch (error) {
    return safeError(res, 500, 'Failed to save attempt progress.')
  }
})

studentRouter.post('/attempts/:attemptId/submit', validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.attemptId)) return safeError(res, 400, 'Invalid attempt ID.')
    const attempt = await db.getMockTestAttemptById(req.params.attemptId)
    if (!attempt || attempt.studentId !== studentIdFor(req)) return safeError(res, 404, 'Attempt not found.')
    if (attempt.status !== 'in_progress') return safeError(res, 409, attempt.status === 'expired' ? 'This attempt has expired.' : 'This attempt has already been submitted.')
    const assignment = await db.getMockTestAssignmentById(attempt.assignmentId)
    if (!studentCanAccess(assignment, studentIdFor(req))) return safeError(res, 403, 'This assignment is no longer active.')
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(attempt.startedAt).getTime()) / 1000))
    if (Date.now() >= new Date(assignment.endDateTime).getTime() || assignment.schedulingStatus === 'expired') {
      const deadline = Math.min(
        new Date(assignment.endDateTime).getTime(),
        new Date(attempt.startedAt).getTime() + assignment.duration * 60_000,
      )
      const expired = await db.expireMockTestAttempt(
        attempt._id,
        new Date(deadline).toISOString(),
        Math.max(0, Math.floor((deadline - new Date(attempt.startedAt).getTime()) / 1000)),
      )
      if (expired) {
        try {
          await evaluateAndSaveMockTestAttempt(expired, assignment)
        } catch (error) {
          console.error(`Failed to evaluate expired mock-test attempt ${attempt._id}:`, error)
          return safeError(res, 503, 'The attempt expired and was saved. Result evaluation is pending; the scheduler will retry.')
        }
      }
      return safeError(res, 410, 'The test deadline has passed. Previously saved answers were preserved.')
    }
    const timedOut = elapsedSeconds >= assignment.duration * 60
    const answers = timedOut ? attempt.answers : req.body.answers && typeof req.body.answers === 'object' ? req.body.answers : attempt.answers
    const validQuestions = await db.getQuestions({ ids: attempt.questionIds, isActive: true }, { isAdmin: true })
    const byId = new Map(validQuestions.map(question => [String(question._id), question]))
    let score = 0
    let correct = 0
    let incorrect = 0
    let totalMarks = 0
    const subjectScores = new Map()
    for (const id of attempt.questionIds) {
      const question = byId.get(String(id))
      if (!question) return safeError(res, 409, 'A question in this attempt is no longer available.')
      const marks = Number(question.marks)
      const options = attempt.optionOrders[String(id)] || question.options.map((_, index) => index)
      totalMarks += marks
      const subject = question.subject || 'General'
      const summary = subjectScores.get(subject) || { score: 0, maxScore: 0 }
      summary.maxScore += marks
      if (answers[id] !== undefined && answers[id] !== null) {
        const selected = Number(answers[id])
        if (!Number.isInteger(selected) || selected < 0 || selected >= options.length) return safeError(res, 400, 'One or more submitted answers are invalid.')
        if (Number(options[selected]) === Number(question.correctIndex)) {
          correct += 1
          score += marks
          summary.score += marks
        } else {
          incorrect += 1
          if (assignment.mockTestName.toLowerCase().includes('jee') || assignment.mockTestName.toLowerCase().includes('neet')) {
            const deduction = Number(question.negativeMarks) || 0
            score = Math.max(0, score - deduction)
            summary.score = Math.max(0, summary.score - deduction)
          }
        }
      }
      subjectScores.set(subject, summary)
    }
    const timeSpent = Math.min(elapsedSeconds, assignment.duration * 60)
    const submittedAt = new Date().toISOString()
    const reviewAnswers = Object.fromEntries(Object.entries(answers).map(([questionId, selectedIndex]) => [
      questionId,
      Number(attempt.optionOrders[questionId]?.[selectedIndex] ?? selectedIndex),
    ]))
    const claimedAttempt = await db.claimMockTestAttemptSubmission(attempt._id, studentIdFor(req), {
      answers,
      timeSpent,
      submittedAt,
      score,
    })
    if (!claimedAttempt) return safeError(res, 409, 'This attempt was already submitted.')
    let result
    try {
      result = await db.createTestResult({
        userId: studentIdFor(req),
        testName: assignment.mockTestName,
        subject: 'Mock Test',
        score,
        totalMarks,
        percentile: totalMarks ? (score / totalMarks) * 100 : 0,
        duration: timeSpent,
        correct,
        incorrect,
        unanswered: attempt.questionIds.length - correct - incorrect,
        totalQuestions: attempt.questionIds.length,
        subjectWiseScores: Array.from(subjectScores.entries()).map(([subject, values]) => ({
          subject,
          ...values,
          percentage: values.maxScore ? (values.score / values.maxScore) * 100 : 0,
        })),
        answers: reviewAnswers,
        questionIds: attempt.questionIds,
        mockTestAttemptId: attempt._id,
      })
    } catch (error) {
      await db.updateMockTestAttempt(attempt._id, {
        status: 'in_progress',
        submittedAt: null,
        score: null,
        answers,
        timeSpent,
      })
      throw error
    }
    const submittedAttempt = await db.updateMockTestAttempt(attempt._id, { resultId: result._id })
    return res.json({
      success: true,
      message: 'Mock test submitted successfully.',
      attempt: submittedAttempt,
      ...(assignment.resultVisibility === 'immediate'
        || assignment.resultVisibility === 'after_close' && Date.now() >= new Date(assignment.endDateTime).getTime()
        ? { result }
        : {}),
    })
  } catch (error) {
    return safeError(res, 500, 'Failed to submit mock test.', 'Your attempt could not be submitted. Please retry.')
  }
})

module.exports = { adminRouter, studentRouter }
