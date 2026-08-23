const mongoose = require('mongoose')

const LoginHistorySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  sessionId: { type: String, default: '' },
  event: {
    type: String,
    enum: ['login_success', 'login_failed', 'refresh_success', 'logout', 'session_revoked'],
    required: true,
    index: true,
  },
  ipAddress: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  browser: { type: String, default: '' },
  operatingSystem: { type: String, default: '' },
  deviceName: { type: String, default: '' },
  country: { type: String, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true })

module.exports = mongoose.model('LoginHistory', LoginHistorySchema)
