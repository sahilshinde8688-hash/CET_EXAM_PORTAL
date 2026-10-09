const SUPER_ADMIN_EMAIL = 'cetnova26@gmail.com'

const isSuperAdminUser = (user) => user?.role === 'admin'
  && String(user.email || '').trim().toLowerCase() === SUPER_ADMIN_EMAIL

const getEffectiveAdminRole = (user) => {
  if (user?.role !== 'admin') return user?.adminRole || null
  return isSuperAdminUser(user) ? 'Super Admin' : 'ADMIN'
}

module.exports = { SUPER_ADMIN_EMAIL, isSuperAdminUser, getEffectiveAdminRole }
