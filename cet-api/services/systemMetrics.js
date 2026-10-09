const os = require('os')
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')
const supabase = require('../config/supabase')

const SAMPLE_INTERVAL_MS = 60_000
const RETENTION_DAYS = 30
const ALERT_THRESHOLD = 90
const LOAD_CACHE_MS = 5_000
const execFileAsync = promisify(execFile)
let collectionTimer
let lastCpuSample = null
let cachedLoadMetric = { value: null, label: 'LOAD AVERAGE', reason: null, checkedAt: 0 }

const cpuTimes = () => os.cpus().map(({ times }) => ({
  idle: times.idle,
  total: times.user + times.nice + times.sys + times.idle + times.irq,
}))

const getCpuUsage = async () => {
  const current = cpuTimes()
  if (!lastCpuSample) {
    lastCpuSample = current
    await new Promise(resolve => setTimeout(resolve, 200))
  }

  const previous = lastCpuSample
  const next = cpuTimes()
  lastCpuSample = next
  if (!previous?.length || previous.length !== next.length) return null

  let idle = 0
  let total = 0
  for (let i = 0; i < next.length; i += 1) {
    idle += next[i].idle - previous[i].idle
    total += next[i].total - previous[i].total
  }
  return total > 0 ? Math.round((1 - idle / total) * 1000) / 10 : null
}

const getDiskUsage = async () => {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return { available: false, reason: 'Not available in this hosting environment' }
  }

  if (typeof fs.promises.statfs !== 'function') {
    return { available: false, reason: 'Disk metrics are not supported by this Node.js runtime' }
  }

  try {
    const { blocks, bsize, bavail } = await fs.promises.statfs(path.resolve(__dirname, '..'))
    const totalBytes = Number(blocks) * Number(bsize)
    const availableBytes = Number(bavail) * Number(bsize)
    const usedBytes = totalBytes - availableBytes
    if (!Number.isFinite(totalBytes) || totalBytes <= 0 || !Number.isFinite(usedBytes)) {
      return { available: false, reason: 'Disk metrics are unavailable' }
    }

    return {
      available: true,
      usedGB: Math.round((usedBytes / 1024 ** 3) * 10) / 10,
      totalGB: Math.round((totalBytes / 1024 ** 3) * 10) / 10,
      percentage: Math.round((usedBytes / totalBytes) * 1000) / 10,
    }
  } catch {
    return { available: false, reason: 'Disk metrics are unavailable in this hosting environment' }
  }
}

const getLoadMetric = async isServerless => {
  if (Date.now() - cachedLoadMetric.checkedAt < LOAD_CACHE_MS) return cachedLoadMetric

  if (isServerless) {
    cachedLoadMetric = {
      value: null,
      label: 'LOAD AVERAGE',
      reason: 'Not available in this hosting environment',
      checkedAt: Date.now(),
    }
    return cachedLoadMetric
  }

  if (os.platform() === 'win32') {
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_System).ProcessorQueueLength'],
        { timeout: 3000, windowsHide: true },
      )
      const value = Number(stdout.trim())
      cachedLoadMetric = {
        value: Number.isFinite(value) ? value : null,
        label: 'CPU QUEUE',
        reason: Number.isFinite(value) ? null : 'Windows processor queue metric returned an invalid value',
        checkedAt: Date.now(),
      }
    } catch {
      cachedLoadMetric = {
        value: null,
        label: 'CPU QUEUE',
        reason: 'Windows processor queue metric is unavailable',
        checkedAt: Date.now(),
      }
    }
    return cachedLoadMetric
  }

  const [value] = os.loadavg()
  cachedLoadMetric = {
    value: Number.isFinite(value) ? Math.round(value * 100) / 100 : null,
    label: 'LOAD AVERAGE',
    reason: Number.isFinite(value) ? null : 'Load average is unavailable in this hosting environment',
    checkedAt: Date.now(),
  }
  return cachedLoadMetric
}

const getSystemMetrics = async ({ measureCpu = true } = {}) => {
  const totalMemoryBytes = os.totalmem()
  const freeMemoryBytes = os.freemem()
  const usedMemoryBytes = Math.max(0, totalMemoryBytes - freeMemoryBytes)
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)
  const cpuUsage = isServerless ? null : measureCpu ? await getCpuUsage() : null
  const disk = await getDiskUsage()
  const loadMetric = await getLoadMetric(isServerless)

  return {
    cpuUsage,
    cpuCores: isServerless ? null : os.cpus().length,
    memoryUsedGB: isServerless ? null : Math.round((usedMemoryBytes / 1024 ** 3) * 10) / 10,
    memoryTotalGB: isServerless ? null : Math.round((totalMemoryBytes / 1024 ** 3) * 10) / 10,
    memoryUsage: isServerless ? null : Math.round((usedMemoryBytes / totalMemoryBytes) * 1000) / 10,
    diskUsedGB: disk.available ? disk.usedGB : null,
    diskTotalGB: disk.available ? disk.totalGB : null,
    diskUsage: disk.available ? disk.percentage : null,
    diskUnavailableReason: disk.available ? null : disk.reason,
    loadAverage: loadMetric.value,
    loadLabel: loadMetric.label,
    uptimeSeconds: isServerless ? null : Math.floor(os.uptime()),
    processUptimeSeconds: Math.floor(process.uptime()),
    cpuUnavailableReason: isServerless
      ? 'Not available in this hosting environment'
      : cpuUsage === null
        ? 'Waiting for a CPU sample'
        : null,
    loadUnavailableReason: loadMetric.reason,
    timestamp: new Date().toISOString(),
  }
}

const collectAndSaveMetrics = async () => {
  const metrics = await getSystemMetrics()
  const { error } = await supabase.from('system_metrics').insert({
    cpu_usage: metrics.cpuUsage,
    memory_usage: metrics.memoryUsage,
    disk_usage: metrics.diskUsage,
    load_average: metrics.loadAverage,
    created_at: metrics.timestamp,
  })
  if (error) throw error

  const highMetrics = [
    { value: metrics.cpuUsage, type: 'HIGH_CPU_USAGE', label: 'CPU', key: 'cpu_usage' },
    { value: metrics.diskUsage, type: 'HIGH_DISK_USAGE', label: 'Disk', key: 'disk_usage' },
  ].filter(metric => typeof metric.value === 'number' && metric.value >= ALERT_THRESHOLD)

  for (const metric of highMetrics) {
    const { data: existing, error: lookupError } = await supabase
      .from('security_alerts')
      .select('id')
      .eq('alert_type', metric.type)
      .eq('status', 'active')
      .limit(1)
    if (lookupError) throw lookupError
    if (existing?.length) continue

    const { error: alertError } = await supabase.from('security_alerts').insert({
      alert_type: metric.type,
      severity: 'high',
      description: `${metric.label} usage reached ${metric.value}%, above the configured ${ALERT_THRESHOLD}% alert threshold.`,
      metadata: { metric: metric.key, value: metric.value, threshold: ALERT_THRESHOLD },
      status: 'active',
    })
    if (alertError) throw alertError
  }
}

const startSystemMetricsCollection = () => {
  if (collectionTimer) return
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    console.info('Background system metrics collection is unavailable in serverless hosting.')
    return
  }
  const collect = () => {
    collectAndSaveMetrics().catch(error => {
      console.error('System metrics collection failed:', error.message || error)
    })
  }
  collect()
  collectionTimer = setInterval(collect, SAMPLE_INTERVAL_MS)
  collectionTimer.unref?.()

  const prune = async () => {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const { error } = await supabase.from('system_metrics').delete().lt('created_at', cutoff)
    if (error) console.error('System metrics retention cleanup failed:', error.message || error)
  }
  const cleanupTimer = setInterval(() => {
    prune().catch(error => console.error('System metrics retention cleanup failed:', error.message || error))
  }, 24 * 60 * 60 * 1000)
  cleanupTimer.unref?.()
}

module.exports = { getSystemMetrics, startSystemMetricsCollection }
