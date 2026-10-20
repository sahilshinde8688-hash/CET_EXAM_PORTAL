const express = require('express')
const os = require('os')
const supabase = require('../config/supabase')
const { protect, requireSuperAdmin } = require('../middleware/auth')
const { validateCsrfToken } = require('../middleware/csrf')
const {
  apiLimiter,
  API_RATE_LIMIT_WINDOW_MS,
  getRedisStatus,
} = require('../middleware/rateLimit')
const { deleteUserSessions } = require('../services/dbService')
const { getSystemMetrics } = require('../services/systemMetrics')
const { invalidateMaintenanceSetting } = require('../middleware/maintenanceMode')
const { getEffectiveAdminRole } = require('../utils/adminRoles')
const packageInfo = require('../package.json')

const router = express.Router()

// Helper to record audit events
const recordSuperAdminAction = async (req, action, module, status = 'Success') => {
  const { error } = await supabase.from('admin_audit_logs').insert({
    admin_id: req.user.id || req.user._id,
    admin_name: req.user.name || 'Super Admin',
    action,
    module,
    ip_address: req.ip || req.headers['x-forwarded-for'] || 'Internal',
    status,
  })
  if (error) throw error
}

// -------------------------------------------------------------
// 1. OVERVIEW & METRICS
// -------------------------------------------------------------
router.get('/overview', protect, requireSuperAdmin, apiLimiter, async (req, res) => {
  try {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [
      studentsResult,
      adminCountResult,
      mockTestsResult,
      activeExamsResult,
      questionsResult,
      attemptsResult,
      registrationsResult,
    ] = await Promise.all([
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'student'),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin'),
      supabase.from('mock_tests').select('id', { count: 'exact', head: true }),
      supabase.from('mock_tests').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('questions').select('id', { count: 'exact', head: true }),
      supabase.from('test_results').select('id', { count: 'exact', head: true }).gte('attempted_at', todayStart.toISOString()),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'student').gte('created_at', todayStart.toISOString()),
    ])

    const coreResults = [
      studentsResult, adminCountResult, mockTestsResult, activeExamsResult,
      questionsResult, attemptsResult, registrationsResult,
    ]
    const coreFailure = coreResults.find(result => result.error)
    if (coreFailure) throw coreFailure.error

    const [
      adminsResult,
      adminDetailsResult,
      lockedCountResult,
      activeAlertsCountResult,
      activeAlertsResult,
      backupResult,
      todayApiCallsResult,
      totalApiCallsResult,
    ] = await Promise.all([
      supabase.from('users').select('id, name, email, phone, role, admin_role, status, created_at').eq('role', 'admin').order('created_at', { ascending: false }).limit(500),
      supabase.from('users').select('id, is_locked, locked_reason, cluster_id').eq('role', 'admin').order('created_at', { ascending: false }).limit(500),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('is_locked', true),
      supabase.from('security_alerts').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('security_alerts').select('id, alert_type, severity, description, created_at').eq('status', 'active').order('created_at', { ascending: false }).limit(10),
      supabase.from('backup_logs').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('api_usage_logs').select('id', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
      supabase.from('api_usage_logs').select('id', { count: 'exact', head: true }),
    ])

    if (adminsResult.error) throw adminsResult.error

    const optionalResults = [
      ['administrator lock and cluster details', adminDetailsResult],
      ['locked admin count', lockedCountResult],
      ['security alerts', activeAlertsCountResult],
      ['recent security alerts', activeAlertsResult],
      ['backup history', backupResult],
      ["today's API calls", todayApiCallsResult],
      ['total API calls', totalApiCallsResult],
    ]
    const dataWarnings = optionalResults
      .filter(([, result]) => result.error)
      .map(([label, result]) => {
        console.error(`Super Admin overview ${label} query failed:`, result.error)
        return label
      })
    const adminDetailsById = new Map((adminDetailsResult.data || []).map(admin => [admin.id, admin]))
    const admins = (adminsResult.data || []).map(admin => {
      const details = adminDetailsById.get(admin.id)
      return {
        ...admin,
        admin_role: getEffectiveAdminRole({ role: admin.role, email: admin.email, adminRole: admin.admin_role }),
        is_locked: details?.is_locked ?? null,
        locked_reason: details?.locked_reason ?? null,
        cluster_id: details?.cluster_id ?? null,
      }
    })
    const systemMetrics = await getSystemMetrics()

    res.json({
      success: true,
      stats: {
        totalStudents: studentsResult.count || 0,
        totalAdmins: adminCountResult.count || 0,
        totalMockTests: mockTestsResult.count || 0,
        totalQuestions: questionsResult.count || 0,
        activeExams: activeExamsResult.count || 0,
        todayAttempts: attemptsResult.count || 0,
        todayRegistrations: registrationsResult.count || 0,
        lockedAdmins: lockedCountResult.error ? null : lockedCountResult.count || 0,
        activeAlertsCount: activeAlertsCountResult.error ? null : activeAlertsCountResult.count || 0,
        todayApiCalls: todayApiCallsResult.error ? null : todayApiCallsResult.count || 0,
        totalApiCalls: totalApiCallsResult.error ? null : totalApiCallsResult.count || 0,
        backupHistoryAvailable: !backupResult.error,
        lastBackup: backupResult.error ? null : backupResult.data || null,
        serverQuick: {
          uptimeSeconds: systemMetrics.uptimeSeconds,
          processUptime: systemMetrics.processUptimeSeconds,
          memoryUsagePercent: systemMetrics.memoryUsage,
          cpuLoad1m: systemMetrics.loadAverage,
        }
      },
      admins,
      adminDetailsAvailable: !adminDetailsResult.error,
      recentAlerts: activeAlertsResult.error ? [] : activeAlertsResult.data || [],
      systemMetrics,
      dataWarnings,
    })
  } catch (error) {
    console.error('Super Admin overview error:', error)
    res.status(500).json({ success: false, message: 'Failed to load Super Admin overview.' })
  }
})

router.get('/system/stats', protect, requireSuperAdmin, apiLimiter, async (req, res) => {
  try {
    const stats = await getSystemMetrics()
    res.json({ success: true, data: stats, message: 'System statistics loaded.' })
  } catch (error) {
    console.error('System statistics error:', error)
    res.status(500).json({ success: false, data: null, message: 'Unable to retrieve server metrics.' })
  }
})

router.get('/storage-optimization', protect, requireSuperAdmin, apiLimiter, async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('get_storage_optimization_metrics')
    if (error) throw error
    if (!data || typeof data !== 'object') {
      throw new Error('Storage metrics function returned an invalid response')
    }

    const snapshotDate = new Date().toISOString().slice(0, 10)
    const { error: snapshotError } = await supabase
      .from('storage_usage_snapshots')
      .upsert({
        snapshot_date: snapshotDate,
        captured_at: data.measuredAt || new Date().toISOString(),
        database_bytes: data.databaseBytes,
        storage_bytes: data.storageBytes,
        object_count: data.storageObjectCount,
      }, { onConflict: 'snapshot_date' })
    if (snapshotError) throw snapshotError

    const historyStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
    const { data: history, error: historyError } = await supabase
      .from('storage_usage_snapshots')
      .select('snapshot_date,captured_at,database_bytes,storage_bytes,object_count')
      .gte('snapshot_date', historyStart)
      .order('snapshot_date', { ascending: true })
    if (historyError) throw historyError

    res.json({
      success: true,
      data: { ...data, history: history || [] },
      message: 'Measured database and object storage metrics loaded.',
    })
  } catch (error) {
    console.error('Storage optimization metrics error:', error)
    res.status(500).json({ success: false, message: 'Unable to load measured storage metrics.' })
  }
})

router.get('/system/performance', protect, requireSuperAdmin, apiLimiter, async (req, res) => {
  const range = String(req.query.range || '1h')
  const rangeOptions = {
    '1h': { duration: 60 * 60 * 1000, bucket: 'minute' },
    '24h': { duration: 24 * 60 * 60 * 1000, bucket: 'hour' },
    '7d': { duration: 7 * 24 * 60 * 60 * 1000, bucket: 'hour' },
    '30d': { duration: 30 * 24 * 60 * 60 * 1000, bucket: 'day' },
  }
  const selectedRange = rangeOptions[range]
  if (!selectedRange) {
    return res.status(400).json({ success: false, data: null, message: 'Unsupported performance range.' })
  }

  try {
    const { data, error } = await supabase.rpc('get_super_admin_performance', {
      from_time: new Date(Date.now() - selectedRange.duration).toISOString(),
      bucket_unit: selectedRange.bucket,
      timezone_name: process.env.TZ || 'UTC',
    })
    if (error) throw error
    res.json({ success: true, data: data || [], range, message: 'Performance history loaded.' })
  } catch (error) {
    console.error('System performance history error:', error)
    res.status(500).json({ success: false, data: null, message: 'Unable to retrieve performance history.' })
  }
})

const readCount = async (table, configureQuery = query => query) => {
  const result = await configureQuery(supabase.from(table).select('id', { count: 'exact', head: true }))
  if (result.error) throw result.error
  return result.count || 0
}

router.get('/analytics/overview', protect, requireSuperAdmin, apiLimiter, async (req, res) => {
  try {
    const [totalStudents, totalAdmins, totalMockTests, totalQuestions, activeExams] = await Promise.all([
      readCount('users', query => query.eq('role', 'student')),
      readCount('users', query => query.eq('role', 'admin')),
      readCount('mock_tests'),
      readCount('questions'),
      readCount('mock_tests', query => query.eq('status', 'active')),
    ])
    res.json({
      success: true,
      data: { totalStudents, totalAdmins, totalMockTests, totalQuestions, activeExams },
      message: 'Analytics overview loaded.',
    })
  } catch (error) {
    console.error('Analytics overview error:', error)
    res.status(500).json({ success: false, data: null, message: 'Unable to load analytics overview.' })
  }
})

const ANALYTICS_RANGES = {
  today: { duration: 24 * 60 * 60 * 1000, bucket: 'day' },
  '7d': { duration: 7 * 24 * 60 * 60 * 1000, bucket: 'day' },
  '30d': { duration: 30 * 24 * 60 * 60 * 1000, bucket: 'day' },
  '3m': { duration: 90 * 24 * 60 * 60 * 1000, bucket: 'day' },
  yearly: { duration: 365 * 24 * 60 * 60 * 1000, bucket: 'month' },
}
const ANALYTICS_METRICS = new Set(['attempts', 'registrations', 'questions', 'exams'])
const readAnalytics = async (req, res, metric) => {
  const range = String(req.query.range || '30d')
  const selectedRange = ANALYTICS_RANGES[range]
  if (!selectedRange) {
    return res.status(400).json({ success: false, data: null, message: 'Unsupported analytics range.' })
  }
  try {
    const fromTime = new Date()
    if (range === 'today') fromTime.setHours(0, 0, 0, 0)
    else fromTime.setTime(Date.now() - selectedRange.duration)
    const { data, error } = await supabase.rpc('get_super_admin_analytics', {
      metric_name: metric,
      from_time: fromTime.toISOString(),
      bucket_unit: selectedRange.bucket,
      timezone_name: process.env.TZ || 'UTC',
    })
    if (error) throw error
    return res.json({ success: true, data: data || [], range, message: `${metric} analytics loaded.` })
  } catch (error) {
    console.error(`${metric} analytics error:`, error)
    return res.status(500).json({ success: false, data: null, message: `Unable to load ${metric} analytics.` })
  }
}

for (const metric of ANALYTICS_METRICS) {
  router.get(`/analytics/${metric}`, protect, requireSuperAdmin, apiLimiter, (req, res) => readAnalytics(req, res, metric))
}

router.get('/activity', protect, requireSuperAdmin, apiLimiter, async (req, res) => {
  try {
    const [adminActions, loginEvents, registrations, tests, attempts] = await Promise.all([
      supabase.from('admin_audit_logs').select('id,admin_name,action,module,status,created_at').order('created_at', { ascending: false }).limit(50),
      supabase.from('login_history').select('id,user_id,event,ip_address,created_at').order('created_at', { ascending: false }).limit(50),
      supabase.from('users').select('id,name,role,created_at').order('created_at', { ascending: false }).limit(50),
      supabase.from('mock_tests').select('id,title,created_at,updated_at').order('updated_at', { ascending: false }).limit(50),
      supabase.from('test_results').select('id,test_name,created_at,attempted_at').order('attempted_at', { ascending: false }).limit(50),
    ])
    const failed = [adminActions, loginEvents, registrations, tests, attempts].find(result => result.error)
    if (failed) throw failed.error

    const events = [
      ...(adminActions.data || []).map(row => ({
        id: `admin-${row.id}`, type: 'admin_action', description: `${row.admin_name}: ${row.action}`,
        created_at: row.created_at, status: row.status,
      })),
      ...(loginEvents.data || []).map(row => ({
        id: `login-${row.id}`, type: 'authentication', description: `User ${row.event}`,
        created_at: row.created_at,
      })),
      ...(registrations.data || []).map(row => ({
        id: `registration-${row.id}`, type: 'registration', description: `${row.role === 'admin' ? 'Administrator' : 'Student'} registered: ${row.name}`,
        created_at: row.created_at,
      })),
      ...(tests.data || []).map(row => ({
        id: `test-${row.id}`, type: 'mock_test', description: `Mock test updated: ${row.title}`,
        created_at: row.updated_at || row.created_at,
      })),
      ...(attempts.data || []).map(row => ({
        id: `attempt-${row.id}`, type: 'test_attempt', description: `Test submitted: ${row.test_name}`,
        created_at: row.attempted_at || row.created_at,
      })),
    ]
    events.sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    res.json({ success: true, data: events.slice(0, 50), message: 'Recent activity loaded.' })
  } catch (error) {
    console.error('Super Admin activity error:', error)
    res.status(500).json({ success: false, data: null, message: 'Unable to retrieve recent activity.' })
  }
})

router.get('/system/logs', protect, requireSuperAdmin, apiLimiter, async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200)
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0)
  const severity = String(req.query.severity || 'all').toLowerCase()
  const search = String(req.query.search || '').trim().slice(0, 120)
  if (!['all', 'error', 'warning', 'info'].includes(severity)) {
    return res.status(400).json({ success: false, data: null, message: 'Unsupported log severity.' })
  }

  try {
    let query = supabase.from('api_usage_logs')
      .select('id,endpoint,method,status_code,response_time_ms,created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
    if (severity === 'error') query = query.gte('status_code', 500)
    if (severity === 'warning') query = query.gte('status_code', 400).lt('status_code', 500)
    if (severity === 'info') query = query.lt('status_code', 400)
    if (search) query = query.ilike('endpoint', `%${search.replace(/[%_]/g, '\\$&')}%`)
    const { data, error, count } = await query.range(offset, offset + limit - 1)
    if (error) throw error
    res.json({
      success: true,
      data: (data || []).map(row => ({
        ...row,
        severity: row.status_code >= 500 ? 'error' : row.status_code >= 400 ? 'warning' : 'info',
        message: `${row.method} ${row.endpoint} returned ${row.status_code} in ${row.response_time_ms}ms`,
      })),
      total: count || 0,
      limit,
      offset,
      message: 'System logs loaded.',
    })
  } catch (error) {
    console.error('System logs error:', error)
    res.status(500).json({ success: false, data: null, message: 'Unable to retrieve system logs.' })
  }
})

router.get('/system/config', protect, requireSuperAdmin, apiLimiter, (req, res) => {
  res.json({
    success: true,
    data: {
      environment: process.env.NODE_ENV || 'development',
      runtime: 'Node.js',
      nodeVersion: process.version,
      applicationVersion: packageInfo.version,
      port: Number(process.env.PORT || 5000),
      database: 'Supabase (PostgreSQL)',
      databaseConfigured: Boolean(process.env.SUPABASE_URL),
      redisConfigured: Boolean(process.env.REDIS_URL),
      csrfProtection: true,
      sessionStorage: 'HTTP-only signed cookies',
    },
    message: 'Safe system configuration loaded.',
  })
})

router.get('/system/services', protect, requireSuperAdmin, apiLimiter, async (req, res) => {
  const redis = getRedisStatus()
  let database = { status: 'unknown', uptime: null }
  try {
    const startedAt = Date.now()
    const { error } = await supabase.from('users').select('id', { head: true, count: 'exact' })
    if (error) throw error
    database = { status: 'running', responseTimeMs: Date.now() - startedAt }
  } catch {
    database = { status: 'unknown', reason: 'Database health check failed' }
  }

  res.json({
    success: true,
    data: [
      {
        id: 'web',
        name: 'Reverse Proxy',
        status: 'unknown',
        reason: 'Reverse proxy status is managed outside this Node.js process.',
        controllable: false,
      },
      { id: 'application', name: 'Application Server', status: 'running', uptime: process.uptime(), controllable: false },
      { id: 'database', name: 'Database', ...database, controllable: false },
      { id: 'redis', name: 'Redis Cache', ...redis, controllable: false },
      {
        id: 'queue',
        name: 'Queue Worker',
        status: 'unknown',
        reason: 'No queue worker is configured in this application.',
        controllable: false,
      },
      {
        id: 'service-control',
        name: 'Service Control',
        status: 'unavailable',
        reason: 'Service control unavailable in this hosting environment.',
        controllable: false,
      },
    ],
    message: 'Service status loaded.',
  })
})

router.get('/server/maintenance', protect, requireSuperAdmin, apiLimiter, async (req, res) => {
  try {
    const { data, error } = await supabase.from('system_settings')
      .select('key,value,updated_at,updated_by')
      .in('key', ['maintenance_mode', 'maintenance_reason'])
    if (error) throw error
    const settings = Object.fromEntries((data || []).map(row => [row.key, row]))
    res.json({
      success: true,
      data: {
        enabled: settings.maintenance_mode?.value === true || settings.maintenance_mode?.value === 'true',
        message: typeof settings.maintenance_reason?.value === 'string' ? settings.maintenance_reason.value : '',
        updatedAt: settings.maintenance_mode?.updated_at || null,
        updatedBy: settings.maintenance_mode?.updated_by || null,
      },
      message: 'Maintenance settings loaded.',
    })
  } catch (error) {
    console.error('Maintenance settings read error:', error)
    res.status(500).json({ success: false, data: null, message: 'Unable to retrieve maintenance settings.' })
  }
})
// -------------------------------------------------------------
// 2. 1-CLICK ADMIN LOCK & FORCE LOGOUT
// -------------------------------------------------------------
router.post('/admins/:id/lock', protect, requireSuperAdmin, validateCsrfToken, apiLimiter, async (req, res) => {
  const targetId = req.params.id
  const reason = String(req.body?.reason || 'Account access suspended by Super Admin.').trim().slice(0, 500)

  // Prevent self-lock
  if (targetId === (req.user.id || req.user._id)) {
    return res.status(400).json({ success: false, message: 'You cannot lock your own Super Admin account.' })
  }

  try {
    // 1. Update user record
    const { data: targetUser, error: updateError } = await supabase
      .from('users')
      .update({
        is_locked: true,
        locked_reason: reason,
        locked_at: new Date().toISOString(),
        locked_by: req.user.id || req.user._id,
      })
      .eq('id', targetId)
      .eq('role', 'admin')
      .select('id, name, email, role, admin_role, is_locked')
      .maybeSingle()

    if (updateError) throw updateError
    if (!targetUser) return res.status(404).json({ success: false, message: 'Administrator not found.' })

    // 2. Force logout: Terminate and delete all active sessions immediately
    await deleteUserSessions(targetId)

    // 3. Create security alert
    const { error: alertError } = await supabase.from('security_alerts').insert({
      alert_type: 'ADMIN_LOCKED',
      severity: 'high',
      description: `Administrator ${targetUser.email} (${targetUser.name}) was locked by ${req.user.name || 'Super Admin'}. Reason: ${reason}`,
      metadata: { targetId, lockedBy: req.user.id, reason },
      status: 'active',
    })
    if (alertError) throw alertError

    await recordSuperAdminAction(req, `1-Click Lock: Suspended admin ${targetUser.email} - Reason: ${reason}`, 'Admin Lock')

    res.json({
      success: true,
      message: `Administrator ${targetUser.name} has been locked and all active sessions were terminated.`,
      admin: targetUser,
    })
  } catch (error) {
    console.error('Lock admin error:', error)
    res.status(500).json({ success: false, message: 'Failed to lock administrator.' })
  }
})

router.post('/admins/:id/unlock', protect, requireSuperAdmin, validateCsrfToken, apiLimiter, async (req, res) => {
  const targetId = req.params.id

  try {
    const { data: targetUser, error: updateError } = await supabase
      .from('users')
      .update({
        is_locked: false,
        locked_reason: null,
        locked_at: null,
        locked_by: null,
      })
      .eq('id', targetId)
      .eq('role', 'admin')
      .select('id, name, email, role, admin_role, is_locked')
      .maybeSingle()

    if (updateError) throw updateError
    if (!targetUser) return res.status(404).json({ success: false, message: 'Administrator not found.' })

    await recordSuperAdminAction(req, `Unlocked administrator ${targetUser.email}`, 'Admin Lock')

    res.json({
      success: true,
      message: `Administrator ${targetUser.name} is now unlocked.`,
      admin: targetUser,
    })
  } catch (error) {
    console.error('Unlock admin error:', error)
    res.status(500).json({ success: false, message: 'Failed to unlock administrator.' })
  }
})

router.post('/admins/:id/force-logout', protect, requireSuperAdmin, validateCsrfToken, apiLimiter, async (req, res) => {
  const targetId = req.params.id

  try {
    const { data: targetUser, error: lookupError } = await supabase
      .from('users')
      .select('id, name, email')
      .eq('id', targetId)
      .eq('role', 'admin')
      .maybeSingle()
    if (lookupError) throw lookupError
    if (!targetUser) return res.status(404).json({ success: false, message: 'User not found.' })

    await deleteUserSessions(targetId)
    await recordSuperAdminAction(req, `Force logged out admin ${targetUser.email}`, 'Admin Sessions')

    res.json({
      success: true,
      message: `All active sessions for ${targetUser.name} have been revoked.`,
    })
  } catch (error) {
    console.error('Force logout error:', error)
    res.status(500).json({ success: false, message: 'Failed to terminate sessions.' })
  }
})

// -------------------------------------------------------------
// 3. SERVER & INFRASTRUCTURE CONTROL
// -------------------------------------------------------------
router.get('/server/status', protect, requireSuperAdmin, apiLimiter, async (req, res) => {
  try {
    const metrics = await getSystemMetrics()
    const cpus = os.cpus()
    const memoryUsage = process.memoryUsage()

    res.json({
      success: true,
      server: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        nodeVersion: process.version,
        applicationVersion: packageInfo.version,
        environment: process.env.NODE_ENV || 'development',
        processId: process.pid,
        database: 'Supabase (PostgreSQL)',
        databaseVersion: null,
        serverTime: new Date().toISOString(),
        uptimeSeconds: metrics.uptimeSeconds,
        processUptimeSeconds: metrics.processUptimeSeconds,
        loadAverage: metrics.loadAverage,
        loadLabel: metrics.loadLabel,
        loadUnavailableReason: metrics.loadUnavailableReason,
        cpuUsage: metrics.cpuUsage,
        cpuUnavailableReason: metrics.cpuUnavailableReason,
        cpuCores: metrics.cpuCores,
        diskUsedGB: metrics.diskUsedGB,
        diskTotalGB: metrics.diskTotalGB,
        diskUsage: metrics.diskUsage,
        diskUnavailableReason: metrics.diskUnavailableReason,
        cpu: {
          count: metrics.cpuCores,
          model: cpus[0]?.model || null,
          speedMHz: cpus[0]?.speed || null,
        },
        systemMemory: {
          totalMB: metrics.memoryTotalGB === null ? null : Math.round(metrics.memoryTotalGB * 1024),
          usedMB: metrics.memoryUsedGB === null ? null : Math.round(metrics.memoryUsedGB * 1024),
          freeMB: metrics.memoryTotalGB === null || metrics.memoryUsedGB === null
            ? null
            : Math.round((metrics.memoryTotalGB - metrics.memoryUsedGB) * 1024),
          usagePercent: metrics.memoryUsage,
        },
        processMemory: {
          rssMB: Math.round(memoryUsage.rss / (1024 * 1024)),
          heapTotalMB: Math.round(memoryUsage.heapTotal / (1024 * 1024)),
          heapUsedMB: Math.round(memoryUsage.heapUsed / (1024 * 1024)),
          externalMB: Math.round(memoryUsage.external / (1024 * 1024)),
        },
        timestamp: new Date().toISOString(),
      }
    })
  } catch (error) {
    console.error('Server status error:', error)
    res.status(500).json({ success: false, message: 'Failed to retrieve server metrics.' })
  }
})

router.post('/server/clear-cache', protect, requireSuperAdmin, validateCsrfToken, apiLimiter, async (req, res) => {
  const cacheType = String(req.body?.type || '')
  const supportedTypes = new Set(['application', 'config', 'view', 'redis'])
  if (!supportedTypes.has(cacheType)) {
    return res.status(400).json({ success: false, message: 'Unsupported cache type.' })
  }
  const redisUnavailable = cacheType === 'redis' && !process.env.REDIS_URL
  const message = redisUnavailable
    ? 'Redis is not configured.'
    : cacheType === 'redis'
      ? 'Redis is currently used for rate limiting; clearing it is disabled to avoid invalidating shared rate-limit state.'
    : `The application does not configure a separate ${cacheType} cache.`
  try {
    await recordSuperAdminAction(req, `Cache clear unavailable: ${cacheType}`, 'Cache Management', 'Unavailable')
    return res.status(redisUnavailable ? 503 : 501).json({ success: false, message })
  } catch (error) {
    console.error('Cache audit error:', error)
    return res.status(500).json({ success: false, message: 'Failed to record cache operation.' })
  }
})

router.post('/server/maintenance', protect, requireSuperAdmin, validateCsrfToken, apiLimiter, async (req, res) => {
  const { enabled, reason } = req.body
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ success: false, message: 'Maintenance mode must be a boolean value.' })
  }
  try {
    const isMaintenance = enabled
    const maintenanceMessage = typeof reason === 'string' ? reason.trim().slice(0, 500) : ''
    const now = new Date().toISOString()
    const { error } = await supabase.from('system_settings').upsert([
      { key: 'maintenance_mode', value: isMaintenance, updated_by: req.user.id, updated_at: now },
      { key: 'maintenance_reason', value: maintenanceMessage, updated_by: req.user.id, updated_at: now }
    ], { onConflict: 'key' })
    if (error) throw error
    invalidateMaintenanceSetting()
    await recordSuperAdminAction(
      req,
      `${isMaintenance ? 'Enabled' : 'Disabled'} Maintenance Mode${maintenanceMessage ? ` - ${maintenanceMessage}` : ''}`,
      'Server Control'
    )
    res.json({
      success: true,
      maintenanceMode: isMaintenance,
      message: `Maintenance mode ${isMaintenance ? 'activated' : 'deactivated'}.`
    })
  } catch (error) {
    console.error('Toggle maintenance error:', error)
    res.status(500).json({ success: false, message: 'Failed to update maintenance mode.' })
  }
})

// -------------------------------------------------------------
// 4. API USAGE & ANALYTICS
// -------------------------------------------------------------
router.get('/api-analytics', protect, requireSuperAdmin, apiLimiter, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500)

    const [recentLogs, totalResult, error4xxResult, error5xxResult, rateLimitResult] = await Promise.all([
      supabase.from('api_usage_logs')
        .select('id,user_id,endpoint,method,status_code,response_time_ms,ip_address,created_at')
        .order('created_at', { ascending: false })
        .limit(limit),
      supabase.from('api_usage_logs').select('id', { count: 'exact', head: true }),
      supabase.from('api_usage_logs').select('id', { count: 'exact', head: true }).gte('status_code', 400).lt('status_code', 500),
      supabase.from('api_usage_logs').select('id', { count: 'exact', head: true }).gte('status_code', 500),
      supabase.from('api_usage_logs').select('id', { count: 'exact', head: true }).eq('status_code', 429),
    ])
    const failedQuery = [recentLogs, totalResult, error4xxResult, error5xxResult, rateLimitResult]
      .find(result => result.error)
    if (failedQuery) throw failedQuery.error

    // Group logs by endpoint for top endpoints summary
    const endpointCounts = {}
    const logs = recentLogs.data || []
    for (const log of logs) {
      const ep = log.endpoint || 'unknown'
      if (!endpointCounts[ep]) {
        endpointCounts[ep] = { count: 0, totalResponseTime: 0, method: log.method }
      }
      endpointCounts[ep].count += 1
      endpointCounts[ep].totalResponseTime += (log.response_time_ms || 0)
    }

    const topEndpoints = Object.entries(endpointCounts)
      .map(([endpoint, data]) => ({
        endpoint,
        method: data.method,
        count: data.count,
        avgResponseTimeMs: Math.round(data.totalResponseTime / data.count),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
    const responseTimes = logs
      .map(log => Number(log.response_time_ms))
      .filter(value => Number.isFinite(value) && value >= 0)
    const adminRequestCounts = new Map()
    for (const log of logs) {
      if (log.user_id) adminRequestCounts.set(log.user_id, (adminRequestCounts.get(log.user_id) || 0) + 1)
    }
    const adminIds = [...adminRequestCounts.keys()]
    let topAdmins = []
    if (adminIds.length) {
      const { data: adminUsers, error: adminUsersError } = await supabase
        .from('users')
        .select('id,name,email')
        .eq('role', 'admin')
        .in('id', adminIds)
      if (adminUsersError) throw adminUsersError
      topAdmins = (adminUsers || [])
        .map(admin => ({
          id: admin.id,
          name: admin.name,
          email: admin.email,
          count: adminRequestCounts.get(admin.id) || 0,
        }))
        .sort((left, right) => right.count - left.count)
        .slice(0, 10)
    }

    res.json({
      success: true,
      analytics: {
        totalRequests: totalResult.count || 0,
        clientErrors4xx: error4xxResult.count || 0,
        serverErrors5xx: error5xxResult.count || 0,
        successfulRequests: Math.max(0, (totalResult.count || 0) - (error4xxResult.count || 0) - (error5xxResult.count || 0)),
        rateLimitHits: rateLimitResult.count || 0,
        averageResponseTimeMs: responseTimes.length
          ? Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length)
          : null,
        rateLimit: req.rateLimit
          ? {
              limit: req.rateLimit.limit,
              used: req.rateLimit.used,
              remaining: req.rateLimit.remaining,
              windowMs: API_RATE_LIMIT_WINDOW_MS,
              resetAt: req.rateLimit.resetTime?.toISOString() || null,
              storage: getRedisStatus().status === 'running'
                ? 'Shared Redis'
                : process.env.REDIS_URL
                  ? 'Redis connection unavailable'
                  : 'This API process only',
            }
          : null,
        lastCall: logs[0] || null,
        topEndpoints,
        topAdmins,
        recentLogs: logs,
      }
    })
  } catch (error) {
    console.error('API analytics error:', error)
    res.status(500).json({ success: false, message: 'Failed to load API analytics.' })
  }
})

// -------------------------------------------------------------
// 5. DATA BACKUP & RESTORE
// -------------------------------------------------------------
router.get('/backups', protect, requireSuperAdmin, apiLimiter, async (req, res) => {
  try {
    const { data: logs, error } = await supabase
      .from('backup_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw error
    res.json({ success: true, backups: logs || [] })
  } catch (error) {
    console.error('Get backups error:', error)
    res.status(500).json({ success: false, message: 'Failed to retrieve backup history.' })
  }
})

router.post('/backups/create', protect, requireSuperAdmin, validateCsrfToken, apiLimiter, async (req, res) => {
  const backupType = req.body.type || 'full_db'
  const backupTables = ['users', 'questions', 'mock_tests', 'test_results', 'system_settings', 'admin_audit_logs']

  try {
    // 1. Fetch tables
    const tablePromises = backupTables.map(async (table) => {
      const select = table === 'users'
        ? 'id,name,email,phone,branch,batch,role,admin_role,status,mhcet_id,photo,approved_at,rejected_at,is_locked,locked_reason,locked_at,created_at,updated_at'
        : '*'
      const { data, error } = await supabase.from(table).select(select).limit(50000)
      if (error) throw error
      return [table, data || []]
    })

    const results = await Promise.all(tablePromises)
    const tablesData = Object.fromEntries(results)

    const timestamp = new Date().toISOString()
    const fileName = `cet_portal_backup_${timestamp.replace(/[:.]/g, '-')}.json`
    const content = JSON.stringify({
      version: '1.0',
      timestamp,
      backupType,
      triggeredBy: req.user.email,
      tables: tablesData,
    })

    const fileSizeBytes = Buffer.byteLength(content, 'utf8')

    // 2. Record in backup_logs
    const { data: logEntry, error: logError } = await supabase
      .from('backup_logs')
      .insert({
        backup_type: backupType,
        file_name: fileName,
        file_size_bytes: fileSizeBytes,
        storage_path: 'local_client_snapshot',
        status: 'completed',
        triggered_by: req.user.id || req.user._id,
      })
      .select()
      .single()

    if (logError) throw logError

    await recordSuperAdminAction(req, `Generated database backup: ${fileName} (${(fileSizeBytes / 1024).toFixed(1)} KB)`, 'Data Backup')

    res.json({
      success: true,
      backup: logEntry,
      content,
      fileName,
      sizeBytes: fileSizeBytes,
      message: 'Backup generated successfully.',
    })
  } catch (error) {
    console.error('Backup generation error:', error)
    res.status(500).json({ success: false, message: 'Failed to generate backup.' })
  }
})

// -------------------------------------------------------------
// 6. SECURITY ALERTS & MONITORING
// -------------------------------------------------------------
router.get('/security-alerts', protect, requireSuperAdmin, apiLimiter, async (req, res) => {
  const status = req.query.status || 'all'
  const severity = req.query.severity || 'all'

  try {
    let query = supabase.from('security_alerts').select('*').order('created_at', { ascending: false }).limit(100)
    if (status !== 'all') {
      query = query.eq('status', status)
    }
    if (severity !== 'all') {
      query = query.eq('severity', severity)
    }

    const { data, error } = await query
    if (error) throw error

    res.json({ success: true, alerts: data || [] })
  } catch (error) {
    console.error('Security alerts error:', error)
    res.status(500).json({ success: false, message: 'Failed to retrieve security alerts.' })
  }
})

router.put('/security-alerts/:id/resolve', protect, requireSuperAdmin, validateCsrfToken, apiLimiter, async (req, res) => {
  const alertId = req.params.id

  try {
    const { data, error } = await supabase
      .from('security_alerts')
      .update({
        status: 'resolved',
        resolved_by: req.user.id || req.user._id,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', alertId)
      .select()
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ success: false, message: 'Alert not found.' })

    await recordSuperAdminAction(req, `Resolved security alert (${data.alert_type}): ${data.description.slice(0, 100)}`, 'Security Alerts')

    res.json({ success: true, alert: data, message: 'Security alert resolved.' })
  } catch (error) {
    console.error('Resolve alert error:', error)
    res.status(500).json({ success: false, message: 'Failed to resolve security alert.' })
  }
})

module.exports = router
