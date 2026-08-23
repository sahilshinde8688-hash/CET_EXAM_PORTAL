const mongoose = require('mongoose')

const SessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  deviceName: { type: String, default: 'Unknown Device' },
  browser: { type: String, default: 'Unknown Browser' },
  operatingSystem: { type: String, default: 'Unknown OS' },
  ipAddress: { type: String, default: 'Unknown IP' },
  country: { type: String, default: '' },
  loginAt: { type: Date, default: Date.now },
  lastActivity: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  revokedAt: { type: Date, default: null },
  isCurrent: { type: Boolean, default: true },
}, { timestamps: true })

module.exports = mongoose.model('Session', SessionSchema)
