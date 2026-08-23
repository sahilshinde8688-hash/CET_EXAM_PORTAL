const mongoose = require('mongoose')

const questionSchema = new mongoose.Schema({
  subject: { type: String, required: true },
  chapter: { type: String, default: '' },
  topic: { type: String, required: true },
  subTopic: { type: String, default: '' },
  text: { type: String, required: true },
  imageUrl: { type: String, default: '' },
  options: [{ type: String, required: true }],
  correctIndex: { type: Number, required: true },
  solution: { type: String, default: '' },
  marks: { type: Number, default: 2 },
  negativeMarks: { type: Number, default: 0.5 },
  difficulty: { type: String, enum: ['Easy', 'Medium', 'Hard'], default: 'Medium' },
  isActive: { type: Boolean, default: true }
}, { timestamps: true })

module.exports = mongoose.model('Question', questionSchema)