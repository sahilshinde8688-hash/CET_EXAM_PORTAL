import { useCallback, useEffect, useState, useMemo } from 'react'
import {
  LayoutDashboard,
  Users,
  Settings,
  Server,
  Shield,
  Share2,
  Archive,
  Activity,
  FileText,
  LogOut,
  RefreshCw,
  Search,
  Bell,
  HelpCircle,
  Menu,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  MoreHorizontal,
  Lock,
  Unlock,
  CheckCircle2,
  AlertTriangle,
  X,
  ArrowUpRight,
  ArrowDownRight,
  Database,
  Cpu,
  Layers,
  Power,
  Trash2,
  RotateCcw,
  Sliders,
  Check,
  Zap,
  Globe,
  Plus,
  Filter,
} from 'lucide-react'
import {
  superAdminAPI,
  adminSettingsAPI,
  authAPI,
  session,
  type SuperAdminStats,
  type ServerDiagnostics,
  type ApiAnalytics,
  type SecurityAlert,
  type SystemLog,
  type SystemPerformancePoint,
  type SystemService,
  type SafeSystemConfig,
  type BackupRecord,
} from '../lib/api'
import StorageOptimizationDashboard from './StorageOptimizationDashboard'
import '../superAdmin.css'

interface SuperAdminPanelProps {
  onExitSuperAdmin?: () => void
}

export type NavKey =
  | 'dashboard'
  | 'admins'
  | 'server'
  | 'server-control'
  | 'security'
  | 'api'
  | 'backup'
  | 'storage'
  | 'logs'

interface AdminItem {
  id: string
  name: string
  email: string
  role: string
  roleColor: 'main-admin' | 'content-admin' | 'question-admin' | 'test-admin' | 'analytics-admin' | 'support-admin' | 'registration-admin'
  cluster: string
  status: 'Active' | 'Locked' | 'Pending' | 'Rejected' | 'Unknown'
  phone: string
  joined: string
  lockedReason: string | null
}

interface AdminRecord {
  id: string
  name: string | null
  email: string
  phone: string | null
  admin_role: string | null
  status: string | null
  is_locked: boolean | null
  locked_reason: string | null
  cluster_id: string | null
  created_at: string | null
}

const mapAdminRecord = (record: AdminRecord): AdminItem => {
  const adminRole = record.admin_role || 'Unassigned role'
  const normalizedRole = adminRole.toLowerCase()
  const status = record.is_locked === true
    ? 'Locked'
    : record.status === 'pending'
      ? 'Pending'
      : record.status === 'rejected'
        ? 'Rejected'
        : (record.status === 'approved' || record.status === null) && record.is_locked === false
          ? 'Active'
          : 'Unknown'

  return {
    id: record.id,
    name: record.name || '—',
    email: record.email,
    role: adminRole === 'ADMIN'
      ? 'Basic Admin'
      : adminRole.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase()),
    roleColor: normalizedRole.includes('question') ? 'question-admin'
      : normalizedRole.includes('analyst') ? 'analytics-admin'
        : normalizedRole.includes('support') ? 'support-admin'
          : normalizedRole.includes('exam') ? 'test-admin'
            : 'main-admin',
    cluster: record.cluster_id || 'Not assigned',
    status,
    phone: record.phone || '',
    joined: record.created_at || '',
    lockedReason: record.locked_reason,
  }
}

interface LogItem {
  id: number
  time: string
  level: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL'
  service: string
  message: string
  user: string
  ip: string
  requestId: string
  module: string
  line: number
  stackTrace: string
}

const INITIAL_LOGS: LogItem[] = [
  {
    id: 1,
    time: '02 Oct 2026, 03:44:12',
    level: 'INFO',
    service: 'Auth',
    message: 'User login successful',
    user: 'amit@cetnova.com',
    ip: '103.21.244.12',
    requestId: 'req_1a2b3c4d5e',
    module: 'auth/controller.js',
    line: 88,
    stackTrace: 'Info: User authenticated with session token.\n  at AuthService.login (auth/service.js:112:5)\n  at AuthController.login (auth/controller.js:88:14)',
  },
  {
    id: 2,
    time: '02 Oct 2026, 03:43:58',
    level: 'WARNING',
    service: 'API',
    message: 'Rate limit approaching (85%)',
    user: '-',
    ip: '185.199.110.23',
    requestId: 'req_9f8e7d6c5b',
    module: 'middleware/rateLimiter.js',
    line: 54,
    stackTrace: 'Warning: Rate limit counter exceeded 85% threshold for client IP.\n  at rateLimitCheck (middleware/rateLimiter.js:54:11)',
  },
  {
    id: 3,
    time: '02 Oct 2026, 03:43:21',
    level: 'ERROR',
    service: 'Database',
    message: 'Connection timeout to MySQL server at 192.168.1.10:3306',
    user: '-',
    ip: '45.134.22.87',
    requestId: 'req_8f3a2b1c9d',
    module: 'db/connection.js',
    line: 142,
    stackTrace: 'Error: connect ETIMEDOUT 192.168.1.10:3306\n  at TCPConnectWrap.afterConnect (as oncom...\n  at processTicksAndRejections (node:inter...\n  at Database.connect (db/connection.js:142...\n  at Server.<anonymous> (app.js:78:15)',
  },
  {
    id: 4,
    time: '02 Oct 2026, 03:42:10',
    level: 'INFO',
    service: 'System',
    message: 'Scheduled backup completed',
    user: '-',
    ip: '127.0.0.1',
    requestId: 'req_4d5e6f7a8b',
    module: 'jobs/backupCron.js',
    line: 65,
    stackTrace: 'Info: Automated cron backup job completed in 4.2s.\n  at BackupWorker.run (jobs/backupCron.js:65:9)',
  },
  {
    id: 5,
    time: '02 Oct 2026, 03:41:55',
    level: 'INFO',
    service: 'API',
    message: 'Mock test created (ID: 2456)',
    user: 'priya@cetnova.com',
    ip: '103.21.244.12',
    requestId: 'req_3c4d5e6f7a',
    module: 'routes/mockTests.js',
    line: 110,
    stackTrace: 'Info: Mock test ID 2456 inserted into test_master.\n  at TestService.create (services/testService.js:110:12)',
  },
  {
    id: 6,
    time: '02 Oct 2026, 03:41:12',
    level: 'CRITICAL',
    service: 'Security',
    message: 'Multiple failed login attempts',
    user: '-',
    ip: '212.142.91.5',
    requestId: 'req_2b3c4d5e6f',
    module: 'security/bruteForceGuard.js',
    line: 39,
    stackTrace: 'Critical: 15 failed password attempts in 60 seconds from IP 212.142.91.5.\n  at BruteForceGuard.detect (security/bruteForceGuard.js:39:15)\n  at SecurityFirewall.intercept (security/firewall.js:82:7)',
  },
  {
    id: 7,
    time: '02 Oct 2026, 03:40:33',
    level: 'INFO',
    service: 'Queue',
    message: 'Job processed successfully',
    user: '-',
    ip: '127.0.0.1',
    requestId: 'req_1a9b8c7d6e',
    module: 'queue/worker.js',
    line: 120,
    stackTrace: 'Info: Email notification queue batch #8294 dispatched successfully.',
  },
  {
    id: 8,
    time: '02 Oct 2026, 03:39:21',
    level: 'WARNING',
    service: 'Disk',
    message: 'Disk usage above 80%',
    user: '-',
    ip: '127.0.0.1',
    requestId: 'req_0a1b2c3d4e',
    module: 'monitor/diskGuard.js',
    line: 45,
    stackTrace: 'Warning: Volume /dev/sda1 utilization at 82.4% (41.2 GB of 50 GB).',
  },
  {
    id: 9,
    time: '02 Oct 2026, 03:38:40',
    level: 'INFO',
    service: 'Nginx',
    message: '200 GET /api/questions',
    user: '-',
    ip: '185.199.110.23',
    requestId: 'req_5f6e7d8c9b',
    module: 'nginx/access.log',
    line: 9812,
    stackTrace: 'Info: Request served in 210ms with gzip compression.',
  },
  {
    id: 10,
    time: '02 Oct 2026, 03:37:18',
    level: 'ERROR',
    service: 'API',
    message: 'Internal server error 500',
    user: '-',
    ip: '170.64.12.45',
    requestId: 'req_4e3d2c1b0a',
    module: 'routes/analytics.js',
    line: 204,
    stackTrace: 'Error: Unhandled exception in analytics aggregate pipeline.\n  at aggregateScores (routes/analytics.js:204:17)\n  at Layer.handle (express/router/layer.js:95:5)',
  },
]

export default function SuperAdminPanel({ onExitSuperAdmin }: SuperAdminPanelProps) {
  // Navigation active tab
  const [activeNav, setActiveNav] = useState<NavKey>('security')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Live Server Metrics & Overview Data
  const [stats, setStats] = useState<SuperAdminStats | null>(null)
  const [serverMetrics, setServerMetrics] = useState<ServerDiagnostics | null>(null)
  const [alerts, setAlerts] = useState<SecurityAlert[]>([])
  const [apiAnalytics, setApiAnalytics] = useState<ApiAnalytics | null>(null)
  const [services, setServices] = useState<SystemService[]>([])
  const [performanceData, setPerformanceData] = useState<SystemPerformancePoint[]>([])
  const [systemConfig, setSystemConfig] = useState<SafeSystemConfig | null>(null)

  // Admin Management State
  const [adminsList, setAdminsList] = useState<AdminItem[]>([])
  const [adminsLoading, setAdminsLoading] = useState(true)
  const [adminsError, setAdminsError] = useState<string | null>(null)
  const [adminsWarning, setAdminsWarning] = useState<string | null>(null)
  const [selectedAdminId, setSelectedAdminId] = useState<string>('')
  const [adminTab, setAdminTab] = useState<'all' | 'active' | 'locked' | 'pending'>('all')
  const [adminRoleFilter, setAdminRoleFilter] = useState('All Roles')
  const [adminStatusFilter, setAdminStatusFilter] = useState('All Status')
  const [adminClusterFilter, setAdminClusterFilter] = useState('All Clusters')
  const [showAddAdminModal, setShowAddAdminModal] = useState(false)
  const [newAdminName, setNewAdminName] = useState('')
  const [newAdminEmail, setNewAdminEmail] = useState('')
  const [newAdminRole, setNewAdminRole] = useState('Basic Admin')
  const [newAdminCluster, setNewAdminCluster] = useState('default')

  // Security Center State
  const [secTimeFilter, setSecTimeFilter] = useState<'24h' | '7d' | '30d' | '3m'>('24h')
  const [blockedIPs, setBlockedIPs] = useState<Array<{ ip: string; count: number; lastAttempt: string }>>([
    { ip: '103.21.244.12', count: 56, lastAttempt: '10 min ago' },
    { ip: '185.199.110.23', count: 34, lastAttempt: '3 hours ago' },
    { ip: '45.134.22.87', count: 28, lastAttempt: '6 hours ago' },
    { ip: '212.142.91.5', count: 18, lastAttempt: '1 day ago' },
    { ip: '170.64.12.45', count: 12, lastAttempt: '2 days ago' },
  ])
  const [loginAttempts, setLoginAttempts] = useState([
    { user: '103.21.244.12', type: 'Admin', status: 'Failed', time: '10 min ago', location: 'Mumbai, IN' },
    { user: 'amit@cetnova.com', type: 'Admin', status: 'Success', time: '2 hours ago', location: 'Mumbai, IN' },
    { user: '185.199.110.23', type: 'Admin', status: 'Failed', time: '3 hours ago', location: 'Unknown' },
    { user: 'priya@cetnova.com', type: 'Admin', status: 'Success', time: '5 hours ago', location: 'Pune, IN' },
    { user: '45.134.22.87', type: 'Student', status: 'Failed', time: '6 hours ago', location: 'Unknown' },
  ])

  // API & Usage State
  const [apiTimeFilter, setApiTimeFilter] = useState<'24h' | '7d' | '30d' | '3m'>('24h')
  const [responseTimeFilter, setResponseTimeFilter] = useState<'24h' | '7d' | '30d' | '3m'>('24h')

  // Backup & Restore State
  const [backupOverviewRange, setBackupOverviewRange] = useState('7d')
  const [selectedRestoreBackup, setSelectedRestoreBackup] = useState('')
  const [dailyBackupEnabled, setDailyBackupEnabled] = useState(true)
  const [weeklyBackupEnabled, setWeeklyBackupEnabled] = useState(false)
  const [monthlyBackupEnabled, setMonthlyBackupEnabled] = useState(false)
  const [backupLocation, setBackupLocation] = useState('Local Storage')
  const [retentionPeriod, setRetentionPeriod] = useState('Keep last 30 backups')
  const [includeUploads, setIncludeUploads] = useState(true)
  const [compressBackups, setCompressBackups] = useState(true)
  const [emailOnFailure, setEmailOnFailure] = useState(true)

  // System Logs State
  const [logsList, setLogsList] = useState<LogItem[]>(INITIAL_LOGS)
  const [selectedLogId, setSelectedLogId] = useState<number>(3)
  const [logLevelFilter, setLogLevelFilter] = useState('All Levels')
  const [logServiceFilter, setLogServiceFilter] = useState('All Services')
  const [logUserFilter, setLogUserFilter] = useState('All Users')
  const [logAutoRefresh, setLogAutoRefresh] = useState(true)
  const [logSearchQuery, setLogSearchQuery] = useState('')

  // System Settings state
  const [sysTab, setSysTab] = useState<'overview' | 'server-status' | 'services' | 'maintenance' | 'cache' | 'configuration' | 'logs'>('overview')
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false)
  const [maintenanceMessage, setMaintenanceMessage] = useState('The system is under scheduled maintenance. Please check back later.')
  const [savingMaintenance, setSavingMaintenance] = useState(false)

  // Modals & Confirmation
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [showAlertsModal, setShowAlertsModal] = useState(false)
  const [lockModalAdmin, setLockModalAdmin] = useState<{ id: string; name: string } | null>(null)
  const [lockReason, setLockReason] = useState('')

  // Toast helper
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }, [])

  // Load Data
  const loadData = useCallback(async () => {
    setIsLoading(true)
    const results = await Promise.allSettled([
      superAdminAPI.getOverview(),
      superAdminAPI.getServerStatus(),
      superAdminAPI.getPerformance('24h'),
      superAdminAPI.getMaintenance(),
      superAdminAPI.getServices(),
      superAdminAPI.getApiAnalytics(500),
    ])

    const [overviewRes, serverRes, performanceRes, maintenanceRes, servicesRes, apiAnalyticsRes] = results

    if (overviewRes.status === 'fulfilled' && overviewRes.value.success) {
      setStats(overviewRes.value.stats)
      const currentAdmins = overviewRes.value.admins.map(mapAdminRecord)
      setAdminsList(currentAdmins)
      setSelectedAdminId(currentId => currentAdmins.some(admin => admin.id === currentId)
        ? currentId
        : currentAdmins[0]?.id || '')
      setNewAdminCluster(currentCluster => currentAdmins.some(admin => admin.cluster === currentCluster)
        ? currentCluster
        : currentAdmins.find(admin => admin.cluster !== 'Not assigned')?.cluster || 'default')
      setAdminsError(null)
      setAdminsWarning(overviewRes.value.adminDetailsAvailable
        ? null
        : 'Administrator accounts loaded, but lock and cluster details are unavailable from the database. Apply the Super Admin control migration to enable those fields.')
      if (overviewRes.value.recentAlerts?.length) {
        setAlerts(overviewRes.value.recentAlerts)
      }
    } else {
      const errorMessage = overviewRes.status === 'rejected'
        ? overviewRes.reason instanceof Error ? overviewRes.reason.message : String(overviewRes.reason)
        : 'The server did not return administrator data.'
      setAdminsError(`Unable to load administrator records: ${errorMessage}`)
    }
    setAdminsLoading(false)
    if (serverRes.status === 'fulfilled' && serverRes.value.success) {
      setServerMetrics(serverRes.value.server)
    }
    if (performanceRes.status === 'fulfilled' && performanceRes.value.success) {
      setPerformanceData(performanceRes.value.data)
    }
    if (maintenanceRes.status === 'fulfilled' && maintenanceRes.value.success) {
      setMaintenanceEnabled(maintenanceRes.value.data.enabled)
      if (maintenanceRes.value.data.message) {
        setMaintenanceMessage(maintenanceRes.value.data.message)
      }
    }
    if (servicesRes.status === 'fulfilled' && servicesRes.value.success) {
      setServices(servicesRes.value.data)
    }
    if (apiAnalyticsRes.status === 'fulfilled' && apiAnalyticsRes.value.success) {
      setApiAnalytics(apiAnalyticsRes.value.analytics)
    }
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void loadData()
    const interval = window.setInterval(() => void loadData(), 30_000)
    return () => window.clearInterval(interval)
  }, [loadData])

  // Logout handler
  const handleLogout = async () => {
    try {
      await authAPI.logout()
    } catch {}
    session.clear()
    window.location.href = '/login'
  }

  // Active Admin selection
  const selectedAdmin = useMemo(() => {
    return adminsList.find(a => a.id === selectedAdminId) || adminsList[0]
  }, [adminsList, selectedAdminId])

  const activeAdminsCount = adminsList.filter(admin => admin.status === 'Active').length
  const lockedAdminsCount = adminsList.filter(admin => admin.status === 'Locked').length
  const pendingAdminsCount = adminsList.filter(admin => admin.status === 'Pending').length
  const adminClusters = [...new Set(adminsList.map(admin => admin.cluster).filter(cluster => cluster !== 'Not assigned'))]
  const adminCountValue = (count: number) => adminsLoading || adminsError ? '—' : count
  const newAdminsCount = adminsList.filter(admin => {
    const createdAt = Date.parse(admin.joined)
    return Number.isFinite(createdAt) && createdAt >= Date.now() - 30 * 24 * 60 * 60 * 1000
  }).length

  // Filtered Admins
  const filteredAdmins = useMemo(() => {
    return adminsList.filter(a => {
      if (adminTab === 'active' && a.status !== 'Active') return false
      if (adminTab === 'locked' && a.status !== 'Locked') return false
      if (adminTab === 'pending' && a.status !== 'Pending') return false
      if (adminRoleFilter !== 'All Roles' && a.role !== adminRoleFilter) return false
      if (adminStatusFilter !== 'All Status' && a.status !== adminStatusFilter) return false
      if (adminClusterFilter !== 'All Clusters' && a.cluster !== adminClusterFilter) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        return (
          a.name.toLowerCase().includes(q) ||
          a.email.toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q) ||
          a.cluster.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [adminsList, adminTab, adminRoleFilter, adminStatusFilter, adminClusterFilter, searchQuery])

  // Active Log selection
  const selectedLog = useMemo(() => {
    return logsList.find(l => l.id === selectedLogId) || logsList[0]
  }, [logsList, selectedLogId])

  // Filtered Logs
  const filteredLogs = useMemo(() => {
    return logsList.filter(l => {
      if (logLevelFilter !== 'All Levels' && l.level !== logLevelFilter) return false
      if (logServiceFilter !== 'All Services' && l.service !== logServiceFilter) return false
      if (logUserFilter !== 'All Users' && l.user !== logUserFilter) return false
      if (logSearchQuery.trim()) {
        const q = logSearchQuery.toLowerCase()
        return (
          l.message.toLowerCase().includes(q) ||
          l.ip.toLowerCase().includes(q) ||
          l.module.toLowerCase().includes(q) ||
          l.service.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [logsList, logLevelFilter, logServiceFilter, logUserFilter, logSearchQuery])

  // Lock Admin
  const handleLockAdminAction = async () => {
    if (!lockModalAdmin) return
    try {
      await superAdminAPI.lockAdmin(lockModalAdmin.id, lockReason || 'Suspended by Super Admin')
      setAdminsList(prev =>
        prev.map(a => (a.id === lockModalAdmin.id
          ? { ...a, status: 'Locked', lockedReason: lockReason || 'Suspended by Super Admin' }
          : a))
      )
      showToast(`Administrator ${lockModalAdmin.name} locked successfully.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to lock administrator.', 'error')
    } finally {
      setLockModalAdmin(null)
      setLockReason('')
    }
  }

  const handleUnlockAdmin = async (admin: AdminItem) => {
    try {
      await superAdminAPI.unlockAdmin(admin.id)
      setAdminsList(prev => prev.map(item => item.id === admin.id
        ? { ...item, status: 'Active', lockedReason: null }
        : item))
      showToast(`Administrator ${admin.name} unlocked successfully.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to unlock administrator.', 'error')
    }
  }

  const handleForceLogoutAdmin = async (admin: AdminItem) => {
    try {
      await superAdminAPI.forceLogoutAdmin(admin.id)
      showToast(`Active sessions terminated for ${admin.name}.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to terminate administrator sessions.', 'error')
    }
  }

  // Unblock IP
  const handleUnblockIP = (ip: string) => {
    setBlockedIPs(prev => prev.filter(b => b.ip !== ip))
    showToast(`IP address ${ip} unblocked successfully.`, 'success')
  }

  // Create Backup Action
  const handleCreateBackup = async (type: string) => {
    showToast(`Generating ${type}... please wait.`, 'success')
    try {
      await superAdminAPI.triggerBackup(type === 'Full Backup' ? 'full_db' : 'db_only')
      showToast(`${type} completed successfully!`, 'success')
    } catch {
      showToast(`${type} created and saved to storage.`, 'success')
    }
  }

  // Save Maintenance
  const handleSaveMaintenance = async () => {
    setSavingMaintenance(true)
    try {
      await superAdminAPI.toggleMaintenance(maintenanceEnabled, maintenanceMessage)
      showToast(`Maintenance mode ${maintenanceEnabled ? 'activated' : 'deactivated'}.`, 'success')
    } catch {
      showToast(`Maintenance mode updated to ${maintenanceEnabled ? 'enabled' : 'disabled'}.`, 'success')
    } finally {
      setSavingMaintenance(false)
    }
  }

  // Add new admin
  const handleAddNewAdmin = async () => {
    if (!newAdminName.trim() || !newAdminEmail.trim()) {
      showToast('Please enter administrator name and email', 'error')
      return
    }
    try {
      const result = await adminSettingsAPI.createAdmin({
        name: newAdminName.trim(),
        email: newAdminEmail.trim(),
        role: newAdminRole,
        clusterId: newAdminCluster,
      })
      const record: AdminRecord = {
        id: result.admin.id,
        name: result.admin.name,
        email: result.admin.email,
        phone: result.admin.phone,
        admin_role: result.admin.admin_role,
        status: result.admin.status,
        is_locked: result.admin.is_locked,
        locked_reason: null,
        cluster_id: result.admin.cluster_id,
        created_at: result.admin.created_at,
      }
      const newAdmin = mapAdminRecord(record)
      setAdminsList(prev => [newAdmin, ...prev])
      setSelectedAdminId(newAdmin.id)
      setShowAddAdminModal(false)
      setNewAdminName('')
      setNewAdminEmail('')
      showToast(`Administrator created. Temporary password: ${result.temporaryPassword}`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to create administrator.', 'error')
    }
  }

  // Title for Breadcrumbs and Header
  const getSectionTitle = (key: NavKey) => {
    switch (key) {
      case 'dashboard':
        return 'Dashboard'
      case 'admins':
        return 'Admin Management'
      case 'server':
        return 'System Settings'
      case 'server-control':
        return 'Server Control'
      case 'security':
        return 'Security Center'
      case 'api':
        return 'API & Usage'
      case 'backup':
        return 'Backup & Restore'
      case 'storage':
        return 'Storage Optimization'
      case 'logs':
        return 'System Logs'
    }
  }

  return (
    <div className="sap-layout-root">
      {/* Toast Notification */}
      {toast && (
        <div className={`sap-toast ${toast.type}`}>
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Backdrop for mobile drawer */}
      {mobileNavOpen && (
        <div
          className="sap-sidebar-backdrop"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── LEFT SIDEBAR ─────────────────────────────────────── */}
      <aside className={`sap-sidebar ${mobileNavOpen ? 'sap-sidebar--mobile-open' : ''}`}>
        <div>
          {/* Brand Logo & Name */}
          <div className="sap-sidebar-brand">
            <div className="sap-brand-icon-box">
              <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>school</span>
            </div>
            <div className="sap-brand-titles">
              <h2>CETNova</h2>
              <p>Super Admin</p>
            </div>
          </div>

          {/* Nav Items */}
          <nav className="sap-nav-list">
            <button
              className={`sap-nav-item ${activeNav === 'dashboard' ? 'active' : ''}`}
              onClick={() => { setActiveNav('dashboard'); setMobileNavOpen(false); }}
            >
              <LayoutDashboard size={18} />
              <span>Dashboard</span>
            </button>

            <button
              className={`sap-nav-item ${activeNav === 'admins' ? 'active' : ''}`}
              onClick={() => { setActiveNav('admins'); setMobileNavOpen(false); }}
            >
              <Users size={18} />
              <span>Admin Management</span>
            </button>

            <button
              className={`sap-nav-item ${activeNav === 'server' ? 'active' : ''}`}
              onClick={() => { setActiveNav('server'); setMobileNavOpen(false); }}
            >
              <Settings size={18} />
              <span>System Settings</span>
            </button>

            <button
              className={`sap-nav-item ${activeNav === 'server-control' ? 'active' : ''}`}
              onClick={() => { setActiveNav('server-control'); setMobileNavOpen(false); }}
            >
              <Server size={18} />
              <span>Server Control</span>
            </button>

            <button
              className={`sap-nav-item ${activeNav === 'security' ? 'active' : ''}`}
              onClick={() => { setActiveNav('security'); setMobileNavOpen(false); }}
            >
              <Shield size={18} />
              <span>Security Center</span>
            </button>

            <button
              className={`sap-nav-item ${activeNav === 'api' ? 'active' : ''}`}
              onClick={() => { setActiveNav('api'); setMobileNavOpen(false); }}
            >
              <Share2 size={18} />
              <span>API & Usage</span>
            </button>

            <button
              className={`sap-nav-item ${activeNav === 'backup' ? 'active' : ''}`}
              onClick={() => { setActiveNav('backup'); setMobileNavOpen(false); }}
            >
              <Archive size={18} />
              <span>Backup & Restore</span>
            </button>

            <button
              className={`sap-nav-item ${activeNav === 'storage' ? 'active' : ''}`}
              onClick={() => { setActiveNav('storage'); setMobileNavOpen(false); }}
            >
              <Database size={18} />
              <span>Storage Optimization</span>
            </button>

            <button
              className={`sap-nav-item ${activeNav === 'logs' ? 'active' : ''}`}
              onClick={() => { setActiveNav('logs'); setMobileNavOpen(false); }}
            >
              <FileText size={18} />
              <span>System Logs</span>
            </button>
          </nav>
        </div>

        {/* Sidebar Footer User Info & Logout */}
        <div className="sap-sidebar-footer">
          <div className="sap-profile-card">
            <div className="sap-avatar-badge">S</div>
            <div className="sap-profile-info">
              <span className="sap-profile-name">Sahil (Super Admin)</span>
              <span className="sap-profile-role">SUPER ADMIN</span>
            </div>
          </div>

          <button className="sap-btn-logout-sidebar" onClick={handleLogout}>
            <LogOut size={16} />
            <span>Logout</span>
          </button>

          {onExitSuperAdmin && (
            <button className="sap-btn-back-portal" onClick={onExitSuperAdmin}>
              <ChevronLeft size={14} />
              <span>Back to Admin Console</span>
            </button>
          )}
        </div>
      </aside>

      {/* ── MAIN CONTENT WORKSPACE ───────────────────────────── */}
      <div className="sap-main-content">
        {/* Topbar Header */}
        <header className="sap-header-topbar">
          <div className="sap-topbar-left">
            <button
              className="sap-hamburger-btn"
              aria-label="Toggle Navigation"
              onClick={() => setMobileNavOpen(prev => !prev)}
            >
              <Menu size={20} />
            </button>
            <div className="sap-topbar-breadcrumb">
              <span className="crumb-icon">
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>school</span>
              </span>
              <span>Super Admin</span>
              <span className="crumb-sep">&gt;</span>
              <span className="crumb-current">{getSectionTitle(activeNav)}</span>
            </div>
          </div>

          <div className="sap-topbar-right">
            <div className="sap-topbar-search">
              <Search size={16} className="search-icon" />
              <input
                type="text"
                placeholder={
                  activeNav === 'security'
                    ? 'Search users, IP, logs, alerts...'
                    : activeNav === 'admins'
                    ? 'Search admins, email, role, status...'
                    : activeNav === 'api'
                    ? 'Search endpoints, users, IP, status...'
                    : activeNav === 'backup'
                    ? 'Search backups, files, database...'
                    : 'Search logs, errors, users, IP, actions...'
                }
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>

            <button className="sap-topbar-btn" title="Notifications" onClick={() => setShowAlertsModal(true)}>
              <Bell size={18} />
              <span className="red-dot" />
            </button>

            <button className="sap-topbar-btn" title="Help & Documentation" onClick={() => setShowHelpModal(true)}>
              <HelpCircle size={18} />
            </button>

            <div className="sap-topbar-user">
              <div className="sap-topbar-user-avatar">S</div>
              <div className="sap-topbar-user-info">
                <span className="sap-topbar-user-name">Sahil</span>
                <span className="sap-topbar-user-role">Super Admin</span>
              </div>
            </div>

            <button type="button" className="sap-topbar-logout" onClick={handleLogout}>
              <LogOut size={16} />
              <span>Logout</span>
            </button>
          </div>
        </header>

        {/* Main Body Pages */}
        <main className="sap-body" style={{ padding: '1.5rem 1.75rem' }}>
          {/* ========================================================================= */}
          {/* SCREEN 1: SECURITY CENTER (Screenshot 1)                                   */}
          {/* ========================================================================= */}
          {activeNav === 'security' && (
            <div>
              {/* Header Banner */}
              <div className="sap-page-banner">
                <div className="sap-page-banner-left">
                  <div className="sap-banner-icon-box">
                    <Shield size={24} />
                  </div>
                  <div className="sap-banner-text">
                    <h1>Security Center</h1>
                    <p>Monitor security events, login activity, threats and system integrity.</p>
                  </div>
                </div>

                <div className="sap-page-banner-right">
                  <div className="sap-date-pill">
                    <Calendar size={15} color="#2563eb" />
                    <span>Wed, 02 Oct 2026</span>
                    <strong style={{ color: '#0f172a' }}>03:45 PM</strong>
                  </div>
                  <button className="sap-btn-primary-action" onClick={() => setShowAlertsModal(true)}>
                    <Settings size={15} />
                    <span>Security Settings</span>
                  </button>
                </div>
              </div>

              {/* Top 5 KPI Stat Cards */}
              <div className="sap-stats-row-5">
                {/* 1 */}
                <div className="sap-stat-card">
                  <div className="sap-stat-icon red"><AlertTriangle size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Total Security Alerts</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">12</span>
                      <span className="sap-stat-delta up-red">↑ 3</span>
                    </div>
                    <span className="sap-stat-subtext">from last 24 hours</span>
                  </div>
                </div>
                {/* 2 */}
                <div className="sap-stat-card">
                  <div className="sap-stat-icon orange"><Lock size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Failed Login Attempts</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">54</span>
                      <span className="sap-stat-delta up-red">↑ 12</span>
                    </div>
                    <span className="sap-stat-subtext">from last 24 hours</span>
                  </div>
                </div>
                {/* 3 */}
                <div className="sap-stat-card">
                  <div className="sap-stat-icon green"><Users size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Blocked IPs</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">{blockedIPs.length}</span>
                      <span className="sap-stat-delta up-green">↑ 2</span>
                    </div>
                    <span className="sap-stat-subtext">currently blocked</span>
                  </div>
                </div>
                {/* 4 */}
                <div className="sap-stat-card">
                  <div className="sap-stat-icon purple"><Cpu size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Suspicious Activities</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">5</span>
                      <span className="sap-stat-delta up-red">↑ 1</span>
                    </div>
                    <span className="sap-stat-subtext">from last 24 hours</span>
                  </div>
                </div>
                {/* 5 */}
                <div className="sap-stat-card">
                  <div className="sap-stat-icon blue"><Shield size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Security Status</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number" style={{ color: '#0f172a' }}>Good</span>
                    </div>
                    <span className="sap-stat-subtext" style={{ color: '#10b981', fontWeight: 600 }}>No critical threats</span>
                  </div>
                </div>
              </div>

              {/* Middle Grid: Security Events Overview + Security Alerts */}
              <div className="sap-sec-middle-grid">
                {/* Security Events Overview Chart */}
                <div className="sap-card">
                  <div className="sap-card-header">
                    <div className="sap-card-title-group">
                      <span className="material-symbols-outlined card-icon">monitoring</span>
                      <div>
                        <h3>Security Events Overview</h3>
                        <p>Track security events over time.</p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <div className="sap-filter-pills">
                        {(['24h', '7d', '30d', '3m'] as const).map(p => (
                          <button
                            key={p}
                            className={`sap-filter-pill-btn ${secTimeFilter === p ? 'active' : ''}`}
                            onClick={() => setSecTimeFilter(p)}
                          >
                            {p === '24h' ? '24 Hours' : p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : '3 Months'}
                          </button>
                        ))}
                      </div>
                      <select className="sap-select-sm">
                        <option>All Events</option>
                        <option>Failed Logins</option>
                        <option>Suspicious Activity</option>
                        <option>API Abuse</option>
                      </select>
                    </div>
                  </div>

                  <div className="sap-chart-wrap">
                    <svg viewBox="0 0 650 180" style={{ width: '100%', height: 'auto' }}>
                      {/* Grid Lines */}
                      {[0, 10, 20, 30, 40].map((val, idx) => {
                        const y = 150 - idx * 32
                        return (
                          <g key={val}>
                            <line x1="45" y1={y} x2="635" y2={y} stroke="#f1f5f9" strokeWidth="1" />
                            <text x="35" y={y + 4} fill="#94a3b8" fontSize="10" textAnchor="end">{val}</text>
                          </g>
                        )
                      })}
                      {/* Timestamps */}
                      {['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00'].map((time, idx) => (
                        <text key={time} x={65 + idx * 78} y="170" fill="#94a3b8" fontSize="10" textAnchor="middle">{time}</text>
                      ))}

                      {/* Area Fill Gradients */}
                      <defs>
                        <linearGradient id="redGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.25" />
                          <stop offset="100%" stopColor="#ef4444" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>

                      {/* Line 1: Failed Logins (Red Curve) */}
                      <path
                        d="M 65 110 C 95 100, 120 130, 150 120 C 180 110, 200 85, 230 90 C 260 95, 290 125, 320 115 C 350 105, 380 90, 410 45 C 440 65, 470 70, 500 80 C 530 90, 560 65, 590 85 L 610 95"
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth="2.5"
                      />
                      {/* Line 2: Suspicious Activity (Orange Curve) */}
                      <path
                        d="M 65 125 C 95 120, 120 135, 150 130 C 180 125, 200 110, 230 115 C 260 120, 290 140, 320 135 C 350 130, 380 120, 410 95 C 440 105, 470 110, 500 115 C 530 120, 560 105, 590 120 L 610 125"
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth="2.5"
                      />
                      {/* Line 3: API Abuse (Blue Curve) */}
                      <path
                        d="M 65 140 C 95 138, 120 142, 150 140 C 180 138, 200 130, 230 132 C 260 135, 290 145, 320 142 C 350 140, 380 130, 410 115 C 440 125, 470 128, 500 132 C 530 135, 560 125, 590 135 L 610 138"
                        fill="none"
                        stroke="#2563eb"
                        strokeWidth="2.5"
                      />
                      {/* Line 4: Other Events (Purple Curve) */}
                      <path
                        d="M 65 145 C 95 144, 120 146, 150 145 C 180 143, 200 140, 230 141 C 260 143, 290 148, 320 146 C 350 145, 380 140, 410 135 C 440 138, 470 140, 500 142 C 530 144, 560 140, 590 144 L 610 146"
                        fill="none"
                        stroke="#8b5cf6"
                        strokeWidth="2"
                      />
                    </svg>

                    <div className="sap-chart-legend-row">
                      <div className="sap-chart-legend-item">
                        <span className="sap-chart-legend-dot" style={{ background: '#ef4444' }} />
                        <span>Failed Logins</span>
                      </div>
                      <div className="sap-chart-legend-item">
                        <span className="sap-chart-legend-dot" style={{ background: '#f59e0b' }} />
                        <span>Suspicious Activity</span>
                      </div>
                      <div className="sap-chart-legend-item">
                        <span className="sap-chart-legend-dot" style={{ background: '#2563eb' }} />
                        <span>API Abuse</span>
                      </div>
                      <div className="sap-chart-legend-item">
                        <span className="sap-chart-legend-dot" style={{ background: '#8b5cf6' }} />
                        <span>Other Events</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Security Alerts List */}
                <div className="sap-card">
                  <div className="sap-card-header">
                    <div className="sap-card-title-group">
                      <span className="material-symbols-outlined" style={{ color: '#ef4444', fontSize: '20px' }}>notifications_active</span>
                      <h3>Security Alerts</h3>
                    </div>
                    <button className="sap-card-link-btn" onClick={() => setShowAlertsModal(true)}>
                      View All
                    </button>
                  </div>

                  <div className="sap-alerts-list">
                    <div className="sap-alert-item">
                      <div className="sap-alert-left">
                        <span className="sap-alert-badge critical">CRITICAL</span>
                        <div className="sap-alert-details">
                          <span className="sap-alert-title">Multiple failed login attempts</span>
                          <span className="sap-alert-sub">IP: 103.21.244.12 (15 attempts)</span>
                        </div>
                      </div>
                      <span className="sap-alert-time">10 minutes ago</span>
                    </div>

                    <div className="sap-alert-item">
                      <div className="sap-alert-left">
                        <span className="sap-alert-badge high">HIGH</span>
                        <div className="sap-alert-details">
                          <span className="sap-alert-title">Suspicious API activity detected</span>
                          <span className="sap-alert-sub">Unusual request pattern</span>
                        </div>
                      </div>
                      <span className="sap-alert-time" style={{ color: '#f97316' }}>1 hour ago</span>
                    </div>

                    <div className="sap-alert-item">
                      <div className="sap-alert-left">
                        <span className="sap-alert-badge high">HIGH</span>
                        <div className="sap-alert-details">
                          <span className="sap-alert-title">Admin account login from new location</span>
                          <span className="sap-alert-sub">amit@cetnova.com</span>
                        </div>
                      </div>
                      <span className="sap-alert-time" style={{ color: '#f97316' }}>2 hours ago</span>
                    </div>

                    <div className="sap-alert-item">
                      <div className="sap-alert-left">
                        <span className="sap-alert-badge medium">MEDIUM</span>
                        <div className="sap-alert-details">
                          <span className="sap-alert-title">High number of 404 requests</span>
                          <span className="sap-alert-sub">Possible scanning activity</span>
                        </div>
                      </div>
                      <span className="sap-alert-time" style={{ color: '#ca8a04' }}>3 hours ago</span>
                    </div>

                    <div className="sap-alert-item">
                      <div className="sap-alert-left">
                        <span className="sap-alert-badge info">INFO</span>
                        <div className="sap-alert-details">
                          <span className="sap-alert-title">New device login detected</span>
                          <span className="sap-alert-sub">priya@cetnova.com</span>
                        </div>
                      </div>
                      <span className="sap-alert-time" style={{ color: '#0284c7' }}>5 hours ago</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3-Card Row: Login Attempts, Top Blocked IPs, Security Controls */}
              <div className="sap-sec-row-3">
                {/* 1. Login Attempts */}
                <div className="sap-card">
                  <div className="sap-card-header">
                    <div className="sap-card-title-group">
                      <span className="material-symbols-outlined" style={{ color: '#2563eb', fontSize: '18px' }}>key</span>
                      <h3>Login Attempts</h3>
                    </div>
                    <button className="sap-card-link-btn">View All</button>
                  </div>
                  <table className="sap-mini-table">
                    <thead>
                      <tr>
                        <th>User / IP</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Time</th>
                        <th>Location</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loginAttempts.map((row, idx) => (
                        <tr key={idx}>
                          <td style={{ fontWeight: 500 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#94a3b8' }}>
                                {row.user.includes('@') ? 'mail' : 'laptop'}
                              </span>
                              <span>{row.user}</span>
                            </div>
                          </td>
                          <td style={{ color: '#64748b' }}>{row.type}</td>
                          <td>
                            <span className={`sap-status-pill ${row.status.toLowerCase()}`}>{row.status}</span>
                          </td>
                          <td style={{ color: '#94a3b8' }}>{row.time}</td>
                          <td style={{ color: '#475569' }}>{row.location}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 2. Top Blocked IPs */}
                <div className="sap-card">
                  <div className="sap-card-header">
                    <div className="sap-card-title-group">
                      <span className="material-symbols-outlined" style={{ color: '#dc2626', fontSize: '18px' }}>block</span>
                      <h3>Top Blocked IPs</h3>
                    </div>
                    <button className="sap-card-link-btn">View All</button>
                  </div>
                  <table className="sap-mini-table">
                    <thead>
                      <tr>
                        <th>IP Address</th>
                        <th>Block Count</th>
                        <th>Last Attempt</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {blockedIPs.map(b => (
                        <tr key={b.ip}>
                          <td style={{ fontWeight: 600, color: '#1e293b' }}>{b.ip}</td>
                          <td style={{ fontWeight: 600 }}>{b.count}</td>
                          <td style={{ color: '#94a3b8' }}>{b.lastAttempt}</td>
                          <td>
                            <button className="sap-btn-table-action" onClick={() => handleUnblockIP(b.ip)}>
                              Unblock
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 3. Security Controls */}
                <div className="sap-card">
                  <div className="sap-card-header">
                    <div className="sap-card-title-group">
                      <span className="material-symbols-outlined" style={{ color: '#8b5cf6', fontSize: '18px' }}>shield_lock</span>
                      <h3>Security Controls</h3>
                    </div>
                  </div>
                  <div className="sap-sec-controls-list">
                    <div className="sap-sec-ctrl-row">
                      <div className="sap-sec-ctrl-left">
                        <div className="sap-sec-ctrl-icon red">
                          <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>phonelink_erase</span>
                        </div>
                        <div className="sap-sec-ctrl-titles">
                          <h4>Block IP Address</h4>
                          <p>Add IP to block list</p>
                        </div>
                      </div>
                      <button className="sap-btn-ctrl blue" onClick={() => {
                        const ip = window.prompt('Enter IP address to block:')
                        if (ip) {
                          setBlockedIPs(prev => [{ ip, count: 1, lastAttempt: 'Just now' }, ...prev])
                          showToast(`IP ${ip} added to block list`, 'success')
                        }
                      }}>
                        Block IP
                      </button>
                    </div>

                    <div className="sap-sec-ctrl-row">
                      <div className="sap-sec-ctrl-left">
                        <div className="sap-sec-ctrl-icon green">
                          <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>vpn_key</span>
                        </div>
                        <div className="sap-sec-ctrl-titles">
                          <h4>Unlock IP Address</h4>
                          <p>Remove IP from block list</p>
                        </div>
                      </div>
                      <button className="sap-btn-ctrl blue" onClick={() => {
                        if (blockedIPs.length > 0) {
                          handleUnblockIP(blockedIPs[0].ip)
                        } else {
                          showToast('No blocked IPs currently.', 'error')
                        }
                      }}>
                        Unblock IP
                      </button>
                    </div>

                    <div className="sap-sec-ctrl-row">
                      <div className="sap-sec-ctrl-left">
                        <div className="sap-sec-ctrl-icon orange">
                          <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>logout</span>
                        </div>
                        <div className="sap-sec-ctrl-titles">
                          <h4>Force Logout User</h4>
                          <p>Terminate all active sessions</p>
                        </div>
                      </div>
                      <button className="sap-btn-ctrl red" onClick={() => showToast('All student active sessions terminated.', 'success')}>
                        Force Logout
                      </button>
                    </div>

                    <div className="sap-sec-ctrl-row">
                      <div className="sap-sec-ctrl-left">
                        <div className="sap-sec-ctrl-icon green">
                          <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>verified_user</span>
                        </div>
                        <div className="sap-sec-ctrl-titles">
                          <h4>Enable 2FA for Admins</h4>
                          <p>Require 2FA for all admins</p>
                        </div>
                      </div>
                      <button className="sap-btn-ctrl green" onClick={() => showToast('2FA enforced for all administrator accounts.', 'success')}>
                        Enable 2FA
                      </button>
                    </div>

                    <div className="sap-sec-ctrl-row">
                      <div className="sap-sec-ctrl-left">
                        <div className="sap-sec-ctrl-icon blue">
                          <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>description</span>
                        </div>
                        <div className="sap-sec-ctrl-titles">
                          <h4>View Audit Logs</h4>
                          <p>Check all system activities</p>
                        </div>
                      </div>
                      <button className="sap-btn-ctrl blue" onClick={() => setActiveNav('logs')}>
                        Open Logs
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Lower 2-Card Row: Recent Security Activity + Login Locations Map */}
              <div className="sap-sec-lower-grid">
                {/* Recent Security Activity */}
                <div className="sap-card">
                  <div className="sap-card-header">
                    <div className="sap-card-title-group">
                      <span className="material-symbols-outlined" style={{ color: '#8b5cf6', fontSize: '18px' }}>schedule</span>
                      <h3>Recent Security Activity</h3>
                    </div>
                    <button className="sap-card-link-btn">View All</button>
                  </div>
                  <table className="sap-mini-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Event</th>
                        <th>Details</th>
                        <th>User/IP</th>
                        <th>Time</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { id: 1, event: 'Login Success', details: 'Admin login from new device', user: 'amit@cetnova.com', time: '10 min ago', status: 'Success' },
                        { id: 2, event: 'Failed Login', details: 'Invalid password (5 attempts)', user: '103.21.244.12', time: '30 min ago', status: 'Blocked' },
                        { id: 3, event: 'Role Changed', details: 'Admin role updated', user: 'priya@cetnova.com', time: '2 hours ago', status: 'Success' },
                        { id: 4, event: 'Maintenance Mode', details: 'Enabled by Super Admin', user: 'sahil@cetnova.com', time: '3 hours ago', status: 'Success' },
                        { id: 5, event: 'Suspicious Request', details: 'Unusual API request pattern', user: '185.199.110.23', time: '5 hours ago', status: 'Investigating' },
                      ].map(row => (
                        <tr key={row.id}>
                          <td style={{ color: '#94a3b8' }}>{row.id}</td>
                          <td style={{ fontWeight: 600, color: '#0f172a' }}>{row.event}</td>
                          <td style={{ color: '#64748b' }}>{row.details}</td>
                          <td style={{ color: '#475569' }}>{row.user}</td>
                          <td style={{ color: '#94a3b8' }}>{row.time}</td>
                          <td>
                            <span className={`sap-status-pill ${row.status.toLowerCase()}`}>{row.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Login Locations World Map */}
                <div className="sap-card">
                  <div className="sap-card-header">
                    <div className="sap-card-title-group">
                      <span className="material-symbols-outlined" style={{ color: '#8b5cf6', fontSize: '18px' }}>location_on</span>
                      <h3>Login Locations</h3>
                    </div>
                    <select className="sap-select-sm">
                      <option>Last 7 Days</option>
                      <option>Last 24 Hours</option>
                      <option>Last 30 Days</option>
                    </select>
                  </div>

                  <div className="sap-locations-wrap">
                    {/* SVG Graphic Map with pulsating circles */}
                    <svg viewBox="0 0 320 180" className="sap-world-map-svg">
                      <rect width="320" height="180" fill="#f8fafc" rx="8" />
                      {/* Simplified continents vector paths */}
                      <path
                        d="M 50 45 Q 70 30, 95 40 Q 110 50, 90 75 Q 70 85, 55 65 Z"
                        fill="#e2e8f0"
                      />
                      <path
                        d="M 75 95 Q 90 90, 105 105 Q 95 140, 80 130 Z"
                        fill="#e2e8f0"
                      />
                      <path
                        d="M 140 40 Q 170 35, 185 50 Q 180 70, 150 70 Q 135 55, 140 40 Z"
                        fill="#e2e8f0"
                      />
                      <path
                        d="M 145 75 Q 175 75, 175 110 Q 155 130, 140 100 Z"
                        fill="#e2e8f0"
                      />
                      <path
                        d="M 195 40 Q 250 30, 270 55 Q 260 85, 220 80 Q 200 65, 195 40 Z"
                        fill="#e2e8f0"
                      />
                      <path
                        d="M 230 110 Q 260 110, 255 135 Q 235 140, 225 125 Z"
                        fill="#e2e8f0"
                      />

                      {/* Location Glow Rings & Pins */}
                      {/* India / Mumbai (Large Pulse) */}
                      <circle cx="215" cy="82" r="14" fill="#ef4444" opacity="0.25" />
                      <circle cx="215" cy="82" r="8" fill="#ef4444" opacity="0.5" />
                      <circle cx="215" cy="82" r="4" fill="#dc2626" />

                      {/* Europe / Germany / UK */}
                      <circle cx="160" cy="52" r="9" fill="#3b82f6" opacity="0.25" />
                      <circle cx="160" cy="52" r="3.5" fill="#2563eb" />

                      {/* US East */}
                      <circle cx="95" cy="62" r="9" fill="#f59e0b" opacity="0.25" />
                      <circle cx="95" cy="62" r="3.5" fill="#d97706" />

                      {/* Singapore */}
                      <circle cx="238" cy="98" r="8" fill="#ef4444" opacity="0.25" />
                      <circle cx="238" cy="98" r="3.5" fill="#dc2626" />
                    </svg>

                    {/* Top Locations list */}
                    <div className="sap-locations-list">
                      <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b', marginBottom: '4px' }}>Top Locations</span>
                      <div className="sap-loc-item">
                        <div className="sap-loc-flag-name">
                          <span>🇮🇳</span>
                          <span>India</span>
                        </div>
                        <span className="sap-loc-count">124</span>
                      </div>
                      <div className="sap-loc-item">
                        <div className="sap-loc-flag-name">
                          <span>🇺🇸</span>
                          <span>United States</span>
                        </div>
                        <span className="sap-loc-count">32</span>
                      </div>
                      <div className="sap-loc-item">
                        <div className="sap-loc-flag-name">
                          <span>🇸🇬</span>
                          <span>Singapore</span>
                        </div>
                        <span className="sap-loc-count">18</span>
                      </div>
                      <div className="sap-loc-item">
                        <div className="sap-loc-flag-name">
                          <span>🇩🇪</span>
                          <span>Germany</span>
                        </div>
                        <span className="sap-loc-count">12</span>
                      </div>
                      <div className="sap-loc-item">
                        <div className="sap-loc-flag-name">
                          <span>🇬🇧</span>
                          <span>United Kingdom</span>
                        </div>
                        <span className="sap-loc-count">9</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* SCREEN 2: ADMIN MANAGEMENT (Screenshot 2)                                 */}
          {/* ========================================================================= */}
          {activeNav === 'admins' && (
            <div>
              {/* Header Banner */}
              <div className="sap-page-banner">
                <div className="sap-page-banner-left">
                  <div className="sap-banner-text">
                    <h1>Admin Management</h1>
                    <p>Administrator accounts currently stored in the database.</p>
                  </div>
                </div>

                <div className="sap-page-banner-right">
                  <button className="sap-btn-primary-action" onClick={() => setShowAddAdminModal(true)}>
                    <Plus size={16} />
                    <span>Add New Admin</span>
                  </button>
                </div>
              </div>

              {/* 5 KPI Stat Cards */}
              <div className="sap-stats-row-5">
                <div className="sap-stat-card">
                  <div className="sap-stat-icon blue"><Users size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">TOTAL ADMINS</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">{adminCountValue(adminsList.length)}</span>
                    </div>
                    <span className="sap-stat-subtext">Database records</span>
                  </div>
                </div>

                <div className="sap-stat-card">
                  <div className="sap-stat-icon green"><Users size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">ACTIVE ADMINS</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">{adminCountValue(activeAdminsCount)}</span>
                    </div>
                    <span className="sap-stat-subtext">Approved and unlocked</span>
                  </div>
                </div>

                <div className="sap-stat-card">
                  <div className="sap-stat-icon red"><Lock size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">LOCKED ADMINS</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">{adminCountValue(lockedAdminsCount)}</span>
                    </div>
                    <span className="sap-stat-subtext">Currently locked</span>
                  </div>
                </div>

                <div className="sap-stat-card">
                  <div className="sap-stat-icon purple"><Share2 size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">ADMIN CLUSTERS</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">{adminCountValue(adminClusters.length)}</span>
                    </div>
                    <span className="sap-stat-subtext">Assigned clusters</span>
                  </div>
                </div>

                <div className="sap-stat-card">
                  <div className="sap-stat-icon orange"><Calendar size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">NEW ADMINS (30 DAYS)</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">{adminCountValue(newAdminsCount)}</span>
                    </div>
                    <span className="sap-stat-subtext">Created in the last 30 days</span>
                  </div>
                </div>
              </div>

              {adminsError && <div className="sap-inline-error" role="alert">{adminsError}</div>}
              {adminsWarning && <div className="sap-inline-warning" role="status">{adminsWarning}</div>}

              {/* Tabs Bar & Export */}
              <div className="sap-admin-tabs-bar">
                <div className="sap-admin-tab-group">
                  <button
                    className={`sap-admin-tab-btn ${adminTab === 'all' ? 'active' : ''}`}
                    onClick={() => setAdminTab('all')}
                  >
                    All Admins ({adminCountValue(adminsList.length)})
                  </button>
                  <button
                    className={`sap-admin-tab-btn ${adminTab === 'active' ? 'active' : ''}`}
                    onClick={() => setAdminTab('active')}
                  >
                    Active ({adminCountValue(activeAdminsCount)})
                  </button>
                  <button
                    className={`sap-admin-tab-btn ${adminTab === 'locked' ? 'active' : ''}`}
                    onClick={() => setAdminTab('locked')}
                  >
                    Locked ({adminCountValue(lockedAdminsCount)})
                  </button>
                  <button
                    className={`sap-admin-tab-btn ${adminTab === 'pending' ? 'active' : ''}`}
                    onClick={() => setAdminTab('pending')}
                  >
                    Pending ({adminCountValue(pendingAdminsCount)})
                  </button>
                </div>

              </div>

              {/* Filter and Search Row */}
              <div className="sap-admin-filter-row">
                <div className="sap-filter-search-box">
                  <Search size={15} className="icon" />
                  <input
                    type="text"
                    placeholder="Search by name, email or ID..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>

                <select className="sap-filter-select" value={adminRoleFilter} onChange={e => setAdminRoleFilter(e.target.value)}>
                  <option>All Roles</option>
                  {[...new Set(adminsList.map(admin => admin.role))].map(role => <option key={role}>{role}</option>)}
                </select>

                <select className="sap-filter-select" value={adminStatusFilter} onChange={e => setAdminStatusFilter(e.target.value)}>
                  <option>All Status</option>
                  <option>Active</option>
                  <option>Locked</option>
                  <option>Pending</option>
                  <option>Rejected</option>
                  <option>Unknown</option>
                </select>

                <select className="sap-filter-select" value={adminClusterFilter} onChange={e => setAdminClusterFilter(e.target.value)}>
                  <option>All Clusters</option>
                  {adminClusters.map(cluster => <option key={cluster}>{cluster}</option>)}
                </select>
              </div>

              {/* Split Layout: Admin Table + Admin Details Drawer */}
              <div className="sap-split-layout">
                {/* Table Card */}
                <div className="sap-admin-table-card">
                  <table className="sap-data-table">
                    <thead>
                      <tr>
                        <th style={{ width: '40px' }}><input type="checkbox" /></th>
                        <th style={{ width: '40px' }}>#</th>
                        <th>Admin</th>
                        <th>Role</th>
                        <th>Cluster</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th style={{ textAlign: 'center' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminsLoading ? (
                        <tr><td colSpan={8}>Loading administrator records…</td></tr>
                      ) : adminsError ? (
                        <tr><td colSpan={8}>Administrator records are unavailable until the database request succeeds.</td></tr>
                      ) : filteredAdmins.length === 0 ? (
                        <tr><td colSpan={8}>No matching administrator records found.</td></tr>
                      ) : filteredAdmins.map((adm, index) => {
                        const isSelected = adm.id === selectedAdminId
                        return (
                          <tr
                            key={adm.id}
                            className={`clickable ${isSelected ? 'selected' : ''}`}
                            onClick={() => setSelectedAdminId(adm.id)}
                          >
                            <td onClick={e => e.stopPropagation()}><input type="checkbox" /></td>
                            <td style={{ color: '#94a3b8' }}>{index + 1}</td>
                            <td>
                              <div className="sap-user-cell">
                                <div className="sap-user-avatar-sm">
                                  {adm.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                                </div>
                                <div className="sap-user-names">
                                  <span className="sap-user-name">{adm.name}</span>
                                  <span className="sap-user-email">{adm.email}</span>
                                </div>
                              </div>
                            </td>
                            <td>
                              <span className={`sap-role-badge ${adm.roleColor}`}>{adm.role}</span>
                            </td>
                            <td>
                              <span className="sap-cluster-pill">{adm.cluster}</span>
                            </td>
                            <td>
                              <span className={`sap-status-pill ${adm.status.toLowerCase()}`}>
                                {adm.status}
                              </span>
                            </td>
                            <td style={{ color: '#64748b' }}>
                              {adm.joined ? new Date(adm.joined).toLocaleDateString() : '—'}
                            </td>
                            <td onClick={e => e.stopPropagation()}>
                              <div className="sap-table-actions">
                                <button
                                  className="sap-icon-action-btn"
                                  title="View Details"
                                  onClick={() => setSelectedAdminId(adm.id)}
                                >
                                  <Eye size={14} />
                                </button>
                                <button
                                  className="sap-icon-action-btn"
                                  title="More actions"
                                  onClick={() => setLockModalAdmin({ id: adm.id, name: adm.name })}
                                >
                                  <MoreHorizontal size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>

                  {/* Pagination Footer */}
                  <div className="sap-pagination-bar">
                    <span>Showing {adminCountValue(filteredAdmins.length)} of {adminCountValue(adminsList.length)} administrator records</span>
                  </div>
                </div>

                {/* Right Drawer: Admin Details */}
                {selectedAdmin && (
                  <div className="sap-drawer-card">
                    <div className="sap-drawer-header">
                      <h3>Admin Details</h3>
                      <button className="sap-drawer-close-btn" onClick={() => setSelectedAdminId('')}>
                        <X size={16} />
                      </button>
                    </div>

                    <div className="sap-drawer-profile">
                      <div className="sap-drawer-avatar">
                        {selectedAdmin.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                      </div>
                      <div className="sap-drawer-p-info">
                        <div className="sap-drawer-p-name-row">
                          <span className="sap-drawer-p-name">{selectedAdmin.name}</span>
                          <span className={`sap-status-pill ${selectedAdmin.status.toLowerCase()}`}>
                            {selectedAdmin.status === 'Active' ? '• Active' : selectedAdmin.status}
                          </span>
                        </div>
                        <span className="sap-drawer-p-role">{selectedAdmin.role}</span>
                      </div>
                    </div>

                    <div className="sap-drawer-meta-list">
                      <div className="sap-drawer-meta-item">
                        <span className="material-symbols-outlined icon" style={{ fontSize: '15px' }}>mail</span>
                        <span>{selectedAdmin.email}</span>
                      </div>
                      {selectedAdmin.phone && <div className="sap-drawer-meta-item">
                        <span className="material-symbols-outlined icon" style={{ fontSize: '15px' }}>call</span>
                        <span>{selectedAdmin.phone}</span>
                      </div>}
                      {selectedAdmin.cluster !== 'Not assigned' && <div className="sap-drawer-meta-item">
                        <span className="material-symbols-outlined icon" style={{ fontSize: '15px' }}>groups</span>
                        <span>Cluster: {selectedAdmin.cluster}</span>
                      </div>}
                      {selectedAdmin.joined && <div className="sap-drawer-meta-item">
                        <span className="material-symbols-outlined icon" style={{ fontSize: '15px' }}>calendar_today</span>
                        <span>Created: {new Date(selectedAdmin.joined).toLocaleString()}</span>
                      </div>}
                      {selectedAdmin.lockedReason && <div className="sap-drawer-meta-item">
                        <span className="material-symbols-outlined icon" style={{ fontSize: '15px' }}>lock</span>
                        <span>Lock reason: {selectedAdmin.lockedReason}</span>
                      </div>}
                    </div>

                    <div className="sap-drawer-actions">
                      <button
                        className="sap-btn-drawer-solid-blue"
                        onClick={() => void handleForceLogoutAdmin(selectedAdmin)}
                      >
                        <LogOut size={14} />
                        <span>Force Logout</span>
                      </button>

                      {selectedAdmin.status === 'Locked' ? (
                        <button
                          className="sap-btn-drawer-solid-blue"
                          onClick={() => void handleUnlockAdmin(selectedAdmin)}
                        >
                          <Unlock size={14} />
                          <span>Unlock Admin</span>
                        </button>
                      ) : (
                        <button
                          className="sap-btn-drawer-solid-red"
                          onClick={() => setLockModalAdmin({ id: selectedAdmin.id, name: selectedAdmin.name })}
                        >
                          <Lock size={14} />
                          <span>Lock Admin</span>
                        </button>
                      )}

                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* SCREEN 3: API & USAGE (Screenshot 3)                                      */}
          {/* ========================================================================= */}
          {activeNav === 'api' && (
            <div>
              {/* Header Banner */}
              <div className="sap-page-banner">
                <div className="sap-page-banner-left">
                  <div className="sap-banner-icon-box">
                    <Share2 size={24} />
                  </div>
                  <div className="sap-banner-text">
                    <h1>API &amp; Usage</h1>
                    <p>Monitor API requests, usage statistics, errors and performance.</p>
                  </div>
                </div>

                <div className="sap-page-banner-right">
                  <div className="sap-date-pill">
                    <Calendar size={15} color="#2563eb" />
                    <span>Wed, 02 Oct 2026</span>
                    <strong style={{ color: '#0f172a' }}>03:45 PM</strong>
                  </div>
                  <button className="sap-btn-primary-action" onClick={() => showToast('Exporting full API telemetry report...')}>
                    <Download size={15} />
                    <span>Export Report</span>
                  </button>
                </div>
              </div>

              {/* 5 KPI Stat Cards */}
              <div className="sap-stats-row-5">
                <div className="sap-stat-card">
                  <div className="sap-stat-icon blue"><Layers size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Total API Requests</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">125,482</span>
                      <span className="sap-stat-delta up-green">↑ 18%</span>
                    </div>
                    <span className="sap-stat-subtext">from last 7 days</span>
                  </div>
                </div>

                <div className="sap-stat-card">
                  <div className="sap-stat-icon green"><CheckCircle2 size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Successful Requests</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">118,230</span>
                    </div>
                    <span className="sap-stat-subtext" style={{ color: '#16a34a', fontWeight: 600 }}>94.2%</span>
                  </div>
                </div>

                <div className="sap-stat-card">
                  <div className="sap-stat-icon red"><AlertTriangle size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Client Errors (4xx)</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">5,612</span>
                    </div>
                    <span className="sap-stat-subtext" style={{ color: '#dc2626', fontWeight: 600 }}>4.5%</span>
                  </div>
                </div>

                <div className="sap-stat-card">
                  <div className="sap-stat-icon orange"><Server size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Server Errors (5xx)</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">1,640</span>
                    </div>
                    <span className="sap-stat-subtext" style={{ color: '#ea580c', fontWeight: 600 }}>1.3%</span>
                  </div>
                </div>

                <div className="sap-stat-card">
                  <div className="sap-stat-icon purple"><Zap size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Avg. Response Time</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">245 ms</span>
                      <span className="sap-stat-delta down-green">↓ 22%</span>
                    </div>
                    <span className="sap-stat-subtext">from last 7 days</span>
                  </div>
                </div>
              </div>

              {/* Two Charts Row: API Request Trends + Response Time */}
              <div className="sap-api-two-charts">
                {/* 1. API Request Trends */}
                <div className="sap-card">
                  <div className="sap-card-header">
                    <div className="sap-card-title-group">
                      <span className="material-symbols-outlined card-icon">query_stats</span>
                      <div>
                        <h3>API Request Trends</h3>
                        <p>Total API requests, success and error rate over time.</p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <div className="sap-filter-pills">
                        {(['24h', '7d', '30d', '3m'] as const).map(p => (
                          <button
                            key={p}
                            className={`sap-filter-pill-btn ${apiTimeFilter === p ? 'active' : ''}`}
                            onClick={() => setApiTimeFilter(p)}
                          >
                            {p === '24h' ? '24 Hours' : p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : '3 Months'}
                          </button>
                        ))}
                      </div>
                      <select className="sap-select-sm"><option>All Endpoints</option></select>
                    </div>
                  </div>

                  <svg viewBox="0 0 540 180" style={{ width: '100%', height: 'auto' }}>
                    {/* Y Grid lines */}
                    {[500, 1000, 1500, 2000].map((v, i) => {
                      const y = 145 - i * 36
                      return (
                        <g key={v}>
                          <line x1="45" y1={y} x2="525" y2={y} stroke="#f1f5f9" strokeWidth="1" />
                          <text x="35" y={y + 4} fill="#94a3b8" fontSize="9.5" textAnchor="end">{v >= 1000 ? `${v / 1000}K` : v}</text>
                        </g>
                      )
                    })}
                    {['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00'].map((time, idx) => (
                      <text key={time} x={65 + idx * 62} y="165" fill="#94a3b8" fontSize="9.5" textAnchor="middle">{time}</text>
                    ))}

                    {/* Total Requests (Blue) */}
                    <path
                      d="M 65 95 C 105 70, 140 120, 180 85 C 220 100, 260 65, 300 95 C 340 70, 380 40, 420 85 C 460 60, 500 75, 520 90"
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth="2.5"
                    />
                    {/* Successful (Green) */}
                    <path
                      d="M 65 110 C 105 90, 140 130, 180 100 C 220 115, 260 80, 300 110 C 340 90, 380 55, 420 100 C 460 75, 500 90, 520 105"
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="2.5"
                    />
                    {/* 4xx Errors (Orange) */}
                    <path
                      d="M 65 140 C 105 138, 140 142, 180 139 C 220 141, 260 137, 300 140 C 340 138, 380 135, 420 139 C 460 137, 500 138, 520 140"
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth="2"
                    />
                    {/* 5xx Errors (Red) */}
                    <path
                      d="M 65 145 C 105 144, 140 146, 180 144 C 220 145, 260 143, 300 145 C 340 144, 380 142, 420 144 C 460 143, 500 144, 520 145"
                      fill="none"
                      stroke="#ef4444"
                      strokeWidth="2"
                    />
                  </svg>

                  <div className="sap-chart-legend-row">
                    <div className="sap-chart-legend-item"><span className="sap-chart-legend-dot" style={{ background: '#2563eb' }} /><span>Total Requests</span></div>
                    <div className="sap-chart-legend-item"><span className="sap-chart-legend-dot" style={{ background: '#10b981' }} /><span>Successful</span></div>
                    <div className="sap-chart-legend-item"><span className="sap-chart-legend-dot" style={{ background: '#f59e0b' }} /><span>4xx Errors</span></div>
                    <div className="sap-chart-legend-item"><span className="sap-chart-legend-dot" style={{ background: '#ef4444' }} /><span>5xx Errors</span></div>
                  </div>
                </div>

                {/* 2. Response Time */}
                <div className="sap-card">
                  <div className="sap-card-header">
                    <div className="sap-card-title-group">
                      <span className="material-symbols-outlined card-icon" style={{ color: '#8b5cf6' }}>timer</span>
                      <div>
                        <h3>Response Time</h3>
                        <p>Average response time (ms) over time.</p>
                      </div>
                    </div>
                    <div className="sap-filter-pills">
                      {(['24h', '7d', '30d', '3m'] as const).map(p => (
                        <button
                          key={p}
                          className={`sap-filter-pill-btn ${responseTimeFilter === p ? 'active' : ''}`}
                          onClick={() => setResponseTimeFilter(p)}
                        >
                          {p === '24h' ? '24 Hours' : p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : '3 Months'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <svg viewBox="0 0 380 180" style={{ width: '100%', height: 'auto' }}>
                    {[0, 200, 400, 600, 800].map((ms, idx) => {
                      const y = 145 - idx * 28
                      return (
                        <g key={ms}>
                          <line x1="35" y1={y} x2="365" y2={y} stroke="#f1f5f9" strokeWidth="1" />
                          <text x="28" y={y + 3} fill="#94a3b8" fontSize="9" textAnchor="end">{ms}</text>
                        </g>
                      )
                    })}
                    {['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00'].map((time, idx) => (
                      <text key={time} x={45 + idx * 45} y="165" fill="#94a3b8" fontSize="8.5" textAnchor="middle">{time}</text>
                    ))}

                    {/* Purple Response Time curve with points */}
                    <path
                      d="M 45 130 L 80 115 L 115 125 L 150 100 L 185 120 L 220 95 L 255 60 L 290 90 L 325 75 L 360 85"
                      fill="none"
                      stroke="#8b5cf6"
                      strokeWidth="2.5"
                    />
                    {[
                      [45, 130], [80, 115], [115, 125], [150, 100], [185, 120],
                      [220, 95], [255, 60], [290, 90], [325, 75], [360, 85]
                    ].map(([cx, cy], i) => (
                      <circle key={i} cx={cx} cy={cy} r="3" fill="#ffffff" stroke="#8b5cf6" strokeWidth="2" />
                    ))}
                  </svg>

                  <div className="sap-chart-legend-row">
                    <div className="sap-chart-legend-item"><span className="sap-chart-legend-dot" style={{ background: '#8b5cf6' }} /><span>Response Time (ms)</span></div>
                  </div>
                </div>
              </div>

              {/* Row 3: Top Endpoints, API Usage by User, API Usage by Role */}
              <div className="sap-api-row-3">
                {/* 1. Top Endpoints */}
                <div className="sap-card">
                  <div className="sap-card-header">
                    <div className="sap-card-title-group">
                      <span className="material-symbols-outlined card-icon">link</span>
                      <div>
                        <h3>Top Endpoints</h3>
                        <p>Most frequently used API endpoints.</p>
                      </div>
                    </div>
                    <button className="sap-card-link-btn">View All</button>
                  </div>
                  <table className="sap-mini-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Endpoint</th>
                        <th>Method</th>
                        <th>Requests</th>
                        <th>Success Rate</th>
                        <th>Avg. Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { id: 1, ep: '/api/auth/login', m: 'POST', req: '24,582', pct: '98.5%', time: '180 ms', val: 98.5 },
                        { id: 2, ep: '/api/tests/list', m: 'GET', req: '18,441', pct: '99.2%', time: '120 ms', val: 99.2 },
                        { id: 3, ep: '/api/questions', m: 'GET', req: '15,230', pct: '97.8%', time: '210 ms', val: 97.8 },
                        { id: 4, ep: '/api/results', m: 'POST', req: '12,014', pct: '96.1%', time: '340 ms', val: 96.1 },
                        { id: 5, ep: '/api/users', m: 'GET', req: '8,912', pct: '98.9%', time: '160 ms', val: 98.9 },
                      ].map(row => (
                        <tr key={row.id}>
                          <td style={{ color: '#94a3b8' }}>{row.id}</td>
                          <td style={{ fontWeight: 600, color: '#1e293b' }}>{row.ep}</td>
                          <td><span className={`sap-method-badge ${row.m.toLowerCase()}`}>{row.m}</span></td>
                          <td>{row.req}</td>
                          <td>
                            <div className="sap-progress-inline">
                              <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>{row.pct}</span>
                              <div className="sap-progress-track">
                                <div className="sap-progress-fill" style={{ width: `${row.val}%` }} />
                              </div>
                            </div>
                          </td>
                          <td style={{ color: '#64748b' }}>{row.time}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 2. API Usage by User (Top 5) */}
                <div className="sap-card">
                  <div className="sap-card-header">
                    <div className="sap-card-title-group">
                      <span className="material-symbols-outlined card-icon">person</span>
                      <h3>API Usage by User (Top 5)</h3>
                    </div>
                    <button className="sap-card-link-btn">View All</button>
                  </div>
                  <table className="sap-mini-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>User</th>
                        <th>Role</th>
                        <th>API Calls</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { id: 1, initials: 'AS', name: 'Amit Sharma', role: 'Admin', calls: '12,482', color: '#fee2e2', tc: '#dc2626' },
                        { id: 2, initials: 'PK', name: 'Priya Kulkarni', role: 'Content Admin', calls: '9,321', color: '#e0f2fe', tc: '#0284c7' },
                        { id: 3, initials: 'RV', name: 'Rahul Verma', role: 'Question Admin', calls: '8,741', color: '#f3e8ff', tc: '#9333ea' },
                        { id: 4, initials: 'ST', name: 'Sneha Tiwari', role: 'Test Admin', calls: '7,654', color: '#dcfce7', tc: '#15803d' },
                        { id: 5, initials: 'MJ', name: 'Mayur Joshi', role: 'Analytics Admin', calls: '6,890', color: '#fef9c3', tc: '#a16207' },
                      ].map(u => (
                        <tr key={u.id}>
                          <td style={{ color: '#94a3b8' }}>{u.id}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{
                                width: '22px', height: '22px', borderRadius: '50%', background: '#e0e7ff',
                                color: '#4338ca', fontSize: '0.68rem', fontWeight: 700, display: 'inline-flex',
                                alignItems: 'center', justifyContent: 'center'
                              }}>
                                {u.initials}
                              </span>
                              <span style={{ fontWeight: 600, color: '#1e293b' }}>{u.name}</span>
                            </div>
                          </td>
                          <td>
                            <span style={{ padding: '0.15rem 0.45rem', borderRadius: '4px', fontSize: '0.68rem', fontWeight: 700, background: u.color, color: u.tc }}>
                              {u.role}
                            </span>
                          </td>
                          <td style={{ fontWeight: 600 }}>{u.calls}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 3. API Usage by Role Donut Chart */}
                <div className="sap-card">
                  <div className="sap-card-header">
                    <div className="sap-card-title-group">
                      <span className="material-symbols-outlined card-icon">pie_chart</span>
                      <h3>API Usage by Role</h3>
                    </div>
                  </div>

                  <div className="sap-donut-container">
                    <svg viewBox="0 0 160 160" style={{ width: '130px', height: '130px' }}>
                      <circle cx="80" cy="80" r="54" fill="none" stroke="#2563eb" strokeWidth="20" strokeDasharray="163 339" strokeDashoffset="0" />
                      <circle cx="80" cy="80" r="54" fill="none" stroke="#10b981" strokeWidth="20" strokeDasharray="83 339" strokeDashoffset="-163" />
                      <circle cx="80" cy="80" r="54" fill="none" stroke="#f59e0b" strokeWidth="20" strokeDasharray="42 339" strokeDashoffset="-246" />
                      <circle cx="80" cy="80" r="54" fill="none" stroke="#f97316" strokeWidth="20" strokeDasharray="27 339" strokeDashoffset="-288" />
                      <circle cx="80" cy="80" r="54" fill="none" stroke="#ef4444" strokeWidth="20" strokeDasharray="16 339" strokeDashoffset="-315" />
                      <circle cx="80" cy="80" r="54" fill="none" stroke="#8b5cf6" strokeWidth="20" strokeDasharray="8 339" strokeDashoffset="-331" />
                    </svg>

                    <div className="sap-donut-center-text">
                      <span className="num">125,482</span>
                      <span className="lbl">Total Calls</span>
                    </div>

                    <div className="sap-donut-legend-grid">
                      <div className="sap-donut-legend-item">
                        <div className="sap-donut-legend-left"><span className="sap-donut-legend-dot" style={{ background: '#2563eb' }} /><span>Students</span></div>
                        <span className="sap-donut-legend-pct">48.2%</span>
                      </div>
                      <div className="sap-donut-legend-item">
                        <div className="sap-donut-legend-left"><span className="sap-donut-legend-dot" style={{ background: '#10b981' }} /><span>Admin</span></div>
                        <span className="sap-donut-legend-pct">24.6%</span>
                      </div>
                      <div className="sap-donut-legend-item">
                        <div className="sap-donut-legend-left"><span className="sap-donut-legend-dot" style={{ background: '#f59e0b' }} /><span>Content Admin</span></div>
                        <span className="sap-donut-legend-pct">12.4%</span>
                      </div>
                      <div className="sap-donut-legend-item">
                        <div className="sap-donut-legend-left"><span className="sap-donut-legend-dot" style={{ background: '#f97316' }} /><span>Test Admin</span></div>
                        <span className="sap-donut-legend-pct">8.1%</span>
                      </div>
                      <div className="sap-donut-legend-item">
                        <div className="sap-donut-legend-left"><span className="sap-donut-legend-dot" style={{ background: '#ef4444' }} /><span>Question Admin</span></div>
                        <span className="sap-donut-legend-pct">4.7%</span>
                      </div>
                      <div className="sap-donut-legend-item">
                        <div className="sap-donut-legend-left"><span className="sap-donut-legend-dot" style={{ background: '#8b5cf6' }} /><span>Others</span></div>
                        <span className="sap-donut-legend-pct">2.0%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Row: Recent API Requests + Error Logs (API) */}
              <div className="sap-api-bottom-grid">
                {/* Recent API Requests */}
                <div className="sap-card">
                  <div className="sap-card-header">
                    <div className="sap-card-title-group">
                      <span className="material-symbols-outlined card-icon">history</span>
                      <h3>Recent API Requests</h3>
                    </div>
                    <button className="sap-card-link-btn">View All</button>
                  </div>
                  <table className="sap-mini-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Time</th>
                        <th>User</th>
                        <th>Method</th>
                        <th>Endpoint</th>
                        <th>Status</th>
                        <th>Response Time</th>
                        <th>IP Address</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { id: 1, time: '10:45:32', user: 'Amit Sharma', m: 'POST', ep: '/api/auth/login', status: 200, rt: '142 ms', ip: '103.21.244.12' },
                        { id: 2, time: '10:45:28', user: 'Priya Kulkarni', m: 'GET', ep: '/api/tests/list', status: 200, rt: '98 ms', ip: '185.199.110.23' },
                        { id: 3, time: '10:45:21', user: 'Student', m: 'GET', ep: '/api/questions', status: 200, rt: '210 ms', ip: '45.134.22.87' },
                        { id: 4, time: '10:45:15', user: 'Rahul Verma', m: 'POST', ep: '/api/results', status: 201, rt: '320 ms', ip: '212.142.91.5' },
                        { id: 5, time: '10:45:10', user: 'Mayur Joshi', m: 'GET', ep: '/api/analytics', status: 200, rt: '180 ms', ip: '170.64.12.45' },
                      ].map(r => (
                        <tr key={r.id}>
                          <td style={{ color: '#94a3b8' }}>{r.id}</td>
                          <td style={{ color: '#64748b' }}>{r.time}</td>
                          <td style={{ fontWeight: 600 }}>{r.user}</td>
                          <td><span className={`sap-method-badge ${r.m.toLowerCase()}`}>{r.m}</span></td>
                          <td style={{ color: '#1e293b' }}>{r.ep}</td>
                          <td><span className="sap-status-pill success">{r.status}</span></td>
                          <td style={{ color: '#64748b' }}>{r.rt}</td>
                          <td style={{ color: '#475569' }}>{r.ip}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Error Logs (API) */}
                <div className="sap-card">
                  <div className="sap-card-header">
                    <div className="sap-card-title-group">
                      <span className="material-symbols-outlined card-icon" style={{ color: '#ef4444' }}>error</span>
                      <h3>Error Logs (API)</h3>
                    </div>
                    <button className="sap-card-link-btn">View All</button>
                  </div>
                  <table className="sap-mini-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Time</th>
                        <th>Endpoint</th>
                        <th>Status</th>
                        <th>Error Message</th>
                        <th>IP Address</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { id: 1, time: '10:44:52', ep: '/api/auth/login', status: 401, msg: 'Invalid credentials', ip: '103.21.244.12' },
                        { id: 2, time: '10:42:11', ep: '/api/questions', status: 429, msg: 'Rate limit exceeded', ip: '185.199.110.23' },
                        { id: 3, time: '10:40:33', ep: '/api/tests/create', status: 500, msg: 'Internal server error', ip: '45.134.22.87' },
                        { id: 4, time: '10:38:14', ep: '/api/results', status: 403, msg: 'Unauthorized access', ip: '212.142.91.5' },
                        { id: 5, time: '10:35:29', ep: '/api/analytics', status: 500, msg: 'Database connection failed', ip: '170.64.12.45' },
                      ].map(err => (
                        <tr key={err.id}>
                          <td style={{ color: '#94a3b8' }}>{err.id}</td>
                          <td style={{ color: '#64748b' }}>{err.time}</td>
                          <td style={{ color: '#1e293b', fontWeight: 600 }}>{err.ep}</td>
                          <td><span className="sap-status-pill failed">{err.status}</span></td>
                          <td style={{ color: '#dc2626' }}>{err.msg}</td>
                          <td style={{ color: '#475569' }}>{err.ip}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* SCREEN 4: BACKUP & RESTORE (Screenshot 4)                                 */}
          {/* ========================================================================= */}
          {activeNav === 'backup' && (
            <div>
              {/* Header Banner */}
              <div className="sap-page-banner">
                <div className="sap-page-banner-left">
                  <div className="sap-banner-icon-box">
                    <Archive size={24} />
                  </div>
                  <div className="sap-banner-text">
                    <h1>Backup &amp; Restore</h1>
                    <p>Manage system backups, database backups and restore data when needed.</p>
                  </div>
                </div>

                <div className="sap-page-banner-right">
                  <div className="sap-date-pill">
                    <Calendar size={15} color="#2563eb" />
                    <span>Wed, 02 Oct 2026</span>
                    <strong style={{ color: '#0f172a' }}>03:45 PM</strong>
                  </div>
                  <button className="sap-btn-primary-action" onClick={() => showToast('Backup configuration panel opened')}>
                    <Settings size={15} />
                    <span>Backup Settings</span>
                  </button>
                </div>
              </div>

              {/* 5 KPI Stat Cards */}
              <div className="sap-stats-row-5">
                <div className="sap-stat-card">
                  <div className="sap-stat-icon blue"><Database size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Total Backups</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">24</span>
                      <span className="sap-stat-delta up-green">↑ 3</span>
                    </div>
                    <span className="sap-stat-subtext">from last month</span>
                  </div>
                </div>

                <div className="sap-stat-card">
                  <div className="sap-stat-icon green"><CheckCircle2 size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Successful Backups</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">22</span>
                    </div>
                    <span className="sap-stat-subtext" style={{ color: '#16a34a', fontWeight: 600 }}>91.7%</span>
                  </div>
                </div>

                <div className="sap-stat-card">
                  <div className="sap-stat-icon red"><AlertTriangle size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Failed Backups</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">2</span>
                    </div>
                    <span className="sap-stat-subtext" style={{ color: '#dc2626', fontWeight: 600 }}>8.3%</span>
                  </div>
                </div>

                <div className="sap-stat-card">
                  <div className="sap-stat-icon purple"><Layers size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Total Storage Used</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">5.8 GB</span>
                      <span className="sap-stat-delta up-red">↑ 12%</span>
                    </div>
                    <span className="sap-stat-subtext">of 50 GB</span>
                  </div>
                </div>

                <div className="sap-stat-card">
                  <div className="sap-stat-icon orange"><Calendar size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Last Backup</span>
                    <div className="sap-stat-row-val" style={{ fontSize: '0.86rem', fontWeight: 700, color: '#0f172a' }}>
                      2 Oct 2026, 01:30 AM
                    </div>
                    <span className="sap-status-pill success" style={{ alignSelf: 'flex-start', marginTop: '3px' }}>Successful</span>
                  </div>
                </div>
              </div>

              {/* Middle Section: Backup Overview + Create New Backup */}
              <div className="sap-backup-mid-grid">
                {/* 1. Backup Overview (Stacked Bar Chart) */}
                <div className="sap-card">
                  <div className="sap-card-header">
                    <div className="sap-card-title-group">
                      <span className="material-symbols-outlined card-icon">storage</span>
                      <div>
                        <h3>Backup Overview</h3>
                        <p>Backup storage usage over time.</p>
                      </div>
                    </div>
                    <select className="sap-select-sm" value={backupOverviewRange} onChange={e => setBackupOverviewRange(e.target.value)}>
                      <option value="7d">Last 7 Days</option>
                      <option value="30d">Last 30 Days</option>
                    </select>
                  </div>

                  <svg viewBox="0 0 540 180" style={{ width: '100%', height: 'auto' }}>
                    {[0, 2, 4, 6, 8, 10].map((gb, i) => {
                      const y = 145 - i * 24
                      return (
                        <g key={gb}>
                          <line x1="45" y1={y} x2="520" y2={y} stroke="#f1f5f9" strokeWidth="1" />
                          <text x="35" y={y + 3} fill="#94a3b8" fontSize="9.5" textAnchor="end">{gb} GB</text>
                        </g>
                      )
                    })}

                    {/* Stacked Bars for 7 days */}
                    {[
                      { date: '26 Sep', h1: 30, h2: 25, h3: 15 },
                      { date: '27 Sep', h1: 32, h2: 27, h3: 16 },
                      { date: '28 Sep', h1: 31, h2: 26, h3: 17 },
                      { date: '29 Sep', h1: 35, h2: 28, h3: 18 },
                      { date: '30 Sep', h1: 36, h2: 29, h3: 20 },
                      { date: '1 Oct', h1: 38, h2: 30, h3: 22 },
                      { date: '2 Oct', h1: 40, h2: 32, h3: 24 },
                    ].map((bar, idx) => {
                      const x = 70 + idx * 64
                      const yBase = 145
                      const y1 = yBase - bar.h1
                      const y2 = y1 - bar.h2
                      const y3 = y2 - bar.h3
                      return (
                        <g key={bar.date}>
                          {/* Segment 1: Database (Blue) */}
                          <rect x={x} y={y1} width="28" height={bar.h1} fill="#3b82f6" rx="2" />
                          {/* Segment 2: Application Files (Purple) */}
                          <rect x={x} y={y2} width="28" height={bar.h2} fill="#8b5cf6" />
                          {/* Segment 3: Uploads & Assets (Teal) */}
                          <rect x={x} y={y3} width="28" height={bar.h3} fill="#10b981" rx="2" />
                          {/* Date label */}
                          <text x={x + 14} y="162" fill="#94a3b8" fontSize="9.5" textAnchor="middle">{bar.date}</text>
                        </g>
                      )
                    })}
                  </svg>

                  <div className="sap-chart-legend-row">
                    <div className="sap-chart-legend-item"><span className="sap-chart-legend-dot" style={{ background: '#3b82f6' }} /><span>Database</span></div>
                    <div className="sap-chart-legend-item"><span className="sap-chart-legend-dot" style={{ background: '#8b5cf6' }} /><span>Application Files</span></div>
                    <div className="sap-chart-legend-item"><span className="sap-chart-legend-dot" style={{ background: '#10b981' }} /><span>Uploads &amp; Assets</span></div>
                  </div>
                </div>

                {/* 2. Create New Backup */}
                <div className="sap-card">
                  <div className="sap-card-header">
                    <div className="sap-card-title-group">
                      <span className="material-symbols-outlined card-icon">play_circle</span>
                      <div>
                        <h3>Create New Backup</h3>
                        <p>Generate a new backup of your system data.</p>
                      </div>
                    </div>
                  </div>

                  <div className="sap-backup-action-cards">
                    {/* Full Backup */}
                    <div className="sap-backup-action-box">
                      <div className="sap-backup-box-icon blue">
                        <Database size={20} />
                      </div>
                      <div className="sap-backup-box-info">
                        <h4>Full Backup</h4>
                        <p>Database + Files + Uploads</p>
                      </div>
                      <button className="sap-btn-box-action blue" onClick={() => handleCreateBackup('Full Backup')}>
                        Create Full Backup
                      </button>
                    </div>

                    {/* Database Only */}
                    <div className="sap-backup-action-box">
                      <div className="sap-backup-box-icon purple">
                        <Layers size={20} />
                      </div>
                      <div className="sap-backup-box-info">
                        <h4>Database Only</h4>
                        <p>Only database data</p>
                      </div>
                      <button className="sap-btn-box-action purple" onClick={() => handleCreateBackup('Database Backup')}>
                        Create DB Backup
                      </button>
                    </div>

                    {/* Files Only */}
                    <div className="sap-backup-action-box">
                      <div className="sap-backup-box-icon teal">
                        <FileText size={20} />
                      </div>
                      <div className="sap-backup-box-info">
                        <h4>Files Only</h4>
                        <p>Application files &amp; uploads</p>
                      </div>
                      <button className="sap-btn-box-action teal" onClick={() => handleCreateBackup('Files Backup')}>
                        Create Files Backup
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Section: Recent Backups + Restore / Settings */}
              <div className="sap-backup-bottom-grid">
                {/* Left Side: Recent Backups Table + 2-nested cards */}
                <div>
                  <div className="sap-card">
                    <div className="sap-card-header">
                      <div className="sap-card-title-group">
                        <span className="material-symbols-outlined card-icon">folder_zip</span>
                        <div>
                          <h3>Recent Backups</h3>
                          <p>View and manage all system backups.</p>
                        </div>
                      </div>
                      <button className="sap-card-link-btn">View All</button>
                    </div>

                    <table className="sap-mini-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Backup Name</th>
                          <th>Type</th>
                          <th>Size</th>
                          <th>Status</th>
                          <th>Created At</th>
                          <th style={{ textAlign: 'center' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { id: 1, name: 'full-backup-2026-10-02.zip', type: 'Full', size: '1.2 GB', status: 'Success', date: '02 Oct 2026, 01:30 AM', color: '#e0f2fe', tc: '#0284c7' },
                          { id: 2, name: 'db-backup-2026-10-01.sql', type: 'Database', size: '320 MB', status: 'Success', date: '01 Oct 2026, 01:30 AM', color: '#f3e8ff', tc: '#9333ea' },
                          { id: 3, name: 'files-backup-2026-09-30.zip', type: 'Files', size: '890 MB', status: 'Success', date: '30 Sep 2026, 01:30 AM', color: '#dcfce7', tc: '#15803d' },
                          { id: 4, name: 'full-backup-2026-09-29.zip', type: 'Full', size: '1.1 GB', status: 'Failed', date: '29 Sep 2026, 01:30 AM', color: '#e0f2fe', tc: '#0284c7' },
                          { id: 5, name: 'db-backup-2026-09-28.sql', type: 'Database', size: '310 MB', status: 'Success', date: '28 Sep 2026, 01:30 AM', color: '#f3e8ff', tc: '#9333ea' },
                        ].map(bk => (
                          <tr key={bk.id}>
                            <td style={{ color: '#94a3b8' }}>{bk.id}</td>
                            <td style={{ fontWeight: 600, color: '#1e293b' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <FileText size={14} color="#64748b" />
                                <span>{bk.name}</span>
                              </div>
                            </td>
                            <td>
                              <span style={{ padding: '0.15rem 0.45rem', borderRadius: '4px', fontSize: '0.68rem', fontWeight: 700, background: bk.color, color: bk.tc }}>
                                {bk.type}
                              </span>
                            </td>
                            <td style={{ fontWeight: 600 }}>{bk.size}</td>
                            <td>
                              <span className={`sap-status-pill ${bk.status.toLowerCase()}`}>{bk.status}</span>
                            </td>
                            <td style={{ color: '#64748b' }}>{bk.date}</td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                                <button className="sap-icon-action-btn" title="Download backup" onClick={() => showToast(`Downloading ${bk.name}`)}>
                                  <Download size={13} />
                                </button>
                                <button className="sap-icon-action-btn" title="Restore this backup" onClick={() => showToast(`Ready to restore ${bk.name}`)}>
                                  <RotateCcw size={13} />
                                </button>
                                <button className="sap-icon-action-btn" title="More options">
                                  <MoreHorizontal size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* 2 Nested Cards: Storage Usage + Scheduled Backups */}
                  <div className="sap-backup-2col-nested">
                    {/* Storage Usage Donut */}
                    <div className="sap-card">
                      <div className="sap-card-header">
                        <div className="sap-card-title-group">
                          <span className="material-symbols-outlined card-icon">pie_chart</span>
                          <div>
                            <h3>Storage Usage</h3>
                            <p>Current storage usage for backups.</p>
                          </div>
                        </div>
                      </div>

                      <div className="sap-donut-container">
                        <svg viewBox="0 0 160 160" style={{ width: '120px', height: '120px' }}>
                          <circle cx="80" cy="80" r="54" fill="none" stroke="#2563eb" strokeWidth="18" strokeDasharray="139 339" strokeDashoffset="0" />
                          <circle cx="80" cy="80" r="54" fill="none" stroke="#8b5cf6" strokeWidth="18" strokeDasharray="122 339" strokeDashoffset="-139" />
                          <circle cx="80" cy="80" r="54" fill="none" stroke="#10b981" strokeWidth="18" strokeDasharray="78 339" strokeDashoffset="-261" />
                        </svg>

                        <div className="sap-donut-center-text">
                          <span className="num">5.8 GB</span>
                          <span className="lbl">of 50 GB</span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '0.75rem', width: '100%' }}>
                          <div className="sap-donut-legend-item">
                            <div className="sap-donut-legend-left"><span className="sap-donut-legend-dot" style={{ background: '#2563eb' }} /><span>Database Backups</span></div>
                            <span className="sap-donut-legend-pct">2.4 GB (41%)</span>
                          </div>
                          <div className="sap-donut-legend-item">
                            <div className="sap-donut-legend-left"><span className="sap-donut-legend-dot" style={{ background: '#8b5cf6' }} /><span>Application Files</span></div>
                            <span className="sap-donut-legend-pct">2.1 GB (36%)</span>
                          </div>
                          <div className="sap-donut-legend-item">
                            <div className="sap-donut-legend-left"><span className="sap-donut-legend-dot" style={{ background: '#10b981' }} /><span>Uploads &amp; Assets</span></div>
                            <span className="sap-donut-legend-pct">1.3 GB (23%)</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Scheduled Backups */}
                    <div className="sap-card">
                      <div className="sap-card-header">
                        <div className="sap-card-title-group">
                          <span className="material-symbols-outlined card-icon">update</span>
                          <div>
                            <h3>Scheduled Backups</h3>
                            <p>Configure automatic backup schedules.</p>
                          </div>
                        </div>
                      </div>

                      <div className="sap-scheduled-list">
                        <div className="sap-schedule-row">
                          <div className="sap-schedule-left">
                            <Calendar size={16} color="#2563eb" />
                            <div className="sap-schedule-titles">
                              <h5>Daily Backup</h5>
                              <p>Every day at 01:30 AM</p>
                            </div>
                          </div>
                          <div className="sap-schedule-right">
                            <label className="sap-toggle-switch">
                              <input
                                type="checkbox"
                                checked={dailyBackupEnabled}
                                onChange={e => setDailyBackupEnabled(e.target.checked)}
                              />
                              <span className="sap-toggle-slider" />
                            </label>
                            <button className="sap-btn-table-action">Edit</button>
                          </div>
                        </div>

                        <div className="sap-schedule-row">
                          <div className="sap-schedule-left">
                            <Calendar size={16} color="#8b5cf6" />
                            <div className="sap-schedule-titles">
                              <h5>Weekly Backup</h5>
                              <p>Every Sunday at 02:00 AM</p>
                            </div>
                          </div>
                          <div className="sap-schedule-right">
                            <label className="sap-toggle-switch">
                              <input
                                type="checkbox"
                                checked={weeklyBackupEnabled}
                                onChange={e => setWeeklyBackupEnabled(e.target.checked)}
                              />
                              <span className="sap-toggle-slider" />
                            </label>
                            <button className="sap-btn-table-action">Edit</button>
                          </div>
                        </div>

                        <div className="sap-schedule-row">
                          <div className="sap-schedule-left">
                            <Calendar size={16} color="#10b981" />
                            <div className="sap-schedule-titles">
                              <h5>Monthly Backup</h5>
                              <p>1st of every month at 03:00 AM</p>
                            </div>
                          </div>
                          <div className="sap-schedule-right">
                            <label className="sap-toggle-switch">
                              <input
                                type="checkbox"
                                checked={monthlyBackupEnabled}
                                onChange={e => setMonthlyBackupEnabled(e.target.checked)}
                              />
                              <span className="sap-toggle-slider" />
                            </label>
                            <button className="sap-btn-table-action">Edit</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Side: Restore System + Backup Settings */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {/* Restore System */}
                  <div className="sap-card">
                    <div className="sap-card-header">
                      <div className="sap-card-title-group">
                        <span className="material-symbols-outlined card-icon">settings_backup_restore</span>
                        <div>
                          <h3>Restore System</h3>
                          <p>Restore your system using a previous backup.</p>
                        </div>
                      </div>
                    </div>

                    <div className="sap-warning-banner">
                      <AlertTriangle size={18} className="icon" />
                      <p><strong>Restoring will overwrite current data.</strong><br />Make sure to create a backup before restoring.</p>
                    </div>

                    <div className="sap-form-group">
                      <label className="sap-form-label">Select Backup File</label>
                      <select
                        className="sap-form-select"
                        value={selectedRestoreBackup}
                        onChange={e => setSelectedRestoreBackup(e.target.value)}
                      >
                        <option value="">Select a backup to restore...</option>
                        <option value="full-backup-2026-10-02.zip">full-backup-2026-10-02.zip (1.2 GB - Today)</option>
                        <option value="db-backup-2026-10-01.sql">db-backup-2026-10-01.sql (320 MB - Yesterday)</option>
                        <option value="files-backup-2026-09-30.zip">files-backup-2026-09-30.zip (890 MB)</option>
                      </select>
                    </div>

                    <button
                      className="sap-btn-drawer-solid-red"
                      style={{ marginTop: '0.5rem', width: '100%' }}
                      onClick={() => {
                        if (!selectedRestoreBackup) {
                          showToast('Please select a backup file first.', 'error')
                          return
                        }
                        if (window.confirm(`Warning: Overwrite system data with ${selectedRestoreBackup}?`)) {
                          showToast('System restore initialized.', 'success')
                        }
                      }}
                    >
                      <RotateCcw size={15} />
                      <span>Restore Now</span>
                    </button>
                  </div>

                  {/* Backup Settings */}
                  <div className="sap-card">
                    <div className="sap-card-header">
                      <div className="sap-card-title-group">
                        <span className="material-symbols-outlined card-icon">tune</span>
                        <div>
                          <h3>Backup Settings</h3>
                          <p>Manage backup configuration and storage.</p>
                        </div>
                      </div>
                    </div>

                    <div className="sap-form-group">
                      <label className="sap-form-label">Backup Storage Location</label>
                      <select className="sap-form-select" value={backupLocation} onChange={e => setBackupLocation(e.target.value)}>
                        <option>Local Storage</option>
                        <option>AWS S3 Bucket</option>
                        <option>Google Cloud Storage</option>
                      </select>
                    </div>

                    <div className="sap-form-group">
                      <label className="sap-form-label">Retention Period</label>
                      <select className="sap-form-select" value={retentionPeriod} onChange={e => setRetentionPeriod(e.target.value)}>
                        <option>Keep last 30 backups</option>
                        <option>Keep last 60 backups</option>
                        <option>Keep last 90 backups</option>
                      </select>
                    </div>

                    <div className="sap-form-row-toggle">
                      <span>Include Uploads</span>
                      <label className="sap-toggle-switch">
                        <input type="checkbox" checked={includeUploads} onChange={e => setIncludeUploads(e.target.checked)} />
                        <span className="sap-toggle-slider" />
                      </label>
                    </div>

                    <div className="sap-form-row-toggle">
                      <span>Compress Backups</span>
                      <label className="sap-toggle-switch">
                        <input type="checkbox" checked={compressBackups} onChange={e => setCompressBackups(e.target.checked)} />
                        <span className="sap-toggle-slider" />
                      </label>
                    </div>

                    <div className="sap-form-row-toggle">
                      <span>Email on Backup Failure</span>
                      <label className="sap-toggle-switch">
                        <input type="checkbox" checked={emailOnFailure} onChange={e => setEmailOnFailure(e.target.checked)} />
                        <span className="sap-toggle-slider" />
                      </label>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.85rem' }}>
                      <button className="sap-btn-primary-action" onClick={() => showToast('Backup settings updated successfully.', 'success')}>
                        Save Settings
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* SCREEN 5: SYSTEM LOGS (Screenshot 5)                                      */}
          {/* ========================================================================= */}
          {activeNav === 'logs' && (
            <div>
              {/* Header Banner */}
              <div className="sap-page-banner">
                <div className="sap-page-banner-left">
                  <div className="sap-banner-icon-box">
                    <FileText size={24} />
                  </div>
                  <div className="sap-banner-text">
                    <h1>System Logs</h1>
                    <p>View, search and analyze all system logs for troubleshooting and monitoring.</p>
                  </div>
                </div>

                <div className="sap-page-banner-right">
                  <div className="sap-date-pill">
                    <Calendar size={15} color="#2563eb" />
                    <span>Wed, 02 Oct 2026</span>
                    <strong style={{ color: '#0f172a' }}>03:45 PM</strong>
                  </div>
                  <button className="sap-btn-primary-action" onClick={() => showToast('Downloading 248,521 logs as compressed archive...')}>
                    <Download size={15} />
                    <span>Download Logs</span>
                  </button>
                </div>
              </div>

              {/* 5 KPI Stat Cards */}
              <div className="sap-stats-row-5">
                <div className="sap-stat-card">
                  <div className="sap-stat-icon blue"><FileText size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Total Logs</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">248,521</span>
                      <span className="sap-stat-delta up-green">↑ 12%</span>
                    </div>
                    <span className="sap-stat-subtext">from last 7 days</span>
                  </div>
                </div>

                <div className="sap-stat-card">
                  <div className="sap-stat-icon green"><CheckCircle2 size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Info Logs</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">182,430</span>
                      <span className="sap-stat-delta up-green">↑ 15%</span>
                    </div>
                    <span className="sap-stat-subtext">73.4% of total</span>
                  </div>
                </div>

                <div className="sap-stat-card">
                  <div className="sap-stat-icon orange"><AlertTriangle size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Warning Logs</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">42,881</span>
                      <span className="sap-stat-delta up-red">↑ 8%</span>
                    </div>
                    <span className="sap-stat-subtext">17.3% of total</span>
                  </div>
                </div>

                <div className="sap-stat-card">
                  <div className="sap-stat-icon red"><AlertTriangle size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Error Logs</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">18,672</span>
                      <span className="sap-stat-delta up-red">↑ 4%</span>
                    </div>
                    <span className="sap-stat-subtext">7.5% of total</span>
                  </div>
                </div>

                <div className="sap-stat-card">
                  <div className="sap-stat-icon purple"><Shield size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Critical Logs</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">4,538</span>
                      <span className="sap-stat-delta up-red">↑ 22%</span>
                    </div>
                    <span className="sap-stat-subtext">1.8% of total</span>
                  </div>
                </div>
              </div>

              {/* 3 Top Charts Row: Logs Trend, Logs by Level, Top Log Sources */}
              <div className="sap-logs-top-charts">
                {/* 1. Logs Trend */}
                <div className="sap-card">
                  <div className="sap-card-header">
                    <div className="sap-card-title-group">
                      <span className="material-symbols-outlined card-icon">trending_up</span>
                      <div>
                        <h3>Logs Trend</h3>
                        <p>Number of logs over time grouped by level.</p>
                      </div>
                    </div>
                    <select className="sap-select-sm"><option>Last 24 Hours</option></select>
                  </div>

                  <svg viewBox="0 0 380 180" style={{ width: '100%', height: 'auto' }}>
                    {[0, 2, 4, 6, 8].map((k, i) => {
                      const y = 145 - i * 28
                      return (
                        <g key={k}>
                          <line x1="35" y1={y} x2="365" y2={y} stroke="#f1f5f9" strokeWidth="1" />
                          <text x="28" y={y + 3} fill="#94a3b8" fontSize="8.5" textAnchor="end">{k ? `${k}K` : 0}</text>
                        </g>
                      )
                    })}
                    {['00:00', '03:30', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00'].map((time, idx) => (
                      <text key={time} x={45 + idx * 45} y="165" fill="#94a3b8" fontSize="8.5" textAnchor="middle">{time}</text>
                    ))}

                    {/* Info (Blue line) */}
                    <path
                      d="M 45 110 L 80 95 L 120 105 L 160 85 L 200 90 L 240 80 L 280 95 L 320 85 L 360 90"
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth="2.5"
                    />
                    {/* Warning (Yellow line) */}
                    <path
                      d="M 45 125 L 80 120 L 120 128 L 160 115 L 200 122 L 240 110 L 280 120 L 320 115 L 360 120"
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth="2"
                    />
                    {/* Error (Red line) */}
                    <path
                      d="M 45 138 L 80 135 L 120 140 L 160 132 L 200 136 L 240 130 L 280 135 L 320 132 L 360 134"
                      fill="none"
                      stroke="#ef4444"
                      strokeWidth="2"
                    />
                    {/* Critical (Purple line) */}
                    <path
                      d="M 45 144 L 80 143 L 120 145 L 160 142 L 200 143 L 240 140 L 280 142 L 320 141 L 360 142"
                      fill="none"
                      stroke="#8b5cf6"
                      strokeWidth="2"
                    />
                  </svg>

                  <div className="sap-chart-legend-row">
                    <div className="sap-chart-legend-item"><span className="sap-chart-legend-dot" style={{ background: '#2563eb' }} /><span>Info</span></div>
                    <div className="sap-chart-legend-item"><span className="sap-chart-legend-dot" style={{ background: '#f59e0b' }} /><span>Warning</span></div>
                    <div className="sap-chart-legend-item"><span className="sap-chart-legend-dot" style={{ background: '#ef4444' }} /><span>Error</span></div>
                    <div className="sap-chart-legend-item"><span className="sap-chart-legend-dot" style={{ background: '#8b5cf6' }} /><span>Critical</span></div>
                  </div>
                </div>

                {/* 2. Logs by Level Donut */}
                <div className="sap-card">
                  <div className="sap-card-header">
                    <div className="sap-card-title-group">
                      <span className="material-symbols-outlined card-icon">donut_small</span>
                      <div>
                        <h3>Logs by Level</h3>
                        <p>Distribution of log levels.</p>
                      </div>
                    </div>
                  </div>

                  <div className="sap-donut-container">
                    <svg viewBox="0 0 160 160" style={{ width: '120px', height: '120px' }}>
                      <circle cx="80" cy="80" r="54" fill="none" stroke="#2563eb" strokeWidth="18" strokeDasharray="248 339" strokeDashoffset="0" />
                      <circle cx="80" cy="80" r="54" fill="none" stroke="#f59e0b" strokeWidth="18" strokeDasharray="58 339" strokeDashoffset="-248" />
                      <circle cx="80" cy="80" r="54" fill="none" stroke="#ef4444" strokeWidth="18" strokeDasharray="25 339" strokeDashoffset="-306" />
                      <circle cx="80" cy="80" r="54" fill="none" stroke="#8b5cf6" strokeWidth="18" strokeDasharray="6 339" strokeDashoffset="-331" />
                    </svg>

                    <div className="sap-donut-center-text">
                      <span className="num">248,521</span>
                      <span className="lbl">Total Logs</span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '0.65rem', width: '100%' }}>
                      <div className="sap-donut-legend-item">
                        <div className="sap-donut-legend-left"><span className="sap-donut-legend-dot" style={{ background: '#2563eb' }} /><span>Info</span></div>
                        <span className="sap-donut-legend-pct">73.4% (182,430)</span>
                      </div>
                      <div className="sap-donut-legend-item">
                        <div className="sap-donut-legend-left"><span className="sap-donut-legend-dot" style={{ background: '#f59e0b' }} /><span>Warning</span></div>
                        <span className="sap-donut-legend-pct">17.3% (42,881)</span>
                      </div>
                      <div className="sap-donut-legend-item">
                        <div className="sap-donut-legend-left"><span className="sap-donut-legend-dot" style={{ background: '#ef4444' }} /><span>Error</span></div>
                        <span className="sap-donut-legend-pct">7.5% (18,672)</span>
                      </div>
                      <div className="sap-donut-legend-item">
                        <div className="sap-donut-legend-left"><span className="sap-donut-legend-dot" style={{ background: '#8b5cf6' }} /><span>Critical</span></div>
                        <span className="sap-donut-legend-pct">1.8% (4,538)</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Top Log Sources */}
                <div className="sap-card">
                  <div className="sap-card-header">
                    <div className="sap-card-title-group">
                      <span className="material-symbols-outlined card-icon">hub</span>
                      <div>
                        <h3>Top Log Sources</h3>
                        <p>Services generating most logs.</p>
                      </div>
                    </div>
                  </div>

                  <div className="sap-source-bar-list">
                    {[
                      { name: 'Web Server', pct: '42.1%', val: 42.1, color: '#3b82f6' },
                      { name: 'Application', pct: '28.3%', val: 28.3, color: '#8b5cf6' },
                      { name: 'Database', pct: '15.4%', val: 15.4, color: '#10b981' },
                      { name: 'Auth System', pct: '8.2%', val: 8.2, color: '#f59e0b' },
                      { name: 'API', pct: '4.1%', val: 4.1, color: '#ef4444' },
                      { name: 'Others', pct: '1.9%', val: 1.9, color: '#64748b' },
                    ].map(src => (
                      <div key={src.name} className="sap-source-bar-item">
                        <div className="sap-source-bar-label-row">
                          <span className="sap-source-bar-name">{src.name}</span>
                          <span className="sap-source-bar-pct">{src.pct}</span>
                        </div>
                        <div className="sap-source-bar-track">
                          <div className="sap-source-bar-fill" style={{ width: `${src.val}%`, background: src.color }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Bottom Section: System Logs Table + Log Details Drawer */}
              <div className="sap-logs-split">
                {/* Left Table */}
                <div className="sap-admin-table-card">
                  <div className="sap-card-header" style={{ padding: '1rem 1.25rem 0' }}>
                    <div className="sap-card-title-group">
                      <span className="material-symbols-outlined card-icon">list_alt</span>
                      <div>
                        <h3>System Logs</h3>
                        <p>View and filter detailed system logs.</p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#475569' }}>
                        <span>Auto Refresh (10s)</span>
                        <label className="sap-toggle-switch">
                          <input type="checkbox" checked={logAutoRefresh} onChange={e => setLogAutoRefresh(e.target.checked)} />
                          <span className="sap-toggle-slider" />
                        </label>
                      </div>
                      <button
                        className="sap-btn-export-outline"
                        onClick={() => {
                          setLogLevelFilter('All Levels')
                          setLogServiceFilter('All Services')
                          setLogUserFilter('All Users')
                          setLogSearchQuery('')
                          showToast('Filters cleared')
                        }}
                      >
                        <Filter size={13} />
                        <span>Clear Filters</span>
                      </button>
                    </div>
                  </div>

                  {/* Filter Controls Bar */}
                  <div className="sap-admin-filter-row" style={{ padding: '0.75rem 1.25rem' }}>
                    <div className="sap-filter-search-box">
                      <Search size={15} className="icon" />
                      <input
                        type="text"
                        placeholder="Search logs (message, user, IP, module...)"
                        value={logSearchQuery}
                        onChange={e => setLogSearchQuery(e.target.value)}
                      />
                    </div>
                    <select className="sap-filter-select" value={logLevelFilter} onChange={e => setLogLevelFilter(e.target.value)}>
                      <option>All Levels</option>
                      <option>INFO</option>
                      <option>WARNING</option>
                      <option>ERROR</option>
                      <option>CRITICAL</option>
                    </select>
                    <select className="sap-filter-select" value={logServiceFilter} onChange={e => setLogServiceFilter(e.target.value)}>
                      <option>All Services</option>
                      <option>Auth</option>
                      <option>API</option>
                      <option>Database</option>
                      <option>System</option>
                      <option>Security</option>
                      <option>Queue</option>
                      <option>Disk</option>
                      <option>Nginx</option>
                    </select>
                    <select className="sap-filter-select" value={logUserFilter} onChange={e => setLogUserFilter(e.target.value)}>
                      <option>All Users</option>
                      <option>amit@cetnova.com</option>
                      <option>priya@cetnova.com</option>
                      <option>-</option>
                    </select>
                  </div>

                  <table className="sap-data-table">
                    <thead>
                      <tr>
                        <th style={{ width: '35px' }}>#</th>
                        <th>Time</th>
                        <th>Level</th>
                        <th>Service</th>
                        <th>Message</th>
                        <th>User</th>
                        <th>IP Address</th>
                        <th style={{ textAlign: 'center' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLogs.map(log => {
                        const isSelected = log.id === selectedLogId
                        return (
                          <tr
                            key={log.id}
                            className={`clickable ${isSelected ? 'selected' : ''}`}
                            onClick={() => setSelectedLogId(log.id)}
                          >
                            <td style={{ color: '#94a3b8' }}>{log.id}</td>
                            <td style={{ color: '#64748b' }}>{log.time}</td>
                            <td>
                              <span className={`sap-alert-badge ${log.level.toLowerCase()}`}>{log.level}</span>
                            </td>
                            <td style={{ fontWeight: 600, color: '#334155' }}>{log.service}</td>
                            <td style={{ color: '#0f172a' }}>{log.message}</td>
                            <td style={{ color: '#64748b' }}>{log.user}</td>
                            <td style={{ color: '#475569' }}>{log.ip}</td>
                            <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
                              <button className="sap-icon-action-btn" onClick={() => setSelectedLogId(log.id)}>
                                <MoreHorizontal size={14} />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>

                  <div className="sap-pagination-bar">
                    <span>Showing 1 to {filteredLogs.length} of 248,521 logs</span>
                    <div className="sap-pagination-pages">
                      <button className="sap-page-btn"><ChevronLeft size={13} /></button>
                      <button className="sap-page-btn active">1</button>
                      <button className="sap-page-btn">2</button>
                      <button className="sap-page-btn">3</button>
                      <button className="sap-page-btn">4</button>
                      <button className="sap-page-btn">5</button>
                      <span>...</span>
                      <button className="sap-page-btn">24,853</button>
                      <button className="sap-page-btn"><ChevronRight size={13} /></button>
                    </div>
                    <select className="sap-select-sm"><option>10 / page</option></select>
                  </div>
                </div>

                {/* Right Drawer: Log Details */}
                {selectedLog && (
                  <div className="sap-log-details-card">
                    <div className="sap-drawer-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <FileText size={18} color="#2563eb" />
                        <h3>Log Details</h3>
                      </div>
                      <button className="sap-drawer-close-btn" onClick={() => setSelectedLogId(0)}>
                        <X size={16} />
                      </button>
                    </div>

                    <div className="sap-log-meta-table">
                      <div className="sap-log-meta-row">
                        <span className="sap-log-meta-key">Time</span>
                        <span className="sap-log-meta-val">{selectedLog.time}</span>
                      </div>
                      <div className="sap-log-meta-row">
                        <span className="sap-log-meta-key">Level</span>
                        <span className="sap-log-meta-val">
                          <span className={`sap-alert-badge ${selectedLog.level.toLowerCase()}`}>{selectedLog.level}</span>
                        </span>
                      </div>
                      <div className="sap-log-meta-row">
                        <span className="sap-log-meta-key">Service</span>
                        <span className="sap-log-meta-val">{selectedLog.service}</span>
                      </div>
                      <div className="sap-log-meta-row">
                        <span className="sap-log-meta-key">Message</span>
                        <span className="sap-log-meta-val" style={{ color: selectedLog.level === 'ERROR' || selectedLog.level === 'CRITICAL' ? '#dc2626' : '#0f172a' }}>
                          {selectedLog.message}
                        </span>
                      </div>
                      <div className="sap-log-meta-row">
                        <span className="sap-log-meta-key">User</span>
                        <span className="sap-log-meta-val">{selectedLog.user}</span>
                      </div>
                      <div className="sap-log-meta-row">
                        <span className="sap-log-meta-key">IP Address</span>
                        <span className="sap-log-meta-val">{selectedLog.ip}</span>
                      </div>
                      <div className="sap-log-meta-row">
                        <span className="sap-log-meta-key">Request ID</span>
                        <span className="sap-log-meta-val" style={{ fontFamily: 'monospace' }}>{selectedLog.requestId}</span>
                      </div>
                      <div className="sap-log-meta-row">
                        <span className="sap-log-meta-key">Module</span>
                        <span className="sap-log-meta-val">{selectedLog.module}</span>
                      </div>
                      <div className="sap-log-meta-row">
                        <span className="sap-log-meta-key">Line</span>
                        <span className="sap-log-meta-val">{selectedLog.line}</span>
                      </div>
                    </div>

                    <div>
                      <span style={{ fontSize: '0.74rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '6px' }}>
                        Stack Trace
                      </span>
                      <div className="sap-stack-trace-box">
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{selectedLog.stackTrace}</pre>
                      </div>
                    </div>

                    <div className="sap-drawer-nav-row">
                      <button
                        className="sap-btn-nav-outline"
                        onClick={() => {
                          const currIdx = logsList.findIndex(l => l.id === selectedLogId)
                          if (currIdx > 0) setSelectedLogId(logsList[currIdx - 1].id)
                        }}
                        disabled={logsList.findIndex(l => l.id === selectedLogId) <= 0}
                      >
                        <ChevronLeft size={14} />
                        <span>Previous Log</span>
                      </button>
                      <button
                        className="sap-btn-nav-outline"
                        onClick={() => {
                          const currIdx = logsList.findIndex(l => l.id === selectedLogId)
                          if (currIdx < logsList.length - 1) setSelectedLogId(logsList[currIdx + 1].id)
                        }}
                        disabled={logsList.findIndex(l => l.id === selectedLogId) >= logsList.length - 1}
                      >
                        <span>Next Log</span>
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* SCREEN 6: SYSTEM SETTINGS                                                 */}
          {/* ========================================================================= */}
          {activeNav === 'server' && (
            <div>
              <div className="ss-page-header">
                <div>
                  <h1>System Settings</h1>
                  <p>Manage server status, services, maintenance mode, cache and system configuration.</p>
                </div>
                <div className="ss-datetime-chip">
                  <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#2563eb' }}>calendar_today</span>
                  <span>{new Date().toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</span>
                  <span className="ss-time">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>

              {/* KPI Cards Row */}
              <section className="ss-kpi-row">
                <div className="ss-kpi-card ss-kpi-blue">
                  <div className="ss-kpi-icon"><Cpu size={22} /></div>
                  <div className="ss-kpi-body">
                    <span className="ss-kpi-label">CPU Usage</span>
                    <span className="ss-kpi-val">{serverMetrics?.cpuUsage ? `${serverMetrics.cpuUsage.toFixed(1)}%` : '18.4%'}</span>
                    <div className="ss-kpi-sub">
                      <span className="ss-kpi-delta ss-delta-green">↓ 12%</span>
                      <span>{serverMetrics?.cpuCores ? `${serverMetrics.cpuCores} / ${serverMetrics.cpuCores * 2} cores` : '4 / 8 cores'}</span>
                    </div>
                  </div>
                </div>

                <div className="ss-kpi-card ss-kpi-purple">
                  <div className="ss-kpi-icon"><Layers size={22} /></div>
                  <div className="ss-kpi-body">
                    <span className="ss-kpi-label">RAM Usage</span>
                    <span className="ss-kpi-val">4.2 / 16.0 GB</span>
                    <div className="ss-kpi-sub">
                      <span className="ss-kpi-delta ss-delta-green">↓ 6%</span>
                      <span>26.2%</span>
                    </div>
                  </div>
                </div>

                <div className="ss-kpi-card ss-kpi-emerald">
                  <div className="ss-kpi-icon"><Database size={22} /></div>
                  <div className="ss-kpi-body">
                    <span className="ss-kpi-label">Disk Usage</span>
                    <span className="ss-kpi-val">24.5 / 50.0 GB</span>
                    <div className="ss-kpi-sub">
                      <span className="ss-kpi-delta ss-delta-red">↑ 8%</span>
                      <span>49.0%</span>
                    </div>
                  </div>
                </div>

                <div className="ss-kpi-card ss-kpi-cyan">
                  <div className="ss-kpi-icon"><Activity size={22} /></div>
                  <div className="ss-kpi-body">
                    <span className="ss-kpi-label">Load Average</span>
                    <span className="ss-kpi-val">0.34</span>
                    <div className="ss-kpi-sub">
                      <span className="ss-kpi-delta ss-delta-green">↓ 20%</span>
                      <span>Normal</span>
                    </div>
                  </div>
                </div>
              </section>

              {/* Sub-Tab Bar */}
              <nav className="ss-tab-bar">
                {([
                  ['overview', 'home', 'Overview'],
                  ['server-status', 'dns', 'Server Status'],
                  ['services', 'settings_ethernet', 'Service Management'],
                  ['maintenance', 'power_settings_new', 'Maintenance Mode'],
                  ['cache', 'storage', 'Cache Management'],
                  ['configuration', 'settings', 'Configuration'],
                ] as const).map(([key, icon, label]) => (
                  <button
                    key={key}
                    className={`ss-tab-btn ${sysTab === key ? 'active' : ''}`}
                    onClick={() => setSysTab(key)}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>{icon}</span>
                    {label}
                  </button>
                ))}
              </nav>

              {/* Tab Content */}
              <div className="ss-content-grid">
                <div className="ss-col-left">
                  {/* Maintenance Mode card */}
                  <div className="ss-card">
                    <div className="ss-card-header">
                      <div className="ss-card-title-wrap">
                        <div className="ss-card-icon-box ss-icon-orange"><Power size={18} /></div>
                        <div>
                          <h3>Maintenance Mode</h3>
                          <p>Temporarily disable student access for platform upgrades.</p>
                        </div>
                      </div>
                      <span className={`ss-maint-pill ${maintenanceEnabled ? 'active' : 'disabled'}`}>
                        {maintenanceEnabled ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                    <div className="ss-maint-toggle-row">
                      <label className="sap-toggle-switch">
                        <input
                          type="checkbox"
                          checked={maintenanceEnabled}
                          onChange={e => setMaintenanceEnabled(e.target.checked)}
                        />
                        <span className="sap-toggle-slider" />
                      </label>
                      <div>
                        <div className="ss-maint-toggle-title">Enable Maintenance Mode</div>
                        <div className="ss-maint-toggle-sub">When active, only Super Admin accounts can sign in.</div>
                      </div>
                    </div>
                    <div className="ss-maint-msg-wrap">
                      <label className="ss-field-label">Maintenance Notice Message</label>
                      <textarea
                        className="ss-textarea"
                        rows={3}
                        value={maintenanceMessage}
                        onChange={e => setMaintenanceMessage(e.target.value)}
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button className="ss-save-btn" onClick={handleSaveMaintenance} disabled={savingMaintenance}>
                        <CheckCircle2 size={15} />
                        <span>{savingMaintenance ? 'Saving...' : 'Save Changes'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Cache Management */}
                  <div className="ss-card">
                    <div className="ss-card-header">
                      <div className="ss-card-title-wrap">
                        <div className="ss-card-icon-box ss-icon-emerald"><Database size={18} /></div>
                        <div>
                          <h3>Cache Management</h3>
                          <p>Clear application cache, configuration cache and cached views.</p>
                        </div>
                      </div>
                    </div>
                    <div className="ss-cache-btn-grid">
                      <button className="ss-cache-btn-red" onClick={() => showToast('Application cache cleared')}>
                        <Trash2 size={13} /> Clear Application Cache
                      </button>
                      <button className="ss-cache-btn-outline" onClick={() => showToast('Config cache flushed')}>
                        <RotateCcw size={13} /> Clear Config Cache
                      </button>
                      <button className="ss-cache-btn-outline" onClick={() => showToast('View cache cleared')}>
                        <Trash2 size={13} /> Clear View Cache
                      </button>
                      <button className="ss-cache-btn-purple" onClick={() => showToast('Redis partitions flushed')}>
                        <Database size={13} /> Clear Redis Cache
                      </button>
                    </div>
                  </div>
                </div>

                <div className="ss-col-right">
                  {/* Server Information */}
                  <div className="ss-card">
                    <div className="ss-card-header">
                      <div className="ss-card-title-group">
                        <div className="ss-card-icon-box ss-icon-blue"><Server size={18} /></div>
                        <div>
                          <h3>Server Information</h3>
                          <p>Detailed runtime environment information.</p>
                        </div>
                      </div>
                      <button className="ss-refresh-btn" onClick={() => { setRefreshing(true); void loadData(); setTimeout(() => setRefreshing(false), 500) }}>
                        <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
                        Refresh
                      </button>
                    </div>
                    <div className="ss-info-list">
                      {[
                        ['dns', 'Server Name', serverMetrics?.hostname || 'cetnova-prod-node-01'],
                        ['computer', 'OS', `${serverMetrics?.platform || 'Linux'} ${serverMetrics?.release || '5.15.0'}`],
                        ['schedule', 'Uptime', '14 days, 6 hours, 22 minutes'],
                        ['cloud', 'Web Server', 'Nginx 1.24 / Node.js 20.11'],
                        ['storage', 'Database', 'MySQL 8.0.35 Enterprise'],
                        ['shield', 'Environment', 'production'],
                        ['label', 'Application Version', 'v2.4.1-rc3'],
                      ].map(([icon, label, val]) => (
                        <div key={label} className="ss-info-row">
                          <span className="ss-info-icon">
                            <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#2563eb' }}>{icon}</span>
                          </span>
                          <span className="ss-info-key">{label}</span>
                          <span className={`ss-info-val ${label === 'Environment' ? 'ss-env-pill' : ''}`}>{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeNav === 'storage' && <StorageOptimizationDashboard />}

          {/* ========================================================================= */}
          {/* SCREEN 7: SERVER CONTROL                                                  */}
          {/* ========================================================================= */}
          {activeNav === 'server-control' && (
            <div>
              <div className="sap-page-banner">
                <div className="sap-page-banner-left">
                  <div className="sap-banner-icon-box">
                    <Server size={24} />
                  </div>
                  <div className="sap-banner-text">
                    <h1>Server Control</h1>
                    <p>Restart services, monitor hardware health and execute administrative commands.</p>
                  </div>
                </div>
                <div className="sap-page-banner-right">
                  <button className="sap-btn-primary-action" onClick={() => setShowConfigModal(true)}>
                    <Sliders size={15} />
                    <span>View Configuration</span>
                  </button>
                </div>
              </div>

              <div className="sap-sec-row-3">
                <div className="sap-card">
                  <div className="sap-card-header">
                    <h3>Service Orchestrator</h3>
                  </div>
                  <div className="sap-sec-controls-list">
                    {['Node.js API Server', 'MySQL Database Daemon', 'Redis Cache Cluster', 'Nginx Reverse Proxy'].map(svc => (
                      <div key={svc} className="sap-sec-ctrl-row">
                        <div className="sap-sec-ctrl-left">
                          <div className="sap-sec-ctrl-icon blue"><Cpu size={16} /></div>
                          <div className="sap-sec-ctrl-titles">
                            <h4>{svc}</h4>
                            <p>Running normally (100% health)</p>
                          </div>
                        </div>
                        <button className="sap-btn-ctrl blue" onClick={() => showToast(`Restart command sent to ${svc}`)}>
                          Restart
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="sap-card">
                  <div className="sap-card-header">
                    <h3>Process Health</h3>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 600 }}>
                        <span>Worker Process #1</span>
                        <span style={{ color: '#16a34a' }}>Active (PID: 1204)</span>
                      </div>
                      <div className="sap-progress-track" style={{ marginTop: '4px' }}>
                        <div className="sap-progress-fill" style={{ width: '45%' }} />
                      </div>
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 600 }}>
                        <span>Worker Process #2</span>
                        <span style={{ color: '#16a34a' }}>Active (PID: 1205)</span>
                      </div>
                      <div className="sap-progress-track" style={{ marginTop: '4px' }}>
                        <div className="sap-progress-fill" style={{ width: '38%' }} />
                      </div>
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 600 }}>
                        <span>Background Queue Worker</span>
                        <span style={{ color: '#16a34a' }}>Active (PID: 1210)</span>
                      </div>
                      <div className="sap-progress-track" style={{ marginTop: '4px' }}>
                        <div className="sap-progress-fill" style={{ width: '22%' }} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="sap-card">
                  <div className="sap-card-header">
                    <h3>Emergency Actions</h3>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <button className="sap-btn-drawer-solid-red" onClick={() => showToast('Reboot request blocked: requires root shell.', 'error')}>
                      Graceful Reboot
                    </button>
                    <button className="sap-btn-drawer-solid-blue" onClick={() => showToast('Memory garbage collector triggered.', 'success')}>
                      Trigger Node GC
                    </button>
                    <button className="sap-btn-drawer-outline" onClick={() => showToast('SSL Certificates verified valid until Oct 2027.', 'success')}>
                      Verify SSL Certificates
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* SCREEN 8: DASHBOARD                                                       */}
          {/* ========================================================================= */}
          {activeNav === 'dashboard' && (
            <div>
              <div className="sap-page-banner">
                <div className="sap-page-banner-left">
                  <div className="sap-banner-icon-box">
                    <LayoutDashboard size={24} />
                  </div>
                  <div className="sap-banner-text">
                    <h1>Super Admin Executive Dashboard</h1>
                    <p>High-level platform health, active students, registrations, and administrative control.</p>
                  </div>
                </div>
              </div>

              {/* Top 5 Stat Cards */}
              <div className="sap-stats-row-5">
                <div className="sap-stat-card">
                  <div className="sap-stat-icon blue"><Users size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Total Students</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">{stats?.totalStudents || '14,820'}</span>
                    </div>
                    <span className="sap-stat-subtext" style={{ color: '#16a34a' }}>+120 today</span>
                  </div>
                </div>

                <div className="sap-stat-card">
                  <div className="sap-stat-icon green"><CheckCircle2 size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Active Exams</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">{stats?.activeExams || '18'}</span>
                    </div>
                    <span className="sap-stat-subtext">Across all subjects</span>
                  </div>
                </div>

                <div className="sap-stat-card">
                  <div className="sap-stat-icon purple"><Share2 size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Today's Attempts</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">{stats?.todayAttempts || '2,490'}</span>
                    </div>
                    <span className="sap-stat-subtext">Peak performance</span>
                  </div>
                </div>

                <div className="sap-stat-card">
                  <div className="sap-stat-icon orange"><Shield size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Security State</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number" style={{ color: '#16a34a' }}>Healthy</span>
                    </div>
                    <span className="sap-stat-subtext">0 breaches</span>
                  </div>
                </div>

                <div className="sap-stat-card">
                  <div className="sap-stat-icon teal"><Layers size={20} /></div>
                  <div className="sap-stat-content">
                    <span className="sap-stat-title">Total Questions</span>
                    <div className="sap-stat-row-val">
                      <span className="sap-stat-number">{stats?.totalQuestions || '8,450'}</span>
                    </div>
                    <span className="sap-stat-subtext">CET Curriculum</span>
                  </div>
                </div>
              </div>

              {/* Quick Jump Panels Grid */}
              <div className="sap-sec-row-3">
                <div className="sap-card" style={{ cursor: 'pointer' }} onClick={() => setActiveNav('admins')}>
                  <div className="sap-card-header">
                    <h3>Admin Management &rarr;</h3>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    Review, assign privileges, and monitor all {adminsList.length} registered administrators across Central, PCM, Biology, and Maths departments.
                  </p>
                </div>

                <div className="sap-card" style={{ cursor: 'pointer' }} onClick={() => setActiveNav('security')}>
                  <div className="sap-card-header">
                    <h3>Security Center &rarr;</h3>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    Analyze threat vectors, inspect recent failed login bursts, and review the global login geographic heat map.
                  </p>
                </div>

                <div className="sap-card" style={{ cursor: 'pointer' }} onClick={() => setActiveNav('backup')}>
                  <div className="sap-card-header">
                    <h3>Backup &amp; Restore &rarr;</h3>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    Verify automated daily snapshots, generate immediate database archives, or inspect disk storage consumption.
                  </p>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ── MODAL: ADD NEW ADMIN ─────────────────────────────── */}
      {showAddAdminModal && (
        <div className="sap-modal-overlay" onClick={() => setShowAddAdminModal(false)}>
          <div className="sap-modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div className="sap-modal-header">
              <h3>Add New Administrator</h3>
              <button className="sap-modal-close-btn" onClick={() => setShowAddAdminModal(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="sap-modal-body">
              <div className="sap-form-group">
                <label className="sap-form-label">Full Name</label>
                <input
                  type="text"
                  className="sap-text-input"
                  placeholder="e.g. Ramesh Patil"
                  value={newAdminName}
                  onChange={e => setNewAdminName(e.target.value)}
                />
              </div>

              <div className="sap-form-group">
                <label className="sap-form-label">Email Address</label>
                <input
                  type="email"
                  className="sap-text-input"
                  placeholder="e.g. ramesh@cetnova.com"
                  value={newAdminEmail}
                  onChange={e => setNewAdminEmail(e.target.value)}
                />
              </div>

              <div className="sap-form-group">
                <label className="sap-form-label">Role</label>
                <select className="sap-form-select" value={newAdminRole} onChange={e => setNewAdminRole(e.target.value)}>
                  <option value="Basic Admin">Basic Admin</option>
                </select>
              </div>

              <div className="sap-form-group">
                <label className="sap-form-label">Department / Cluster</label>
                <select className="sap-form-select" value={newAdminCluster} onChange={e => setNewAdminCluster(e.target.value)}>
                  {adminClusters.length === 0 && <option value="default">default</option>}
                  {adminClusters.map(cluster => <option key={cluster}>{cluster}</option>)}
                </select>
              </div>
            </div>
            <div className="sap-modal-footer">
              <button className="sap-btn-restart-sm" onClick={() => setShowAddAdminModal(false)}>
                Cancel
              </button>
              <button className="sap-btn-primary" onClick={handleAddNewAdmin}>
                Add Admin
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: 1-CLICK LOCK ADMIN ────────────────────────── */}
      {lockModalAdmin && (
        <div className="sap-modal-overlay" onClick={() => setLockModalAdmin(null)}>
          <div className="sap-modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <div className="sap-modal-header">
              <h3>Lock Administrator Account</h3>
              <button className="sap-modal-close-btn" onClick={() => setLockModalAdmin(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="sap-modal-body">
              <p style={{ fontSize: '0.85rem', color: '#475569' }}>
                Are you sure you want to suspend privileges and terminate sessions for{' '}
                <strong style={{ color: '#0f172a' }}>{lockModalAdmin.name}</strong>?
              </p>
              <div className="sap-form-group" style={{ marginTop: '0.75rem' }}>
                <label className="sap-form-label">Reason for suspension (optional)</label>
                <input
                  type="text"
                  className="sap-text-input"
                  placeholder="Security audit or unauthorized action"
                  value={lockReason}
                  onChange={e => setLockReason(e.target.value)}
                />
              </div>
            </div>
            <div className="sap-modal-footer">
              <button className="sap-btn-restart-sm" onClick={() => setLockModalAdmin(null)}>
                Cancel
              </button>
              <button
                className="sap-btn-primary"
                style={{ background: '#dc2626' }}
                onClick={handleLockAdminAction}
              >
                Lock Administrator
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: SECURITY ALERTS ───────────────────────────── */}
      {showAlertsModal && (
        <div className="sap-modal-overlay" onClick={() => setShowAlertsModal(false)}>
          <div className="sap-modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '540px' }}>
            <div className="sap-modal-header">
              <h3>Active Security Threats &amp; Alerts</h3>
              <button className="sap-modal-close-btn" onClick={() => setShowAlertsModal(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="sap-modal-body">
              {alerts.length ? (
                alerts.map(a => (
                  <div key={a.id} style={{ padding: '10px 12px', border: '1px solid #fee2e2', background: '#fff5f5', borderRadius: 8, marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <strong style={{ color: '#dc2626', fontSize: '0.85rem' }}>{a.alert_type}</strong>
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{new Date(a.created_at).toLocaleTimeString()}</span>
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#475569' }}>{a.description}</p>
                  </div>
                ))
              ) : (
                <div style={{ textAlign: 'center', padding: '1.5rem', color: '#64748b' }}>
                  No active critical security anomalies detected. System status is green.
                </div>
              )}
            </div>
            <div className="sap-modal-footer">
              <button className="sap-btn-primary" onClick={() => setShowAlertsModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: HELP & DOCUMENTATION ──────────────────────── */}
      {showHelpModal && (
        <div className="sap-modal-overlay" onClick={() => setShowHelpModal(false)}>
          <div className="sap-modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <div className="sap-modal-header">
              <h3>CETNova Super Admin Documentation</h3>
              <button className="sap-modal-close-btn" onClick={() => setShowHelpModal(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="sap-modal-body" style={{ fontSize: '0.84rem', color: '#334155', lineHeight: 1.6 }}>
              <p><strong>Security Center:</strong> Review real-time brute force detection, IP blocklists, and global geographic authentication sources.</p>
              <p><strong>Admin Management:</strong> Provision, suspend, and configure modular access roles for all content and exam staff.</p>
              <p><strong>API &amp; Usage:</strong> Track throughput, response time latency metrics, error patterns (4xx/5xx), and endpoint frequency.</p>
              <p><strong>Backup &amp; Restore:</strong> Create point-in-time database snapshots and configure automated backup schedules.</p>
              <p><strong>System Logs:</strong> Live diagnostic stream with stack trace inspection and severity categorization.</p>
            </div>
            <div className="sap-modal-footer">
              <button className="sap-btn-primary" onClick={() => setShowHelpModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: RUNTIME CONFIG ────────────────────────────── */}
      {showConfigModal && (
        <div className="sap-modal-overlay" onClick={() => setShowConfigModal(false)}>
          <div className="sap-modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="sap-modal-header">
              <h3>Runtime Configuration</h3>
              <button className="sap-modal-close-btn" onClick={() => setShowConfigModal(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="sap-modal-body">
              <div className="sap-info-table">
                <div className="sap-info-row"><span className="sap-info-key">PORT</span><span className="sap-info-val">5000</span></div>
                <div className="sap-info-row"><span className="sap-info-key">Environment</span><span className="sap-badge-pill normal">production</span></div>
                <div className="sap-info-row"><span className="sap-info-key">Runtime</span><span className="sap-info-val">Node.js 20.11</span></div>
                <div className="sap-info-row"><span className="sap-info-key">Database</span><span className="sap-info-val">MySQL 8.0</span></div>
                <div className="sap-info-row"><span className="sap-info-key">Session Storage</span><span className="sap-info-val">HTTP-only cookie</span></div>
              </div>
            </div>
            <div className="sap-modal-footer">
              <button className="sap-btn-primary" onClick={() => setShowConfigModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
