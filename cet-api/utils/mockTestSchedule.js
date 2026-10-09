const getMockTestScheduleState = (startsAt, endsAt, now = Date.now()) => {
  const startTime = new Date(startsAt).getTime()
  const endTime = new Date(endsAt).getTime()
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime) {
    throw new Error('A valid start time earlier than the expiry time is required.')
  }
  if (now >= endTime) return 'expired'
  if (now >= startTime) return 'active'
  return 'scheduled'
}

module.exports = { getMockTestScheduleState }
