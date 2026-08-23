const mongoose = require('mongoose')

const MockTestSchema = new mongoose.Schema({
  title: { type: String, required: true },
  subject: { type: String, required: true },
  questions: { type: Number, required: true },
  duration: { type: Number, required: true },
  difficulty: { type: String, enum: ['Easy', 'Medium', 'Hard'], required: true },
  status: { type: String, enum: ['active', 'scheduled', 'draft'], default: 'draft' },
  attempts: { type: Number, default: 0 },
  avgScore: { type: Number, default: 0 },
  scheduledDate: String,
  createdBy: String,
}, { timestamps: true })

module.exports = mongoose.models.MockTest || mongoose.model('MockTest', MockTestSchema)