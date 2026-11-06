const SUPER_ADMIN_EMAIL = 'cetnova26@gmail.com'

const isSuperAdminUser = (user) => user?.role === 'admin'
  && String(user.email || '').trim().toLowerCase() === SUPER_ADMIN_EMAIL

const getEffectiveAdminRole = (user) => {
  if (user?.role !== 'admin') return user?.adminRole || null
  return isSuperAdminUser(user) ? 'Super Admin' : 'ADMIN'
}

const hasAdminPrivileges = (user) => user?.role === 'admin'
  && (user.status === 'approved' || user.status == null)
  && ['Super Admin', 'ADMIN'].includes(user.adminRole)

module.exports = { SUPER_ADMIN_EMAIL, isSuperAdminUser, getEffectiveAdminRole, hasAdminPrivileges }
