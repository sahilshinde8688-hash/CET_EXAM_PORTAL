const mongoose = require('mongoose')
const bcrypt   = require('bcryptjs')

const UserSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  email:       { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone:       { type: String, trim: true },  // optional for admin
  password:    { type: String, minlength: 6 },
  branch:      { type: String, enum: ['Byculla', 'Worli', 'Prabhadevi'], required: true },
  batch:       { type: Number, required: true },
  role:        { type: String, enum: ['student', 'admin'], default: 'student' },
  status:      { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  mhcetId:     { type: String, unique: true, sparse: true },
  mhcetPassword: { type: String },
  photo:       { type: String },  // Cloudinary URL
  approvedAt:         { type: Date },
  rejectedAt:         { type: Date },
  rejectionReason:    { type: String },
  mustResetPassword:  { type: Boolean, default: false },
}, { timestamps: true })

// Hash password before save
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next()
  this.password = await bcrypt.hash(this.password, 10)
  next()
})

// Compare password
UserSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false;
  return await bcrypt.compare(enteredPassword, this.password)
}

// Cascade delete: remove test results when user is deleted
UserSchema.pre('findOneAndDelete', async function (next) {
  try {
    const query = this.getQuery()
    const userId = query._id
    if (userId) {
      const TestResult = mongoose.model('TestResult')
      const ObjectId = mongoose.Types.ObjectId
      const targetId = typeof userId === 'string' ? new ObjectId(userId) : userId
      await TestResult.deleteMany({ userId: targetId })
    }
    next()
  } catch (err) {
    next(err)
  }
})

module.exports = mongoose.model('User', UserSchema)
