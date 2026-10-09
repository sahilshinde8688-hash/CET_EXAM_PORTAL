const test = require('node:test')
const assert = require('node:assert/strict')
const { getMockTestScheduleState } = require('../utils/mockTestSchedule')

const start = Date.parse('2026-10-15T04:30:00.000Z')
const end = Date.parse('2026-10-15T05:30:00.000Z')

test('a future mock test stays scheduled until its start instant', () => {
  assert.equal(getMockTestScheduleState(start, end, start - 1), 'scheduled')
  assert.equal(getMockTestScheduleState(start, end, start), 'active')
})

test('expiry takes precedence over activation, including missed schedules', () => {
  assert.equal(getMockTestScheduleState(start, end, end), 'expired')
  assert.equal(getMockTestScheduleState(start, end, end + 60_000), 'expired')
})

test('invalid or non-increasing schedule instants are rejected', () => {
  assert.throws(() => getMockTestScheduleState('invalid', end), /valid start time/)
  assert.throws(() => getMockTestScheduleState(start, start), /valid start time/)
})
