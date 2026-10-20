const db = require('./dbService')

const CATEGORY = Object.freeze({
  EXAM_UPDATE: 'exam_update',
  TEST_ASSIGNMENT: 'test_assignment',
  RESULT: 'result',
  REMINDER: 'reminder',
  SYSTEM_ALERT: 'system_alert',
})
let lastScheduledScanAt = 0

const createForUsers = async (userIds, notification) => {
  const recipients = [...new Set((userIds || []).map(String).filter(Boolean))]
  if (!recipients.length) return
  const batchSize = 500
  for (let offset = 0; offset < recipients.length; offset += batchSize) {
    await db.createNotifications(recipients.slice(offset, offset + batchSize).map(userId => ({
      userId,
      category: notification.category,
      title: notification.title,
      message: notification.message,
      targetPage: notification.targetPage,
      targetType: notification.targetType || null,
      targetId: notification.targetId || null,
      dedupeKey: notification.dedupeKey,
    })))
  }
}

const notifyAssignmentCreated = async assignment => {
  if (!assignment || assignment.status !== 'active' || assignment.visibility === 'draft') return
  await createForUsers(assignment.studentIds, {
    category: CATEGORY.TEST_ASSIGNMENT,
    title: 'New test assigned',
    message: `${assignment.mockTestName} has been assigned to you.`,
    targetPage: 'mocktests',
    targetType: 'assignment',
    targetId: assignment._id,
    dedupeKey: `assignment:${assignment._id}:created`,
  })
}

const notifyAssignmentStarted = async assignment => {
  if (await db.getSystemSetting('in_app_notifications') === false) return
  await createForUsers(assignment.studentIds, {
    category: CATEGORY.EXAM_UPDATE,
    title: 'Your assigned test is now available',
    message: `${assignment.mockTestName} is now open. Check the schedule and instructions before starting.`,
    targetPage: 'mocktests',
    targetType: 'assignment',
    targetId: assignment._id,
    dedupeKey: `assignment:${assignment._id}:started`,
  })
}

const notifyResultPublished = async result => {
  if (!result?._id || !result?.userId) return
  await createForUsers([result.userId], {
    category: CATEGORY.RESULT,
    title: 'Your test result is ready',
    message: `Your result for ${result.testName || 'your test'} is available to review.`,
    targetPage: 'results',
    targetType: 'result',
    targetId: result._id,
    dedupeKey: `result:${result._id}:published`,
  })
}

const notifyAssignmentReminder = async assignment => {
  await createForUsers(assignment.studentIds, {
    category: CATEGORY.REMINDER,
    title: 'Upcoming test reminder',
    message: `${assignment.mockTestName} starts in about one hour.`,
    targetPage: 'mocktests',
    targetType: 'assignment',
    targetId: assignment._id,
    dedupeKey: `assignment:${assignment._id}:reminder:one-hour`,
  })
}

const publishSystemAlert = async ({ title, message, targetPage = 'dashboard', dedupeKey }) => {
  const students = await db.getApprovedStudentsForAssignment()
  await createForUsers(students.map(student => student.id || student._id), {
    category: CATEGORY.SYSTEM_ALERT,
    title,
    message,
    targetPage,
    dedupeKey,
  })
}

const processScheduledNotifications = async (assignments, now = Date.now()) => {
  if (now - lastScheduledScanAt < 60_000) return
  if (await db.getSystemSetting('in_app_notifications') === false) {
    lastScheduledScanAt = now
    return
  }
  lastScheduledScanAt = now
  for (const assignment of assignments) {
    if (assignment.status !== 'active' || assignment.visibility === 'draft') continue

    const startsAt = Date.parse(assignment.startDateTime)
    const timeUntilStart = startsAt - now
    if (timeUntilStart > 0 && timeUntilStart <= 60 * 60 * 1000) {
      await notifyAssignmentReminder(assignment)
    }
  }
}

module.exports = {
  CATEGORY,
  notifyAssignmentCreated,
  notifyAssignmentStarted,
  notifyResultPublished,
  processScheduledNotifications,
  publishSystemAlert,
}
