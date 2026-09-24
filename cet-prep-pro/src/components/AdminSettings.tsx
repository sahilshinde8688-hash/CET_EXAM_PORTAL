import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { session, type AuthUser } from '../lib/api'
import '../adminSettings.css'
import '../adminSettingsLayout.css'

type SectionKey = 'general' | 'roles' | 'security' | 'ai' | 'notifications' | 'integrations' | 'branding' | 'features' | 'backup' | 'audit' | 'health'
type SettingsData = Record<string, string | boolean | number>
type AdminRecord = { id: string; name: string; email: string; role: string; admin_role?: string; status: string; created_at: string }
type AuditRecord = { id: string; admin_name: string; action: string; module: string; created_at: string; ip_address: string; status: string }

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
  two_factor: true, login_attempt_limit: 5, session_timeout: 60, captcha: false, force_password_change: false,
  ai_provider: 'OpenAI', ai_model: 'gpt-4o-mini', ai_enabled: true, ai_daily_limit: 1000, ai_question_generator: true, ai_doubt_solver: true, ai_performance_analysis: true,
  email_notifications: true, in_app_notifications: true, registration_notifications: true, completion_notifications: true, result_notifications: true, announcements: true,
  google_oauth: false, smtp_host: '', smtp_port: 587, external_api_url: '', webhook_url: '',
  primary_color: '#2563eb', secondary_color: '#0f172a', dark_mode: false, login_branding: true,
  student_registration: true, mock_test_system: true, google_login: false, result_publishing: true, new_user_registration: true, email_notifications_feature: true,
  retention_days: 365,
}

const roles = ['Super Admin', 'Exam Manager', 'Question Manager', 'Analyst', 'Support Staff']
const permissions = ['View', 'Create', 'Edit', 'Delete', 'Export', 'Settings']

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`as-toggle${checked ? ' as-toggle--on' : ''}`} onClick={() => onChange(!checked)}><span /></button>
}

function Field({ label, value, onChange, type = 'text', placeholder }: { label: string; value: string | number; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return <label className="as-field"><span>{label}</span><input type={type} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} /></label>
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
  const [newAdmin, setNewAdmin] = useState({ name: '', email: '', role: 'Support Staff' })
  const [showKey, setShowKey] = useState(false)
  const currentAdmin = session.get<AuthUser>()
  const activeSection = sections.find(section => section.key === active) || sections[0]

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const [{ data: settingRows, error: settingsError }, { data: adminRows }, { data: logs }] = await Promise.all([
        supabase.from('system_settings').select('key,value'),
        supabase.from('users').select('id,name,email,role,admin_role,status,created_at').eq('role', 'admin').order('created_at', { ascending: false }),
        supabase.from('admin_audit_logs').select('*').order('created_at', { ascending: false }).limit(100),
      ])
      if (settingsError) setError('Settings storage is not available yet. Run the supplied Supabase migration, then reload.')
      if (settingRows) setSettings(previous => ({ ...previous, ...Object.fromEntries(settingRows.map(row => [row.key, row.value])) }))
      setAdmins((adminRows || []) as AdminRecord[])
      setAuditLogs((logs || []) as AuditRecord[])
      setLoading(false)
    }
    load().catch(() => { setError('Unable to load system settings.'); setLoading(false) })
  }, [])

  const update = (key: string, value: string | boolean | number) => setSettings(previous => ({ ...previous, [key]: value }))
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 3500) }

  const saveSection = async () => {
    setSaving(true)
    setError('')
    const keys = active === 'general' ? ['portal_name', 'tagline', 'admin_email', 'support_contact', 'maintenance_mode'] : Object.keys(settings)
    const payload = keys.map(key => ({ key, value: settings[key], updated_by: currentAdmin?._id || null, updated_at: new Date().toISOString() }))
    const { error: saveError } = await supabase.from('system_settings').upsert(payload, { onConflict: 'key' })
    if (saveError) setError(saveError.message)
    else { notify('Changes saved successfully'); await supabase.from('admin_audit_logs').insert({ admin_id: currentAdmin?._id || null, admin_name: currentAdmin?.name || 'Admin', action: 'Updated settings', module: activeSection.label, status: 'Success' }) }
    setSaving(false)
  }

  const createAdmin = async (event: React.FormEvent) => {
    event.preventDefault()
    const { error: createError } = await supabase.from('users').insert({ name: newAdmin.name, email: newAdmin.email, role: 'admin', admin_role: newAdmin.role, status: 'approved', branch: 'Byculla', batch: 0 })
    if (createError) notify(createError.message)
    else { notify('Admin added'); setAdminModal(false); setNewAdmin({ name: '', email: '', role: 'Support Staff' }) }
  }

  const filteredLogs = useMemo(() => auditLogs.filter(log => `${log.admin_name} ${log.action} ${log.module}`.toLowerCase().includes(search.toLowerCase())), [auditLogs, search])
  const filteredAdmins = admins.filter(admin => roleFilter === 'All' || (admin.admin_role || 'Super Admin') === roleFilter)
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
        {active === 'roles' && <><Card title="Administrators" icon="group"><div className="as-toolbar"><select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}><option>All</option>{roles.map(role => <option key={role}>{role}</option>)}</select><button className="as-secondary" onClick={() => setAdminModal(true)}><span className="material-symbols-outlined">person_add</span>Add admin</button></div><div className="as-table-wrap"><table><thead><tr><th>Administrator</th><th>Role</th><th>Status</th><th>Joined</th><th /></tr></thead><tbody>{filteredAdmins.map(admin => <tr key={admin.id}><td><strong>{admin.name}</strong><small>{admin.email}</small></td><td><span className="as-chip">{admin.admin_role || 'Super Admin'}</span></td><td><span className="as-status as-status--green">{admin.status}</span></td><td>{new Date(admin.created_at).toLocaleDateString()}</td><td><button className="as-icon-btn" title="Remove admin" onClick={() => setConfirmAction(`Remove ${admin.name}?`)}><span className="material-symbols-outlined">delete</span></button></td></tr>)}</tbody></table>{!filteredAdmins.length && <Empty label="No administrators found" />}</div></Card><Card title="Role permissions" icon="key"><div className="as-permission-table"><div className="as-permission-row as-permission-head"><strong>Role</strong>{permissions.map(permission => <span key={permission}>{permission}</span>)}</div>{roles.map(role => <div className="as-permission-row" key={role}><strong>{role}</strong>{permissions.map(permission => <label key={permission}><input type="checkbox" defaultChecked={role === 'Super Admin' || (role === 'Exam Manager' && ['View', 'Create', 'Edit', 'Export'].includes(permission))} /> <span className="sr-only">{permission}</span></label>)}</div>)}</div></Card></>}
        {active === 'security' && <><Card title="Authentication policy" icon="shield"><SwitchRow label="Two-factor authentication" description="Require a second factor for administrator accounts." checked={bool('two_factor')} onChange={v => update('two_factor', v)} /><SwitchRow label="CAPTCHA on sign in" checked={bool('captcha')} onChange={v => update('captcha', v)} /><SwitchRow label="Force password change" checked={bool('force_password_change')} onChange={v => update('force_password_change', v)} /><div className="as-grid"><Field label="Login attempt limit" value={Number(value('login_attempt_limit'))} onChange={v => update('login_attempt_limit', Number(v))} type="number" /><Field label="Session timeout (minutes)" value={Number(value('session_timeout'))} onChange={v => update('session_timeout', Number(v))} type="number" /></div></Card><Card title="Security activity" icon="history"><div className="as-health-list"><StatusRow label="Active sessions" value="Protected" status="green" /><StatusRow label="Last security review" value="Today, 09:42" status="blue" /><StatusRow label="Force logout all users" value="Irreversible action" status="red" action={() => setConfirmAction('Force logout all users?')} /></div></Card></>}
        {active === 'ai' && <><Card title="Provider & usage" icon="smart_toy"><div className="as-grid"><label className="as-field"><span>AI provider</span><select value={String(value('ai_provider'))} onChange={e => update('ai_provider', e.target.value)}><option>OpenAI</option><option>Google Gemini</option><option>Anthropic</option><option>OpenRouter</option></select></label><label className="as-field"><span>AI model</span><select value={String(value('ai_model'))} onChange={e => update('ai_model', e.target.value)}><option>gpt-4o-mini</option><option>gpt-4.1-mini</option><option>gemini-2.0-flash</option></select></label><label className="as-field"><span>API key</span><div className="as-input-action"><input type={showKey ? 'text' : 'password'} value="••••••••••••••••" readOnly /><button type="button" onClick={() => setShowKey(!showKey)}><span className="material-symbols-outlined">{showKey ? 'visibility_off' : 'visibility'}</span></button></div></label><Field label="Daily usage limit" value={Number(value('ai_daily_limit'))} onChange={v => update('ai_daily_limit', Number(v))} type="number" /></div><SwitchRow label="Enable AI features" checked={bool('ai_enabled')} onChange={v => update('ai_enabled', v)} /></Card><Card title="AI feature controls" icon="auto_awesome"><SwitchRow label="AI Question Generator" checked={bool('ai_question_generator')} onChange={v => update('ai_question_generator', v)} /><SwitchRow label="AI Doubt Solver" checked={bool('ai_doubt_solver')} onChange={v => update('ai_doubt_solver', v)} /><SwitchRow label="AI Performance Analysis" checked={bool('ai_performance_analysis')} onChange={v => update('ai_performance_analysis', v)} /><div className="as-usage"><div><span>Usage this month</span><strong>34,820 / 50,000 tokens</strong></div><div className="as-progress"><i style={{ width: '69%' }} /></div></div></Card></>}
        {active === 'notifications' && <Card title="Notification channels" icon="notifications"><SwitchRow label="Email notifications" checked={bool('email_notifications')} onChange={v => update('email_notifications', v)} /><SwitchRow label="In-app notifications" checked={bool('in_app_notifications')} onChange={v => update('in_app_notifications', v)} /><SwitchRow label="Registration notifications" checked={bool('registration_notifications')} onChange={v => update('registration_notifications', v)} /><SwitchRow label="Mock test completion" checked={bool('completion_notifications')} onChange={v => update('completion_notifications', v)} /><SwitchRow label="Result notifications" checked={bool('result_notifications')} onChange={v => update('result_notifications', v)} /><SwitchRow label="System announcements" checked={bool('announcements')} onChange={v => update('announcements', v)} /></Card>}
        {active === 'integrations' && <><Card title="Connected services" icon="hub"><div className="as-integration-grid"><Integration name="Supabase" icon="database" status="Connected" /><Integration name="Google OAuth" icon="login" status={bool('google_oauth') ? 'Connected' : 'Not connected'} action={() => update('google_oauth', !bool('google_oauth'))} /><Integration name="SMTP" icon="mail" status="Ready to configure" action={() => setActive('notifications')} /></div></Card><Card title="API & webhooks" icon="api"><div className="as-grid"><Field label="SMTP host" value={String(value('smtp_host'))} onChange={v => update('smtp_host', v)} placeholder="smtp.example.com" /><Field label="SMTP port" value={Number(value('smtp_port'))} onChange={v => update('smtp_port', Number(v))} type="number" /><Field label="External API URL" value={String(value('external_api_url'))} onChange={v => update('external_api_url', v)} /><Field label="Webhook URL" value={String(value('webhook_url'))} onChange={v => update('webhook_url', v)} /></div><div className="as-card-actions"><button className="as-secondary" onClick={() => notify('Connection test queued')}>Test connections</button><button className="as-secondary" onClick={() => notify('API key rotation queued')}>Manage API keys</button></div></Card></>}
        {active === 'branding' && <><Card title="Appearance" icon="palette"><div className="as-color-row"><label>Primary color<input type="color" value={String(value('primary_color'))} onChange={e => update('primary_color', e.target.value)} /></label><label>Secondary color<input type="color" value={String(value('secondary_color'))} onChange={e => update('secondary_color', e.target.value)} /></label></div><SwitchRow label="Dark mode" description="Available to administrators only." checked={bool('dark_mode')} onChange={v => update('dark_mode', v)} /><SwitchRow label="Login page branding" checked={bool('login_branding')} onChange={v => update('login_branding', v)} /></Card><Card title="Brand assets" icon="image"><UploadRow label="Logo" /><UploadRow label="Favicon" /><Field label="Custom tagline" value={String(value('tagline'))} onChange={v => update('tagline', v)} /><button className="as-secondary" onClick={() => notify('Preview opened in a new tab')}>Preview changes</button></Card></>}
        {active === 'features' && <Card title="Platform controls" icon="toggle_on"><p className="as-card-intro">Changes take effect immediately across the student experience.</p>{[['student_registration', 'Student Registration'], ['mock_test_system', 'Mock Test System'], ['ai_question_generator', 'AI Question Generator'], ['ai_doubt_solver', 'AI Doubt Solver'], ['google_login', 'Google Login'], ['email_notifications_feature', 'Email Notifications'], ['result_publishing', 'Result Publishing'], ['new_user_registration', 'New User Registration'], ['maintenance_mode', 'Maintenance Mode']].map(([key, label]) => <SwitchRow key={key} label={label} checked={bool(key)} onChange={v => update(key, v)} />)}</Card>}
        {active === 'backup' && <><Card title="Backup status" icon="cloud_done"><div className="as-backup-banner"><span className="material-symbols-outlined">check_circle</span><div><strong>Last backup completed successfully</strong><small>Today at 03:00 UTC · 2.4 GB</small></div></div><div className="as-card-actions"><button className="as-primary" onClick={() => notify('Backup started')}>Create backup</button><button className="as-secondary" onClick={() => notify('Backup download prepared')}>Download backup</button><button className="as-secondary" onClick={() => setConfirmAction('Restore the selected backup?')}>Restore backup</button></div></Card><Card title="Data management" icon="storage"><div className="as-card-actions"><button className="as-secondary" onClick={() => notify('Student export prepared')}>Export student data</button><button className="as-secondary" onClick={() => notify('Test export prepared')}>Export test data</button></div><Field label="Data retention (days)" value={Number(value('retention_days'))} onChange={v => update('retention_days', Number(v))} type="number" /><button className="as-text-button" onClick={() => notify('Backup history loaded')}>Show backup history</button></Card></>}
        {active === 'audit' && <Card title="Administrative activity" icon="manage_search"><div className="as-toolbar"><div className="as-search"><span className="material-symbols-outlined">search</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search admin, action, or module" /></div><button className="as-secondary" onClick={() => notify('Date filter opened')}>Filter date</button></div><div className="as-table-wrap"><table><thead><tr><th>Admin</th><th>Action</th><th>Module</th><th>Date & time</th><th>IP address</th><th>Status</th></tr></thead><tbody>{filteredLogs.map(log => <tr key={log.id}><td>{log.admin_name}</td><td>{log.action}</td><td>{log.module}</td><td>{new Date(log.created_at).toLocaleString()}</td><td>{log.ip_address || 'Internal'}</td><td><span className="as-status as-status--green">{log.status}</span></td></tr>)}</tbody></table>{!filteredLogs.length && <Empty label="No audit activity found" />}</div></Card>}
        {active === 'health' && <><Card title="Service health" icon="monitor_heart"><div className="as-health-grid"><StatusRow label="Application server" value="Operational" status="green" /><StatusRow label="Database" value="Operational" status="green" /><StatusRow label="Supabase" value="Connected" status="green" /><StatusRow label="AI API" value={bool('ai_enabled') ? 'Enabled' : 'Disabled'} status={bool('ai_enabled') ? 'blue' : 'gray'} /><StatusRow label="SMTP" value="Ready" status="green" /></div></Card><Card title="Runtime details" icon="info"><div className="as-runtime"><span>Storage usage<strong>2.4 GB / 10 GB</strong></span><span>Application version<strong>v2.6.0</strong></span><span>Last backup<strong>Today, 03:00 UTC</strong></span><span>System uptime<strong>99.98% · 14d 08h</strong></span></div></Card></>}
      </main>
    </div>
    {adminModal && <div className="as-modal-backdrop" onClick={() => setAdminModal(false)}><form className="as-modal" onSubmit={createAdmin} onClick={e => e.stopPropagation()}><div className="as-modal-head"><h3>Add administrator</h3><button type="button" className="as-icon-btn" onClick={() => setAdminModal(false)}><span className="material-symbols-outlined">close</span></button></div><Field label="Name" value={newAdmin.name} onChange={v => setNewAdmin({ ...newAdmin, name: v })} /><Field label="Email" value={newAdmin.email} onChange={v => setNewAdmin({ ...newAdmin, email: v })} type="email" /><label className="as-field"><span>Role</span><select value={newAdmin.role} onChange={e => setNewAdmin({ ...newAdmin, role: e.target.value })}>{roles.map(role => <option key={role}>{role}</option>)}</select></label><div className="as-card-actions"><button type="button" className="as-secondary" onClick={() => setAdminModal(false)}>Cancel</button><button className="as-primary">Add admin</button></div></form></div>}
    {confirmAction && <div className="as-modal-backdrop"><div className="as-modal as-confirm"><span className="material-symbols-outlined as-confirm-icon">warning</span><h3>Confirm action</h3><p>{confirmAction}</p><div className="as-card-actions"><button className="as-secondary" onClick={() => setConfirmAction('')}>Cancel</button><button className="as-danger" onClick={() => { setConfirmAction(''); notify('Confirmation recorded') }}>Continue</button></div></div></div>}
  </div>
}

function Card({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) { return <section className="as-card"><div className="as-card-head"><div><span className="material-symbols-outlined">{icon}</span><h3>{title}</h3></div></div>{children}</section> }
function UploadRow({ label }: { label: string }) { return <div className="as-upload"><div><strong>{label}</strong><small>PNG, JPG or SVG · max 2 MB</small></div><button className="as-secondary" type="button"><span className="material-symbols-outlined">upload</span>Upload</button></div> }
function Integration({ name, icon, status, action }: { name: string; icon: string; status: string; action?: () => void }) { return <div className="as-integration"><span className="material-symbols-outlined">{icon}</span><div><strong>{name}</strong><small>{status}</small></div><button className="as-secondary" onClick={action}>{status === 'Connected' ? 'Manage' : 'Connect'}</button></div> }
function StatusRow({ label, value, status, action }: { label: string; value: string; status: string; action?: () => void }) { return <div className="as-status-row"><span className={`as-dot as-dot--${status}`} /><div><strong>{label}</strong><small>{value}</small></div>{action && <button className="as-text-button" onClick={action}>Review</button>}</div> }
function Empty({ label }: { label: string }) { return <div className="as-empty"><span className="material-symbols-outlined">inbox</span>{label}</div> }
