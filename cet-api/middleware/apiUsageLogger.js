const supabase = require('../config/supabase')
const crypto = require('crypto')

// In-memory tracker for rapid 401/403 brute force detection
const failedAttemptsMap = new Map()

const cleanupOldAttempts = () => {
  const now = Date.now()
  for (const [ip, data] of failedAttemptsMap.entries()) {
    if (now - data.lastAttempt > 60000) {
      failedAttemptsMap.delete(ip)
    }
  }
}
setInterval(cleanupOldAttempts, 60000).unref?.()

const apiUsageLogger = (req, res, next) => {
  // Ignore static assets or simple health checks
  if (
    req.path === '/health' ||
    req.path === '/' ||
    req.path.startsWith('/favicon') ||
    req.method === 'OPTIONS'
  ) {
    return next()
  }

  const startTime = Date.now()
  req.requestId = crypto.randomUUID()
  res.setHeader('X-Request-ID', req.requestId)

  res.on('finish', async () => {
    const responseTime = Date.now() - startTime
    const statusCode = res.statusCode
    const rawIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || ''
    const ip = typeof rawIp === 'string' ? rawIp.split(',')[0].trim() : String(rawIp)
    const userId = req.user?.id || req.user?._id || null
    const clusterId = req.user?.clusterId || 'default'
    const endpoint = ((req.baseUrl || '') + (req.path || ''))
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi, '/:id')

    if (statusCode === 429) {
      console.warn(JSON.stringify({
        event: 'api_rate_limited',
        requestId: req.requestId,
        method: req.method,
        endpoint,
        statusCode,
        responseTimeMs: responseTime,
        timestamp: new Date().toISOString(),
      }))
    }

    // 1. Asynchronously log to api_usage_logs
    try {
      await supabase.from('api_usage_logs').insert({
        user_id: userId,
        cluster_id: clusterId,
        endpoint: endpoint.slice(0, 255),
        method: req.method,
        status_code: statusCode,
        response_time_ms: responseTime,
        ip_address: ip.slice(0, 64),
      })
    } catch (err) {
      // Non-blocking error handling
      if (process.env.NODE_ENV !== 'production') {
        // silently ignore table not created yet if user hasn't run migration
      }
    }

    // 2. Automated Threat & Security Alert Detection
    if (statusCode === 401 || statusCode === 403 || statusCode === 429) {
      try {
        const key = `${ip}_${endpoint}`
        const record = failedAttemptsMap.get(key) || { count: 0, lastAttempt: Date.now() }
        record.count += 1
        record.lastAttempt = Date.now()
        failedAttemptsMap.set(key, record)

        if (record.count >= 5 && record.count % 5 === 0) {
          const isRateLimitBurst = statusCode === 429
          await supabase.from('security_alerts').insert({
            alert_type: isRateLimitBurst ? 'RATE_LIMIT_BURST' : 'BRUTE_FORCE',
            severity: record.count >= 10 ? 'high' : 'medium',
            description: isRateLimitBurst
              ? `Excessive rate limiting: ${record.count} requests from IP ${ip} were throttled on endpoint ${endpoint}`
              : `Potential brute force detected: ${record.count} failed attempts from IP ${ip} on endpoint ${endpoint}`,
            metadata: { ip, endpoint, failedCount: record.count, userId },
            status: 'active',
          })
        }
      } catch {}
    } else if (statusCode >= 500) {
      try {
        // High severity 5xx server failure
        await supabase.from('security_alerts').insert({
          alert_type: 'SERVER_ERROR_BURST',
          severity: 'high',
          description: `Internal Server Error (${statusCode}) on ${req.method} ${endpoint}`,
          metadata: { ip, endpoint, method: req.method, statusCode, responseTime },
          status: 'active',
        })
      } catch {}
    }
  })

  next()
}

module.exports = apiUsageLogger
