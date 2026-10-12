const db = require('./dbService')
const { evaluateAndSaveMockTestAttempt } = require('./mockTestEvaluation')
const { getMockTestScheduleState } = require('../utils/mockTestSchedule')
const { runDueEmailNotifications } = require('./emailNotificationService')

const SCHEDULE_SCAN_INTERVAL_MS = 15_000
let scanTimer = null
let scanInProgress = false

const attemptDeadline = (attempt, assignment) => Math.min(
  new Date(assignment.endDateTime).getTime(),
  new Date(attempt.startedAt).getTime() + Number(assignment.duration) * 60_000,
)

const evaluateExpiredAttempts = async () => {
  const attempts = await db.getExpiredMockTestAttemptsNeedingEvaluation()
  for (const attempt of attempts) {
    try {
      const assignment = await db.getMockTestAssignmentById(attempt.assignmentId)
      if (!assignment) {
        console.error(`[mock-test-scheduler] Missing assignment for expired attempt ${attempt._id}`)
        continue
      }
      await evaluateAndSaveMockTestAttempt(attempt, assignment)
      console.info(`[mock-test-scheduler] Evaluated expired attempt ${attempt._id}`)
    } catch (error) {
      console.error(`[mock-test-scheduler] Could not evaluate expired attempt ${attempt._id}:`, error.message)
    }
  }
}

const closeDueAttempts = async (assignment, now) => {
  const attempts = await db.getMockTestAttempts(assignment._id)
  for (const attempt of attempts) {
    if (attempt.status !== 'in_progress') continue
    const deadline = attemptDeadline(attempt, assignment)
    if (now < deadline) continue
    const expiredAt = new Date(deadline).toISOString()
    const timeSpent = Math.max(0, Math.floor((deadline - new Date(attempt.startedAt).getTime()) / 1000))
    const expired = await db.expireMockTestAttempt(attempt._id, expiredAt, timeSpent)
    if (expired) console.info(`[mock-test-scheduler] Closed attempt ${attempt._id} at its deadline`)
  }
}

const runMockTestScheduleScan = async () => {
  if (scanInProgress) return
  scanInProgress = true
  try {
    const now = Date.now()
    const activatedTests = await db.activateDueScheduledMockTests(new Date(now))
    for (const test of activatedTests) {
      console.info(`[mock-test-scheduler] Activated mock test ${test.id} (${test.title})`)
    }
    const assignments = await db.getMockTestAssignmentsToProcess()
    for (const assignment of assignments) {
      const startsAt = new Date(assignment.startDateTime).getTime()
      const endsAt = new Date(assignment.endDateTime).getTime()
      const currentWindowState = getMockTestScheduleState(startsAt, endsAt, now)
      if (assignment.schedulingStatus === 'scheduled') {
        if (currentWindowState === 'expired') {
          const expired = await db.transitionMockTestAssignment(assignment._id, 'scheduled', {
            schedulingStatus: 'expired',
            expiredAt: new Date(now).toISOString(),
          }, assignment)
          if (expired) console.info(`[mock-test-scheduler] Expired missed schedule ${assignment._id} without activating it`)
        } else if (currentWindowState === 'active') {
          const activated = await db.transitionMockTestAssignment(assignment._id, 'scheduled', {
            schedulingStatus: 'active',
            visibility: 'available',
            activatedAt: new Date(now).toISOString(),
          }, assignment)
          if (activated) console.info(`[mock-test-scheduler] Activated assignment ${assignment._id}`)
        }
      } else if (assignment.schedulingStatus === 'active' && endsAt <= now) {
        const expired = await db.transitionMockTestAssignment(assignment._id, 'active', {
          schedulingStatus: 'expired',
          expiredAt: new Date(now).toISOString(),
        }, assignment)
        if (expired) console.info(`[mock-test-scheduler] Expired assignment ${assignment._id}`)
      }

      if (assignment.schedulingStatus === 'active' || endsAt <= now) {
        await closeDueAttempts(assignment, now)
      }
    }
    await evaluateExpiredAttempts()
    try {
      await runDueEmailNotifications()
    } catch (error) {
      console.error('[email-scheduler] Could not process queued notifications:', error.message)
    }
  } catch (error) {
    console.error('[mock-test-scheduler] Schedule scan failed; it will retry on the next scan:', error.message)
  } finally {
    scanInProgress = false
  }
}

const startMockTestScheduler = () => {
  if (scanTimer) return
  console.info(`[mock-test-scheduler] Persistent schedule worker started; scanning every ${SCHEDULE_SCAN_INTERVAL_MS / 1000}s`)
  void runMockTestScheduleScan()
  scanTimer = setInterval(() => { void runMockTestScheduleScan() }, SCHEDULE_SCAN_INTERVAL_MS)
}

const stopMockTestScheduler = () => {
  if (!scanTimer) return
  clearInterval(scanTimer)
  scanTimer = null
}

module.exports = {
  attemptDeadline,
  runMockTestScheduleScan,
  startMockTestScheduler,
  stopMockTestScheduler,
}
