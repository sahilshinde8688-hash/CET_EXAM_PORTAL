const mongoose = require('mongoose')

const RefreshTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  sessionId: {
    type: String,
    required: true,
    index: true,
  },
  tokenHash: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  deviceName: { type: String, default: 'Unknown Device' },
  browser: { type: String, default: 'Unknown Browser' },
  operatingSystem: { type: String, default: 'Unknown OS' },
  ipAddress: { type: String, default: 'Unknown IP' },
  country: { type: String, default: '' },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  revokedAt: { type: Date, default: null },
  replacedBy: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
}, { timestamps: true })

module.exports = mongoose.model('RefreshToken', RefreshTokenSchema)
