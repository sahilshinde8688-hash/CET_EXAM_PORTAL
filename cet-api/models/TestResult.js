const mongoose = require('mongoose')

const TestResultSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  testName:   { type: String, required: true },
  subject:    { type: String },
  score:      { type: Number, required: true },
  totalMarks: { type: Number, required: true },
  percentile: { type: Number },
  duration:   { type: Number }, // in minutes
  attemptedAt:{ type: Date, default: Date.now },
  correct:    { type: Number, default: 0 },
  incorrect:  { type: Number, default: 0 },
  unanswered: { type: Number, default: 0 },
  totalQuestions: { type: Number, default: 0 },
  subjectWiseScores: [{
    subject: String,
    score: Number,
    maxScore: Number,
    percentage: Number
  }],
  answers: { type: Map, of: Number },
}, { timestamps: true })

TestResultSchema.index({ userId: 1, attemptedAt: -1 })

module.exports = mongoose.model('TestResult', TestResultSchema)
