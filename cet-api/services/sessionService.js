const uaParser = require('ua-parser-js')

const getDeviceInfo = (req) => {
  const ua = uaParser(req.headers['user-agent'] || '')
  const browser = ua.browser?.name || 'Unknown Browser'
  const os = ua.os?.name || 'Unknown OS'
  const deviceName = ua.device?.model || ua.device?.vendor || 'Unknown Device'

  return {
    deviceName,
    browser,
    operatingSystem: os,
    ipAddress: req.ip || req.headers['x-forwarded-for'] || 'Unknown IP',
    country: req.headers['cf-ipcountry'] || '',
  }
}

module.exports = { getDeviceInfo }
