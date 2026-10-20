import { useEffect, useMemo, useState } from 'react'
import { adminSettingsAPI, getApiUrl, notificationsAPI, type NotificationPage } from '../lib/api'
import '../adminSettings.css'
import '../adminEmailNotifications.css'
import '../adminSettingsLayout.css'

type SectionKey = 'general' | 'roles' | 'security' | 'ai' | 'notifications' | 'integrations' | 'branding' | 'features' | 'backup' | 'audit' | 'health'
type SettingsData = Record<string, string | boolean | number>
type AdminRecord = { id: string; name: string; email: string; role: string; admin_role?: string; status: string; created_at: string }
type AuditRecord = { id: string; admin_name: string; action: string; module: string; created_at: string; ip_address: string; status: string }
type HealthState = {
  api: { status: string; value: string }
  database: { status: string; value: string; count: number }
}
type BackupInfo = { createdAt: string | null; size: number; tables: number }
type EmailNotificationRow = {
  id: string
  notification_type: string
  student_id: string | null
  student_name: string | null
  test_result_id: string | null
  exam_name: string | null
  recipient_email: string
  status: 'pending' | 'accepted' | 'delivered' | 'failed' | 'unknown' | 'cancelled'
  safe_error: string | null
  retry_count: number
  last_attempt_at: string | null
  created_at: string
}
type EmailConfiguration = {
  senderEmail: string
  senderName: string
  serviceUrlConfigured: boolean
  serviceTokenConfigured: boolean
  ready: boolean
  error: string | null
  setupEncryptionConfigured: boolean
}

const backupTables = ['users', 'questions', 'mock_tests', 'test_results', 'system_settings', 'admin_audit_logs'] as const

const formatUptime = (seconds: number) => {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

const formatBytes = (bytes: number) => {
  if (!bytes) return 'No backup created'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const downloadFile = (content: string, filename: string, type: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const toCsv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return 'No records found\n'
  const columns = Array.from(new Set(rows.flatMap(row => Object.keys(row))))
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
  return [columns.map(escape).join(','), ...rows.map(row => columns.map(column => escape(row[column])).join(','))].join('\n')
}

const sections: Array<{ key: SectionKey; label: string; icon: string; description: string }> = [
  { key: 'general', label: 'Portal configuration', icon: 'tune', description: 'Core identity and operating mode' },
  { key: 'roles', label: 'Admin & roles', icon: 'admin_panel_settings', description: 'Administrators and permissions' },
  { key: 'security', label: 'Security', icon: 'shield_lock', description: 'Authentication and session controls' },
  { key: 'ai', label: 'AI configuration', icon: 'auto_awesome', description: 'Providers, models, and usage' },
  { key: 'notifications', label: 'Notifications', icon: 'notifications', description: 'Communication preferences' },
  { key: 'integrations', label: 'Integrations & APIs', icon: 'hub', description: 'Connected services and webhooks' },
  { key: 'branding', label: 'Branding & appearance', icon: 'palette', description: 'Visual identity and sign-in style' },
  { key: 'features', label: 'Feature control', icon: 'toggle_on', description: 'Platform-wide switches' },
  { key: 'backup', label: 'Backup & data', icon: 'backup', description: 'Recovery and retention' },
  { key: 'audit', label: 'Audit logs', icon: 'manage_search', description: 'Trace administrative activity' },
  { key: 'health', label: 'System health', icon: 'monitor_heart', description: 'Live service status' },
]

const defaults: SettingsData = {
  portal_name: 'CETNova', tagline: 'Prepare smarter. Perform better.', admin_email: '', support_contact: '', maintenance_mode: false,
  two_factor: true, login_attempt_limit: 5, session_timeout: 30, captcha: false, force_password_change: false,
  ai_provider: 'OpenAI', ai_model: 'gpt-4o-mini', ai_enabled: true, ai_daily_limit: 1000, ai_question_generator: true, ai_doubt_solver: true, ai_performance_analysis: true,
  email_notifications: true, in_app_notifications: true, registration_notifications: true, completion_notifications: true, result_notifications: true, announcements: true,
  transactional_result_emails_enabled: true, parent_result_emails_enabled: false, student_welcome_emails_enabled: true,
  google_oauth: false, smtp_host: '', smtp_port: 587, external_api_url: '', webhook_url: '',
  primary_color: '#2563eb', secondary_color: '#0f172a', dark_mode: false, login_branding: true,
  student_registration: true, mock_test_system: true, google_login: false, result_publishing: true, new_user_registration: true, email_notifications_feature: true,
  retention_days: 365,
}

const roles = ['Basic Admin']
const permissions = ['View', 'Create', 'Edit', 'Delete', 'Export', 'Settings']

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`as-toggle${checked ? ' as-toggle--on' : ''}`} onClick={() => onChange(!checked)}><span /></button>
}

function Field({ label, value, onChange, type = 'text', placeholder, readOnly = false, min, max }: { label: string; value: string | number; onChange: (value: string) => void; type?: string; placeholder?: string; readOnly?: boolean; min?: number; max?: number }) {
  return <label className="as-field"><span>{label}</span><input type={type} value={value} placeholder={placeholder} readOnly={readOnly} min={min} max={max} onChange={event => onChange(event.target.value)} /></label>
}

function SwitchRow({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="as-switch-row"><div><strong>{label}</strong>{description && <small>{description}</small>}</div><Toggle checked={checked} onChange={onChange} label={label} /></div>
}

export default function AdminSettings() {
  const [active, setActive] = useState<SectionKey>('general')
  const [settings, setSettings] = useState<SettingsData>(defaults)
  const [admins, setAdmins] = useState<AdminRecord[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('All')
  const [adminModal, setAdminModal] = useState(false)
  const [confirmAction, setConfirmAction] = useState('')
  const [adminToRemove, setAdminToRemove] = useState<string | null>(null)
  const [newAdmin, setNewAdmin] = useState({ name: '', email: '', role: 'Basic Admin' })
  const [showKey, setShowKey] = useState(false)
  const [health, setHealth] = useState<HealthState>({ api: { status: 'gray', value: 'Checking...' }, database: { status: 'gray', value: 'Checking...', count: 0 } })
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [backupInfo, setBackupInfo] = useState<BackupInfo>({ createdAt: null, size: 0, tables: 0 })
  const [backupBusy, setBackupBusy] = useState(false)
  const [emailConfiguration, setEmailConfiguration] = useState<EmailConfiguration | null>(null)
  const [emailNotifications, setEmailNotifications] = useState<EmailNotificationRow[]>([])
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailAction, setEmailAction] = useState<'validate' | 'test' | null>(null)
  const [emailServiceValidation, setEmailServiceValidation] = useState<'unchecked' | 'valid' | 'invalid'>('unchecked')
  const [emailServiceMessage, setEmailServiceMessage] = useState('')
  const [retryingNotification, setRetryingNotification] = useState<string | null>(null)
  const [announcementTitle, setAnnouncementTitle] = useState('')
  const [announcementMessage, setAnnouncementMessage] = useState('')
  const [announcementPage, setAnnouncementPage] = useState<NotificationPage>('dashboard')
  const [announcementRequestId, setAnnouncementRequestId] = useState<string | null>(null)
  const [publishingAnnouncement, setPublishingAnnouncement] = useState(false)
  const activeSection = sections.find(section => section.key === active) || sections[0]

  const loadEmailNotifications = async () => {
    setEmailLoading(true)
    try {
      const result = await adminSettingsAPI.getEmailNotifications()
      setEmailConfiguration(result.configuration)
      setEmailNotifications(result.notifications)
    } catch (emailError) {
      setError(emailError instanceof Error ? emailError.message : 'Unable to load email notification activity.')
    } finally {
      setEmailLoading(false)
    }
  }

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const apiHealthRequest = fetch(`${getApiUrl()}/health`).then(async response => ({ ok: response.ok, payload: response.ok ? await response.json() : null })).catch(() => ({ ok: false, payload: null }))
      const [snapshot, apiHealth] = await Promise.all([
        adminSettingsAPI.get(),
        apiHealthRequest,
      ])
      setSettings(previous => ({ ...previous, ...snapshot.settings }))
      setAdmins(snapshot.admins)
      setAuditLogs(snapshot.auditLogs)
      const backupAt = snapshot.settings.last_backup_at
      const backupSize = Number(snapshot.settings.last_backup_size || 0)
      const backupTableCount = Number(snapshot.settings.last_backup_tables || 0)
      setBackupInfo({ createdAt: backupAt ? String(backupAt) : null, size: backupSize, tables: backupTableCount })
      setHealth({
        api: apiHealth.ok
          ? { status: 'green', value: `Operational · ${formatUptime(Number(apiHealth.payload?.uptime || 0))} uptime` }
          : { status: 'red', value: 'Unavailable' },
        database: { status: 'green', value: `${snapshot.userCount} users`, count: snapshot.userCount },
      })
      setLastSyncedAt(new Date().toISOString())
      setLoading(false)
    }
    load().catch(() => { setError('Unable to load system settings.'); setLoading(false) })
  }, [])

  useEffect(() => {
    if (active === 'notifications') void loadEmailNotifications()
  }, [active])

  const update = (key: string, value: string | boolean | number) => setSettings(previous => ({ ...previous, [key]: value }))
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 3500) }

  const saveSection = async () => {
    setSaving(true)
    setError('')
    const keys = active === 'general'
      ? ['portal_name', 'tagline', 'admin_email', 'support_contact', 'maintenance_mode']
      : active === 'notifications'
        ? ['email_notifications', 'in_app_notifications', 'registration_notifications', 'completion_notifications', 'result_notifications', 'announcements', 'transactional_result_emails_enabled', 'parent_result_emails_enabled', 'student_welcome_emails_enabled']
        : Object.keys(settings)
    try {
      await adminSettingsAPI.save(Object.fromEntries(keys.map(key => [key, settings[key]])))
      notify('Changes saved successfully')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save settings.')
    } finally {
      setSaving(false)
    }
  }

  const sendTestEmail = async () => {
    setEmailAction('test')
    setError('')
    try {
      const result = await adminSettingsAPI.sendTestEmail()
      notify(result.message)
      await loadEmailNotifications()
    } catch (emailError) {
      setError(emailError instanceof Error ? emailError.message : 'Unable to send the test email.')
      await loadEmailNotifications()
    } finally {
      setEmailAction(null)
    }
  }

  const publishAnnouncement = async () => {
    if (!announcementTitle.trim() || !announcementMessage.trim()) {
      setError('Enter an announcement title and message.')
      return
    }
    setPublishingAnnouncement(true)
    setError('')
    const requestId = announcementRequestId || crypto.randomUUID()
    setAnnouncementRequestId(requestId)
    try {
      const result = await notificationsAPI.publishAnnouncement({
        title: announcementTitle.trim(),
        message: announcementMessage.trim(),
        targetPage: announcementPage,
        requestId,
      })
      notify(result.message)
      setAnnouncementTitle('')
      setAnnouncementMessage('')
      setAnnouncementRequestId(null)
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Unable to publish the announcement.')
    } finally {
      setPublishingAnnouncement(false)
    }
  }

  const validateEmailService = async () => {
    setEmailAction('validate')
    setError('')
    setEmailServiceValidation('unchecked')
    try {
      const result = await adminSettingsAPI.validateEmailService()
      setEmailServiceValidation(result.valid ? 'valid' : 'invalid')
      setEmailServiceMessage(result.message)
      notify(result.message)
    } catch (emailError) {
      setEmailServiceValidation('invalid')
      const message = emailError instanceof Error ? emailError.message : 'Unable to validate the Python email service.'
      setEmailServiceMessage(message)
      setError(message)
    } finally {
      setEmailAction(null)
    }
  }

  const retryEmail = async (id: string) => {
    setRetryingNotification(id)
    setError('')
    try {
      const result = await adminSettingsAPI.retryEmailNotification(id)
      notify(result.message)
      await loadEmailNotifications()
    } catch (emailError) {
      setError(emailError instanceof Error ? emailError.message : 'Unable to retry the email notification.')
    } finally {
      setRetryingNotification(null)
    }
  }

  const createAdmin = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      const result = await adminSettingsAPI.createAdmin(newAdmin)
      setAdmins(previous => [result.admin, ...previous])
      notify(`Admin added. Temporary password: ${result.temporaryPassword}`)
      setAdminModal(false)
      setNewAdmin({ name: '', email: '', role: 'Basic Admin' })
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to add administrator.')
    }
  }

  const confirmCurrentAction = async () => {
    if (!adminToRemove) {
      setConfirmAction('')
      notify('Confirmation recorded')
      return
    }

    try {
      await adminSettingsAPI.deleteAdmin(adminToRemove)
      setAdmins(previous => previous.filter(admin => admin.id !== adminToRemove))
      notify('Administrator removed')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to remove administrator.')
    } finally {
      setConfirmAction('')
      setAdminToRemove(null)
    }
  }

  const fetchBackupRows = async (table: string) => {
    return await adminSettingsAPI.getData(table)
  }

  const createBackup = async (recordBackup: boolean) => {
    setBackupBusy(true)
    try {
      const [users, questions, mockTests, testResults, systemSettings, auditLogs] = await Promise.all(backupTables.map(fetchBackupRows))
      const safeUsers = users.map(user => Object.fromEntries(Object.entries(user).filter(([key]) => !['password', 'mhcet_password', 'mhcetPassword'].includes(key))))
      const snapshot = {
        generatedAt: new Date().toISOString(),
        source: 'CET NOVA admin backup',
        note: 'Credentials, session records, refresh tokens, and login history are excluded from client downloads.',
        tables: { users: safeUsers, questions, mock_tests: mockTests, test_results: testResults, system_settings: systemSettings, admin_audit_logs: auditLogs },
      }
      const content = JSON.stringify(snapshot, null, 2)
      const size = new Blob([content]).size
      const createdAt = snapshot.generatedAt
      downloadFile(content, `cet-nova-backup-${createdAt.slice(0, 10)}.json`, 'application/json')
      setBackupInfo({ createdAt, size, tables: backupTables.length })
      if (recordBackup) {
        await adminSettingsAPI.save({ last_backup_at: createdAt, last_backup_size: size, last_backup_tables: backupTables.length })
      }
      notify(`${recordBackup ? 'Backup created' : 'Backup downloaded'}: ${formatBytes(size)}`)
    } catch (backupError) {
      setError(backupError instanceof Error ? backupError.message : 'Unable to create backup')
    } finally {
      setBackupBusy(false)
    }
  }

  const exportTable = async (table: string, filename: string, sanitize = false) => {
    try {
      const rows = await fetchBackupRows(table)
      const safeRows = sanitize ? rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !['password', 'mhcet_password', 'mhcetPassword'].includes(key)))) : rows
      downloadFile(toCsv(safeRows), `${filename}-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8')
      notify(`${rows.length} records exported`)
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : `Unable to export ${table}`)
    }
  }

  const filteredLogs = useMemo(() => auditLogs.filter(log => `${log.admin_name} ${log.action} ${log.module}`.toLowerCase().includes(search.toLowerCase())), [auditLogs, search])
  const filteredAdmins = admins.filter(admin => roleFilter === 'All' || (admin.admin_role || 'ADMIN') === (roleFilter === 'Basic Admin' ? 'ADMIN' : roleFilter))
  const value = (key: string) => settings[key]
  const bool = (key: string) => Boolean(settings[key])

  if (loading) return <div className="as-loading"><span className="material-symbols-outlined">progress_activity</span><h2>Loading system settings</h2><p>Connecting to the administration store...</p></div>

  return <div className="as-page">
    {toast && <div className="as-toast"><span className="material-symbols-outlined">check_circle</span>{toast}</div>}
    {error && <div className="as-error"><span className="material-symbols-outlined">error</span>{error}</div>}
    <div className="as-header"><div><p className="as-eyebrow">SYSTEM ADMINISTRATION</p><h1>Settings</h1><p>Control CETNova's identity, security, integrations, and operating rules.</p></div><button className="as-primary" onClick={saveSection} disabled={saving}><span className="material-symbols-outlined">save</span>{saving ? 'Saving...' : 'Save changes'}</button></div>
    <div className="as-layout">
      <aside className="as-nav">{sections.map(section => <button key={section.key} className={active === section.key ? 'as-nav-item as-nav-item--active' : 'as-nav-item'} onClick={() => setActive(section.key)}><span className="material-symbols-outlined">{section.icon}</span><span><strong>{section.label}</strong><small>{section.description}</small></span></button>)}</aside>
      <main className="as-main">
        <div className="as-section-heading"><div><h2>{activeSection.label}</h2><p>{activeSection.description}</p></div><span className="as-section-icon material-symbols-outlined">{activeSection.icon}</span></div>
        {active === 'general' && <><Card title="Portal identity" icon="language"><div className="as-grid"><Field label="Portal name" value={String(value('portal_name'))} onChange={v => update('portal_name', v)} /><Field label="Tagline" value={String(value('tagline'))} onChange={v => update('tagline', v)} /><Field label="Admin contact email" value={String(value('admin_email'))} onChange={v => update('admin_email', v)} type="email" /><Field label="Support contact" value={String(value('support_contact'))} onChange={v => update('support_contact', v)} /></div><UploadRow label="Portal logo" /><UploadRow label="Favicon" /></Card><Card title="Availability" icon="power_settings_new"><SwitchRow label="Maintenance mode" description="Temporarily prevent student access while administrators work." checked={bool('maintenance_mode')} onChange={v => update('maintenance_mode', v)} /></Card></>}
        {active === 'roles' && <>
          <Card title="Administrators" icon="group">
            <div className="as-toolbar">
              <select value={roleFilter} onChange={event => setRoleFilter(event.target.value)}>
                <option>All</option>{roles.map(role => <option key={role}>{role}</option>)}
              </select>
              <button className="as-secondary" onClick={() => setAdminModal(true)}>
                <span className="material-symbols-outlined">person_add</span>Add admin
              </button>
            </div>
            <div className="as-table-wrap">
              <table>
                <thead><tr><th>Administrator</th><th>Role</th><th>Status</th><th>Joined</th><th /></tr></thead>
                <tbody>{filteredAdmins.map(admin => <tr key={admin.id}>
                  <td><strong>{admin.name}</strong><small>{admin.email}</small></td>
                  <td><span className="as-chip">{admin.admin_role === 'Super Admin' ? 'Super Admin' : 'Basic Admin'}</span></td>
                  <td><span className="as-status as-status--green">{admin.status}</span></td>
                  <td>{new Date(admin.created_at).toLocaleDateString()}</td>
                  <td><button className="as-icon-btn" title="Remove admin" onClick={() => {
                    setAdminToRemove(admin.id)
                    setConfirmAction(`Remove ${admin.name}?`)
                  }}><span className="material-symbols-outlined">delete</span></button></td>
                </tr>)}</tbody>
              </table>
              {!filteredAdmins.length && <Empty label="No administrators found" />}
            </div>
          </Card>
          <Card title="Role permissions" icon="key">
            <div className="as-permission-table">
              <div className="as-permission-row as-permission-head"><strong>Role</strong>{permissions.map(permission => <span key={permission}>{permission}</span>)}</div>
              {roles.map(role => <div className="as-permission-row" key={role}><strong>{role}</strong>{permissions.map(permission => <label key={permission}><input type="checkbox" defaultChecked={['View', 'Create', 'Edit', 'Export'].includes(permission)} /> <span className="sr-only">{permission}</span></label>)}</div>)}
            </div>
          </Card>
        </>}
        {active === 'security' && <><Card title="Authentication policy" icon="shield"><SwitchRow label="Two-factor authentication" description="Require a second factor for administrator accounts." checked={bool('two_factor')} onChange={v => update('two_factor', v)} /><SwitchRow label="CAPTCHA on sign in" checked={bool('captcha')} onChange={v => update('captcha', v)} /><SwitchRow label="Force password change" checked={bool('force_password_change')} onChange={v => update('force_password_change', v)} /><div className="as-grid"><Field label="Login attempt limit" value={Number(value('login_attempt_limit'))} onChange={v => update('login_attempt_limit', Number(v))} type="number" min={1} max={20} /><Field label="Session inactivity timeout (minutes)" value={Number(value('session_timeout'))} onChange={v => update('session_timeout', Number.parseInt(v, 10) || 1)} type="number" min={1} max={1440} /></div><p className="as-card-intro">Sessions remain active while users are working and expire after this many minutes without activity.</p></Card><Card title="Security activity" icon="history"><div className="as-health-list"><StatusRow label="Active sessions" value="Protected" status="green" /><StatusRow label="Last security review" value="Today, 09:42" status="blue" /><StatusRow label="Force logout all users" value="Irreversible action" status="red" action={() => setConfirmAction('Force logout all users?')} /></div></Card></>}
        {active === 'ai' && <><Card title="Provider & usage" icon="smart_toy"><div className="as-grid"><label className="as-field"><span>AI provider</span><select value={String(value('ai_provider'))} onChange={e => update('ai_provider', e.target.value)}><option>OpenAI</option><option>Google Gemini</option><option>Anthropic</option><option>OpenRouter</option></select></label><label className="as-field"><span>AI model</span><select value={String(value('ai_model'))} onChange={e => update('ai_model', e.target.value)}><option>gpt-4o-mini</option><option>gpt-4.1-mini</option><option>gemini-2.0-flash</option></select></label><label className="as-field"><span>API key</span><div className="as-input-action"><input type={showKey ? 'text' : 'password'} value="••••••••••••••••" readOnly /><button type="button" onClick={() => setShowKey(!showKey)}><span className="material-symbols-outlined">{showKey ? 'visibility_off' : 'visibility'}</span></button></div></label><Field label="Daily usage limit" value={Number(value('ai_daily_limit'))} onChange={v => update('ai_daily_limit', Number(v))} type="number" /></div><SwitchRow label="Enable AI features" checked={bool('ai_enabled')} onChange={v => update('ai_enabled', v)} /></Card><Card title="AI feature controls" icon="auto_awesome"><SwitchRow label="AI Question Generator" checked={bool('ai_question_generator')} onChange={v => update('ai_question_generator', v)} /><SwitchRow label="AI Doubt Solver" checked={bool('ai_doubt_solver')} onChange={v => update('ai_doubt_solver', v)} /><SwitchRow label="AI Performance Analysis" checked={bool('ai_performance_analysis')} onChange={v => update('ai_performance_analysis', v)} /><div className="as-usage"><div><span>Usage this month</span><strong>34,820 / 50,000 tokens</strong></div><div className="as-progress"><i style={{ width: '69%' }} /></div></div></Card></>}
        {active === 'notifications' && <>
          <Card title="Notification channels" icon="notifications">
            <SwitchRow label="Email notifications" checked={bool('email_notifications')} onChange={v => update('email_notifications', v)} />
            <SwitchRow label="In-app notifications" checked={bool('in_app_notifications')} onChange={v => update('in_app_notifications', v)} />
            <SwitchRow label="Registration notifications" checked={bool('registration_notifications')} onChange={v => update('registration_notifications', v)} />
            <SwitchRow label="Mock test completion" checked={bool('completion_notifications')} onChange={v => update('completion_notifications', v)} />
            <SwitchRow label="Result notifications" checked={bool('result_notifications')} onChange={v => update('result_notifications', v)} />
            <SwitchRow label="System announcements" checked={bool('announcements')} onChange={v => update('announcements', v)} />
          </Card>
          <Card title="Publish student announcement" icon="campaign">
            <p className="as-card-intro">Send a persistent in-app system alert to all approved student accounts.</p>
            <label className="as-field">
              <span>Title</span>
              <input
                value={announcementTitle}
                maxLength={120}
                placeholder="For example, exam schedule update"
                onChange={event => {
                  setAnnouncementTitle(event.target.value)
                  setAnnouncementRequestId(null)
                }}
              />
            </label>
            <label className="as-field">
              <span>Message</span>
              <textarea
                value={announcementMessage}
                maxLength={1000}
                rows={4}
                placeholder="Write the information students need to know."
                style={{ width: '100%', minHeight: 96, resize: 'vertical', padding: '11px 12px', border: '1px solid #cbd5e1', borderRadius: 9, font: 'inherit', color: '#172033' }}
                onChange={event => {
                  setAnnouncementMessage(event.target.value)
                  setAnnouncementRequestId(null)
                }}
              />
            </label>
            <label className="as-field">
              <span>Open destination</span>
              <select
                value={announcementPage}
                onChange={event => {
                  setAnnouncementPage(event.target.value as NotificationPage)
                  setAnnouncementRequestId(null)
                }}
              >
                <option value="dashboard">Dashboard</option>
                <option value="mocktests">Mock Tests</option>
                <option value="results">Results</option>
                <option value="analytics">Analytics</option>
                <option value="settings">Profile</option>
              </select>
            </label>
            {(!bool('announcements') || !bool('in_app_notifications')) && <p className="as-email-warning" role="status">Enable System announcements and in-app notifications, then save notification settings before publishing.</p>}
            <div className="as-card-actions">
              <button
                className="as-secondary"
                type="button"
                onClick={() => void publishAnnouncement()}
                disabled={publishingAnnouncement || !bool('announcements') || !bool('in_app_notifications')}
              >
                {publishingAnnouncement ? 'Publishing…' : announcementRequestId ? 'Retry publishing' : 'Publish to students'}
              </button>
            </div>
          </Card>
          <Card title="Python SMTP email notifications" icon="mail">
            <SwitchRow label="Automatic student result emails" description="Send authoritative result summaries after a regular or assigned test is finalized." checked={bool('transactional_result_emails_enabled')} onChange={v => update('transactional_result_emails_enabled', v)} />
            <SwitchRow label="Parent or guardian result emails" description="Requires the student to add a guardian email and explicitly consent in their profile." checked={bool('parent_result_emails_enabled')} onChange={v => update('parent_result_emails_enabled', v)} />
            <SwitchRow label="Student welcome and setup emails" description="Send single-use password setup links when an administrator approves or resends student access." checked={bool('student_welcome_emails_enabled')} onChange={v => update('student_welcome_emails_enabled', v)} />
            <div className="as-email-config">
              <div><span>Sender email</span><strong>{emailConfiguration?.senderEmail || 'Not configured'}</strong></div>
              <div><span>Sender name</span><strong>{emailConfiguration?.senderName || 'CETNova'}</strong></div>
              <div><span>Python email service</span><strong>{emailConfiguration?.serviceUrlConfigured ? 'Configured' : 'Not configured'}</strong></div>
              <div><span>Service authentication</span><strong>{emailConfiguration?.serviceTokenConfigured ? 'Configured (hidden)' : 'Not configured'}</strong></div>
              <div><span>Mailer configuration</span><strong>{emailServiceValidation === 'valid' ? 'Configured' : emailServiceValidation === 'invalid' ? 'Unavailable or misconfigured' : 'Not checked'}</strong></div>
              <div><span>Secure setup-link encryption</span><strong>{emailConfiguration?.setupEncryptionConfigured ? 'Configured' : 'Needs a shared API and scheduler secret'}</strong></div>
            </div>
            {emailConfiguration?.error && <p className="as-email-warning" role="status">{emailConfiguration.error}</p>}
            {emailConfiguration && !emailConfiguration.setupEncryptionConfigured && <p className="as-email-warning" role="status">Set the same EMAIL_TOKEN_ENCRYPTION_KEY (at least 32 characters) on the API and scheduler to deliver account setup emails.</p>}
            {emailServiceMessage && emailServiceValidation === 'valid' && <p className="as-card-intro" role="status">{emailServiceMessage}</p>}
            <div className="as-card-actions">
              <button className="as-secondary" type="button" onClick={validateEmailService} disabled={emailAction !== null}>
                {emailAction === 'validate' ? 'Checking…' : 'Check Python email service'}
              </button>
              <button className="as-secondary" type="button" onClick={sendTestEmail} disabled={emailAction !== null}>
                {emailAction === 'test' ? 'Sending test…' : 'Send test email to my admin address'}
              </button>
            </div>
          </Card>
          <Card title="Email delivery activity" icon="outbox">
            {emailLoading ? <p className="as-card-intro">Loading delivery activity…</p> : emailNotifications.length ? (
              <div className="as-email-log-list">
                {emailNotifications.map(notification => (
                  <article className="as-email-log-row" key={notification.id}>
                    <div className="as-email-log-main">
                      <strong>{notification.notification_type.replaceAll('_', ' ')}</strong>
                      <span>{notification.recipient_email}</span>
                      <small>{notification.student_name || 'Admin test'}{notification.exam_name ? ` · ${notification.exam_name}` : ''} · {new Date(notification.created_at).toLocaleString()}</small>
                      {notification.safe_error && <small className="as-email-log-error">{notification.safe_error}</small>}
                    </div>
                    <div className="as-email-log-status">
                      <span className={`as-status as-status--${notification.status === 'delivered' || notification.status === 'accepted' ? 'green' : notification.status === 'failed' ? 'red' : 'blue'}`}>
                        {notification.status === 'accepted' ? 'Accepted by SMTP server' : notification.status}
                      </span>
                      {notification.status === 'failed' && <button className="as-secondary" type="button" onClick={() => retryEmail(notification.id)} disabled={retryingNotification === notification.id}>{retryingNotification === notification.id ? 'Retrying…' : 'Retry'}</button>}
                    </div>
                  </article>
                ))}
              </div>
            ) : <Empty label="No email notifications have been recorded" />}
          </Card>
        </>}
        {active === 'integrations' && <><Card title="Connected services" icon="hub"><div className="as-integration-grid"><Integration name="Supabase" icon="database" status="Connected" /><Integration name="Google OAuth" icon="login" status={bool('google_oauth') ? 'Connected' : 'Not connected'} action={() => update('google_oauth', !bool('google_oauth'))} /><Integration name="SMTP" icon="mail" status="Ready to configure" action={() => setActive('notifications')} /></div></Card><Card title="API & webhooks" icon="api"><div className="as-grid"><Field label="SMTP host" value={String(value('smtp_host'))} onChange={v => update('smtp_host', v)} placeholder="smtp.example.com" /><Field label="SMTP port" value={Number(value('smtp_port'))} onChange={v => update('smtp_port', Number(v))} type="number" /><Field label="External API URL" value={String(value('external_api_url'))} onChange={v => update('external_api_url', v)} /><Field label="Webhook URL" value={String(value('webhook_url'))} onChange={v => update('webhook_url', v)} /></div><div className="as-card-actions"><button className="as-secondary" onClick={() => notify('Connection test queued')}>Test connections</button><button className="as-secondary" onClick={() => notify('API key rotation queued')}>Manage API keys</button></div></Card></>}
        {active === 'branding' && <><Card title="Appearance" icon="palette"><div className="as-color-row"><label>Primary color<input type="color" value={String(value('primary_color'))} onChange={e => update('primary_color', e.target.value)} /></label><label>Secondary color<input type="color" value={String(value('secondary_color'))} onChange={e => update('secondary_color', e.target.value)} /></label></div><SwitchRow label="Dark mode" description="Available to administrators only." checked={bool('dark_mode')} onChange={v => update('dark_mode', v)} /><SwitchRow label="Login page branding" checked={bool('login_branding')} onChange={v => update('login_branding', v)} /></Card><Card title="Brand assets" icon="image"><UploadRow label="Logo" /><UploadRow label="Favicon" /><Field label="Custom tagline" value={String(value('tagline'))} onChange={v => update('tagline', v)} /><button className="as-secondary" onClick={() => notify('Preview opened in a new tab')}>Preview changes</button></Card></>}
        {active === 'features' && <Card title="Platform controls" icon="toggle_on"><p className="as-card-intro">Changes take effect immediately across the student experience.</p>{[['student_registration', 'Student Registration'], ['mock_test_system', 'Mock Test System'], ['ai_question_generator', 'AI Question Generator'], ['ai_doubt_solver', 'AI Doubt Solver'], ['google_login', 'Google Login'], ['email_notifications_feature', 'Email Notifications'], ['result_publishing', 'Result Publishing'], ['new_user_registration', 'New User Registration'], ['maintenance_mode', 'Maintenance Mode']].map(([key, label]) => <SwitchRow key={key} label={label} checked={bool(key)} onChange={v => update(key, v)} />)}</Card>}
        {active === 'backup' && <><Card title="Backup status" icon="cloud_done"><div className="as-backup-banner"><span className="material-symbols-outlined">{backupInfo.createdAt ? 'check_circle' : 'cloud_off'}</span><div><strong>{backupInfo.createdAt ? 'Last backup downloaded successfully' : 'No backup has been created'}</strong><small>{backupInfo.createdAt ? `${new Date(backupInfo.createdAt).toLocaleString()} · ${formatBytes(backupInfo.size)} · ${backupInfo.tables} tables` : 'Create a snapshot of the current Supabase data.'}</small></div></div><div className="as-card-actions"><button className="as-primary" disabled={backupBusy} onClick={() => createBackup(true)}>{backupBusy ? 'Creating...' : 'Create backup'}</button><button className="as-secondary" disabled={backupBusy} onClick={() => createBackup(false)}>Download current data</button><button className="as-secondary" disabled title="Restore requires a protected server-side import workflow">Restore backup</button></div></Card><Card title="Data management" icon="storage"><div className="as-card-actions"><button className="as-secondary" onClick={() => exportTable('users', 'cet-nova-students', true)}>Export student data</button><button className="as-secondary" onClick={() => exportTable('mock_tests', 'cet-nova-tests')}>Export test data</button></div><Field label="Data retention (days)" value={Number(value('retention_days'))} onChange={v => update('retention_days', Number(v))} type="number" /><button className="as-text-button" onClick={() => notify(`Backup history: ${backupInfo.createdAt ? new Date(backupInfo.createdAt).toLocaleString() : 'No backups recorded'}`)}>Show backup history</button></Card></>}
        {active === 'audit' && <Card title="Administrative activity" icon="manage_search"><div className="as-toolbar"><div className="as-search"><span className="material-symbols-outlined">search</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search admin, action, or module" /></div><button className="as-secondary" onClick={() => notify('Date filter opened')}>Filter date</button></div><div className="as-table-wrap"><table><thead><tr><th>Admin</th><th>Action</th><th>Module</th><th>Date & time</th><th>IP address</th><th>Status</th></tr></thead><tbody>{filteredLogs.map(log => <tr key={log.id}><td>{log.admin_name}</td><td>{log.action}</td><td>{log.module}</td><td>{new Date(log.created_at).toLocaleString()}</td><td>{log.ip_address || 'Internal'}</td><td><span className="as-status as-status--green">{log.status}</span></td></tr>)}</tbody></table>{!filteredLogs.length && <Empty label="No audit activity found" />}</div></Card>}
        {active === 'health' && <><Card title="Service health" icon="monitor_heart"><div className="as-health-grid"><StatusRow label="Application server" value={health.api.value} status={health.api.status} /><StatusRow label="Database" value={health.database.value} status={health.database.status} /><StatusRow label="Supabase" value={health.database.status === 'green' ? 'Connected' : 'Unavailable'} status={health.database.status} /><StatusRow label="AI API" value={bool('ai_enabled') ? `${String(value('ai_provider'))} configured` : 'Disabled'} status={bool('ai_enabled') ? 'blue' : 'gray'} /><StatusRow label="SMTP" value={String(value('smtp_host')).trim() ? 'Configured' : 'Not configured'} status={String(value('smtp_host')).trim() ? 'green' : 'gray'} /></div></Card><Card title="Runtime details" icon="info"><div className="as-runtime"><span>Registered users<strong>{health.database.count}</strong></span><span>Build mode<strong>{import.meta.env.MODE}</strong></span><span>Settings sync<strong>{lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : 'Unavailable'}</strong></span><span>API uptime<strong>{health.api.value.includes('uptime') ? health.api.value.split('· ')[1] : 'Unavailable'}</strong></span></div></Card></>}
      </main>
    </div>
    {adminModal && <div className="as-modal-backdrop" onClick={() => setAdminModal(false)}><form className="as-modal" onSubmit={createAdmin} onClick={e => e.stopPropagation()}><div className="as-modal-head"><h3>Add administrator</h3><button type="button" className="as-icon-btn" onClick={() => setAdminModal(false)}><span className="material-symbols-outlined">close</span></button></div><Field label="Name" value={newAdmin.name} onChange={v => setNewAdmin({ ...newAdmin, name: v })} /><Field label="Email" value={newAdmin.email} onChange={v => setNewAdmin({ ...newAdmin, email: v })} type="email" /><label className="as-field"><span>Role</span><select value={newAdmin.role} onChange={e => setNewAdmin({ ...newAdmin, role: e.target.value })}>{roles.map(role => <option key={role}>{role}</option>)}</select></label><div className="as-card-actions"><button type="button" className="as-secondary" onClick={() => setAdminModal(false)}>Cancel</button><button className="as-primary">Add admin</button></div></form></div>}
    {confirmAction && <div className="as-modal-backdrop"><div className="as-modal as-confirm"><span className="material-symbols-outlined as-confirm-icon">warning</span><h3>Confirm action</h3><p>{confirmAction}</p><div className="as-card-actions"><button className="as-secondary" onClick={() => { setConfirmAction(''); setAdminToRemove(null) }}>Cancel</button><button className="as-danger" onClick={() => void confirmCurrentAction()}>Continue</button></div></div></div>}
  </div>
}

function Card({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) { return <section className="as-card"><div className="as-card-head"><div><span className="material-symbols-outlined">{icon}</span><h3>{title}</h3></div></div>{children}</section> }
function UploadRow({ label }: { label: string }) { return <div className="as-upload"><div><strong>{label}</strong><small>PNG, JPG or SVG · max 2 MB</small></div><button className="as-secondary" type="button"><span className="material-symbols-outlined">upload</span>Upload</button></div> }
function Integration({ name, icon, status, action }: { name: string; icon: string; status: string; action?: () => void }) { return <div className="as-integration"><span className="material-symbols-outlined">{icon}</span><div><strong>{name}</strong><small>{status}</small></div><button className="as-secondary" onClick={action}>{status === 'Connected' ? 'Manage' : 'Connect'}</button></div> }
function StatusRow({ label, value, status, action }: { label: string; value: string; status: string; action?: () => void }) { return <div className="as-status-row"><span className={`as-dot as-dot--${status}`} /><div><strong>{label}</strong><small>{value}</small></div>{action && <button className="as-text-button" onClick={action}>Review</button>}</div> }
function Empty({ label }: { label: string }) { return <div className="as-empty"><span className="material-symbols-outlined">inbox</span>{label}</div> }
