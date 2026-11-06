const test = require('node:test')
const assert = require('node:assert/strict')
const { getEffectiveAdminRole, hasAdminPrivileges, isSuperAdminUser, SUPER_ADMIN_EMAIL } = require('../utils/adminRoles')

test('only the configured CETNova admin email receives Super Admin role', () => {
  assert.equal(isSuperAdminUser({ role: 'admin', email: SUPER_ADMIN_EMAIL }), true)
  assert.equal(getEffectiveAdminRole({ role: 'admin', email: SUPER_ADMIN_EMAIL, adminRole: 'ADMIN' }), 'Super Admin')
})

test('all other administrator accounts are Basic Admin regardless of stored role', () => {
  assert.equal(isSuperAdminUser({ role: 'admin', email: 'other@example.com' }), false)
  assert.equal(isSuperAdminUser({ role: 'admin', email: 'cetnova@26@gmail.com' }), false)
  assert.equal(getEffectiveAdminRole({ role: 'admin', email: 'other@example.com', adminRole: 'Super Admin' }), 'ADMIN')
  assert.equal(getEffectiveAdminRole({ role: 'admin', email: 'other@example.com', adminRole: null }), 'ADMIN')
})

test('the designated email does not receive admin access when its account is not an admin', () => {
  assert.equal(isSuperAdminUser({ role: 'student', email: SUPER_ADMIN_EMAIL }), false)
  assert.equal(getEffectiveAdminRole({ role: 'student', email: SUPER_ADMIN_EMAIL, adminRole: null }), null)
})

test('only approved administrators with an allowed effective role can access admin data', () => {
  assert.equal(hasAdminPrivileges({ role: 'admin', status: 'approved', adminRole: 'ADMIN' }), true)
  assert.equal(hasAdminPrivileges({ role: 'admin', status: null, adminRole: 'Super Admin' }), true)
  assert.equal(hasAdminPrivileges({ role: 'admin', status: 'pending', adminRole: 'ADMIN' }), false)
  assert.equal(hasAdminPrivileges({ role: 'admin', status: 'approved', adminRole: 'Basic Admin' }), false)
  assert.equal(hasAdminPrivileges({ role: 'student', status: 'approved', adminRole: 'ADMIN' }), false)
})
