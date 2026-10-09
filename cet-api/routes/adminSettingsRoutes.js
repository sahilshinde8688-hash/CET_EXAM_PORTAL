const express = require('express')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const supabase = require('../config/supabase')
const { protect, adminOnly } = require('../middleware/auth')
const { apiLimiter } = require('../middleware/rateLimit')
const { validateCsrfToken } = require('../middleware/csrf')
const { getEffectiveAdminRole, isSuperAdminUser, SUPER_ADMIN_EMAIL } = require('../utils/adminRoles')
const db = require('../services/dbService')
const { SESSION_INACTIVITY_TIMEOUT_SECONDS } = require('../config/auth')

const router = express.Router()
const backupTables = new Set(['users', 'questions', 'mock_tests', 'test_results', 'system_settings', 'admin_audit_logs'])
const basicAdminRoles = new Set(['Basic Admin', 'ADMIN', 'Exam Manager', 'Question Manager', 'Analyst', 'Support Staff', 'EXAM_MANAGER', 'QUESTION_MANAGER', 'ANALYST', 'SUPPORT'])
const recordAdminAction = async (req, action, module) => {
  const { error } = await supabase.from('admin_audit_logs').insert({
    admin_id: req.user.id || req.user._id,
    admin_name: req.user.name || 'Admin',
    action,
    module,
    ip_address: req.ip || 'Internal',
    status: 'Success',
  })
  if (error) throw error
}

router.get('/', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    const [settingsResult, adminsResult, auditResult, usersCountResult] = await Promise.all([
      supabase.from('system_settings').select('key,value'),
      supabase.from('users').select('id,name,email,role,admin_role,status,created_at').eq('role', 'admin').order('created_at', { ascending: false }),
      supabase.from('admin_audit_logs').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('users').select('id', { count: 'exact', head: true }),
    ])

    const error = settingsResult.error || adminsResult.error || auditResult.error || usersCountResult.error
    if (error) throw error

    const settings = Object.fromEntries((settingsResult.data || [])
      .filter(row => !/password|secret|token|api[_-]?key/i.test(row.key))
      .map(row => [row.key, row.value]))
    const configuredTimeout = Number(settings.session_timeout)
    settings.session_timeout = Number.isSafeInteger(configuredTimeout) && configuredTimeout >= 1 && configuredTimeout <= 1440
      ? configuredTimeout
      : SESSION_INACTIVITY_TIMEOUT_SECONDS / 60
    res.json({
      settings,
      admins: (adminsResult.data || [])
        .filter(admin => isSuperAdminUser(req.user) || admin.email.toLowerCase() !== SUPER_ADMIN_EMAIL)
        .map(admin => ({
        ...admin,
        admin_role: getEffectiveAdminRole({ role: admin.role, email: admin.email, adminRole: admin.admin_role }),
      })),
      auditLogs: auditResult.data || [],
      userCount: usersCountResult.count || 0,
    })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Unable to load administrator settings.' })
  }
})

router.put('/', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  const settings = req.body?.settings
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return res.status(400).json({ success: false, message: 'Settings must be an object.' })
  }

  const entries = Object.entries(settings)
  if (!entries.length || entries.some(([key, value]) =>
    !/^[a-z][a-z0-9_]{0,63}$/.test(key) || /password|secret|token|api_key/i.test(key) ||
    !['string', 'number', 'boolean'].includes(typeof value) ||
    (key === 'session_timeout' && (!Number.isSafeInteger(value) || value < 1 || value > 1440))
  )) {
    return res.status(400).json({ success: false, message: 'One or more settings are invalid. The inactivity timeout must be 1 to 1440 minutes.' })
  }

  try {
    const now = new Date().toISOString()
    const rows = entries.map(([key, value]) => ({
      key,
      value,
      updated_by: req.user.id || req.user._id,
      updated_at: now,
    }))
    const { error } = await supabase.from('system_settings').upsert(rows, { onConflict: 'key' })
    if (error) throw error
    if (entries.some(([key]) => key === 'session_timeout')) db.invalidateSessionTimeoutCache()
    await recordAdminAction(req, 'Updated settings', 'System settings')
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Unable to save administrator settings.' })
  }
})

router.post('/admins', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 100)
  const email = String(req.body?.email || '').trim().toLowerCase()
  const requestedRole = String(req.body?.role || '')
  const clusterId = String(req.body?.clusterId || 'default').trim()
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !clusterId || clusterId.length > 50 || /[\u0000-\u001f\u007f]/.test(clusterId)) {
    return res.status(400).json({ success: false, message: 'Enter a valid name, email, role, and cluster.' })
  }
  if (requestedRole === 'Super Admin' && email !== SUPER_ADMIN_EMAIL) {
    return res.status(400).json({ success: false, message: 'Only the configured Super Admin email can have the Super Admin role.' })
  }
  if (!basicAdminRoles.has(requestedRole) && requestedRole !== 'Super Admin') {
    return res.status(400).json({ success: false, message: 'Select Basic Admin or the configured Super Admin role.' })
  }
  if (email === SUPER_ADMIN_EMAIL && !isSuperAdminUser(req.user)) {
    return res.status(403).json({ success: false, message: 'Only the existing Super Admin can provision the Super Admin account.' })
  }
  const adminRole = email === SUPER_ADMIN_EMAIL ? 'Super Admin' : 'ADMIN'

  try {
    const { data: existing, error: lookupError } = await supabase.from('users').select('id').eq('email', email).maybeSingle()
    if (lookupError) throw lookupError
    if (existing) return res.status(409).json({ success: false, message: 'An account with this email already exists.' })

    const temporaryPassword = crypto.randomBytes(12).toString('base64url')
    const password = await bcrypt.hash(temporaryPassword, 10)
    const { data, error } = await supabase.from('users').insert({
      name,
      email,
      password,
      role: 'admin',
      admin_role: adminRole,
      cluster_id: clusterId,
      is_locked: false,
      locked_reason: null,
      status: 'approved',
      must_reset_password: true,
    }).select('id,name,email,phone,role,admin_role,status,is_locked,locked_reason,cluster_id,created_at').single()
    if (error) throw error
    await recordAdminAction(req, `Added administrator ${email}`, 'Admin & roles')
    res.status(201).json({ success: true, admin: data, temporaryPassword })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Unable to create the administrator account.' })
  }
})

router.delete('/admins/:id', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  if (req.params.id === (req.user.id || req.user._id)) {
    return res.status(400).json({ success: false, message: 'You cannot remove your own administrator account.' })
  }

  try {
    const { data: targetAdmin, error: lookupError } = await supabase
      .from('users')
      .select('id,email')
      .eq('id', req.params.id)
      .eq('role', 'admin')
      .maybeSingle()
    if (lookupError) throw lookupError
    if (!targetAdmin) return res.status(404).json({ success: false, message: 'Administrator not found.' })
    if (targetAdmin.email.toLowerCase() === SUPER_ADMIN_EMAIL) {
      return res.status(403).json({ success: false, message: 'The configured Super Admin account cannot be removed.' })
    }

    const { count, error: countError } = await supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin')
    if (countError) throw countError
    if ((count || 0) <= 1) return res.status(409).json({ success: false, message: 'The last administrator cannot be removed.' })

    const { data, error } = await supabase.from('users').delete().eq('id', req.params.id).eq('role', 'admin').select('id').maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ success: false, message: 'Administrator not found.' })
    await recordAdminAction(req, `Removed administrator ${req.params.id}`, 'Admin & roles')
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Unable to remove the administrator account.' })
  }
})

router.get('/data/:table', protect, adminOnly, apiLimiter, async (req, res) => {
  const { table } = req.params
  if (!backupTables.has(table)) return res.status(400).json({ success: false, message: 'This table cannot be exported.' })

  try {
    const select = table === 'users'
      ? 'id,name,email,phone,branch,batch,role,admin_role,status,mhcet_id,photo,approved_at,rejected_at,created_at,updated_at'
      : '*'
    const { data, error } = await supabase.from(table).select(select).limit(10000)
    if (error) throw error
    const safeData = table === 'system_settings'
      ? (data || []).filter(row => !/password|secret|token|api[_-]?key/i.test(row.key))
      : table === 'users'
        ? (data || []).map(user => ({
          ...user,
          admin_role: getEffectiveAdminRole({ role: user.role, email: user.email, adminRole: user.admin_role }),
        }))
        : data || []
    res.json(safeData)
  } catch (error) {
    res.status(500).json({ success: false, message: `Unable to export ${table}.` })
  }
})

module.exports = router