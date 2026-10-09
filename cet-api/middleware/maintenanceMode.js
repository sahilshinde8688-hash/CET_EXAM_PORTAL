const supabase = require('../config/supabase')
const { optionalAuth } = require('./auth')
const { isSuperAdminUser } = require('../utils/adminRoles')

const CACHE_TTL_MS = 5_000
let cachedSetting = { enabled: false, message: '', checkedAt: 0 }

const isExemptPath = (path) => (
  path.startsWith('/super-admin/')
  || path === '/super-admin'
  || path === '/auth/login'
  || path === '/auth/refresh'
  || path === '/auth/logout'
  || path === '/auth/csrf'
  || path === '/health'
)

const getMaintenanceSetting = async () => {
  if (Date.now() - cachedSetting.checkedAt < CACHE_TTL_MS) return cachedSetting

  const { data, error } = await supabase
    .from('system_settings')
    .select('key,value')
    .in('key', ['maintenance_mode', 'maintenance_reason'])
  if (error) throw error

  const values = Object.fromEntries((data || []).map(item => [item.key, item.value]))
  cachedSetting = {
    enabled: values.maintenance_mode === true || values.maintenance_mode === 'true',
    message: typeof values.maintenance_reason === 'string' ? values.maintenance_reason : '',
    checkedAt: Date.now(),
  }
  return cachedSetting
}

const invalidateMaintenanceSetting = () => {
  cachedSetting.checkedAt = 0
}

const maintenanceMode = async (req, res, next) => {
  if (isExemptPath(req.path)) return next()

  let setting
  try {
    setting = await getMaintenanceSetting()
  } catch (error) {
    return next(error)
  }
  if (!setting.enabled) return next()

  return optionalAuth(req, res, () => {
    if (isSuperAdminUser(req.user)) return next()

    return res.status(503).json({
      success: false,
      code: 'MAINTENANCE_MODE',
      message: setting.message || 'The system is under maintenance. Please check back later.',
    })
  })
}

module.exports = { maintenanceMode, invalidateMaintenanceSetting }
