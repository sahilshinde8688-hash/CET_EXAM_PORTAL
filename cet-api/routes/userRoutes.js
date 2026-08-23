const express  = require('express')
const router   = express.Router()
const axios    = require('axios')
const User     = require('../models/User')
const { protect, adminOnly } = require('../middleware/auth')
const { apiLimiter } = require('../middleware/rateLimit')

// Generate unique MHT-CET ID: MHC-YYYY-NNNNN
const generateMhcetId = async () => {
  const year = new Date().getFullYear()
  const count = await User.countDocuments({ mhcetId: { $exists: true } })
  const num = String(count + 1).padStart(5, '0')
  return `MHC-${year}-${num}`
}

// Generate random password: 8 chars
const generatePassword = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#$'
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

// GET /api/users/me
router.get('/me', protect, apiLimiter, (req, res) => res.json(req.user))

// PUT /api/users/profile
router.put('/profile', protect, apiLimiter, async (req, res) => {
  try {
    const { name, email, phone, branch, batch } = req.body
    
    const user = await User.findById(req.user._id)
    if (!user) return res.status(404).json({ message: 'User not found' })

    // Check if email is being changed and if it's already taken
    if (email && email !== user.email) {
      const emailExists = await User.findOne({ email, _id: { $ne: user._id } })
      if (emailExists) return res.status(400).json({ message: 'Email already in use' })
      user.email = email
    }

    // Check if phone is being changed and if it's already taken
    if (phone && phone !== user.phone) {
      const phoneExists = await User.findOne({ phone, _id: { $ne: user._id } })
      if (phoneExists) return res.status(400).json({ message: 'Phone number already in use' })
      user.phone = phone
    }

    if (name) user.name = name
    if (branch) user.branch = branch
    if (batch) user.batch = Number(batch)

    await user.save()

    res.json({
      message: 'Profile updated successfully',
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        branch: user.branch,
        batch: user.batch,
        role: user.role,
        status: user.status,
        mhcetId: user.mhcetId,
        photo: user.photo,
        createdAt: user.createdAt,
      }
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/users — admin: all students with status filter
router.get('/', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    const { status } = req.query
    const filter = { role: 'student' }
    if (status) filter.status = status
    const users = await User.find(filter).select('-password').sort({ createdAt: -1 })
    res.json(users)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/users/reset-password — student resets provisional password
router.post('/reset-password', protect, apiLimiter, async (req, res) => {
  try {
    const { newPassword } = req.body
    if (!newPassword || newPassword.length < 6)
      return res.status(400).json({ message: 'Password must be at least 6 characters' })

    const user = await User.findById(req.user._id)
    if (!user) return res.status(404).json({ message: 'User not found' })

    if (!user.mustResetPassword)
      return res.status(400).json({ message: 'Password reset is not required' })

    user.password = newPassword
    user.mhcetPassword = newPassword
    user.mustResetPassword = false
    await user.save()

    res.json({ message: 'Password reset successful', user: { _id: user._id, name: user.name, email: user.email } })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/users/stats — admin dashboard stats
router.get('/stats', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    const total    = await User.countDocuments({ role: 'student' })
    const pending  = await User.countDocuments({ role: 'student', status: 'pending' })
    const approved = await User.countDocuments({ role: 'student', status: 'approved' })
    const rejected = await User.countDocuments({ role: 'student', status: 'rejected' })
    res.json({ total, pending, approved, rejected })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/users/:id/approve — admin approves student
router.post('/:id/approve', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user) return res.status(404).json({ message: 'User not found' })
    if (user.status === 'approved') return res.status(400).json({ message: 'Already approved' })

    // Generate credentials
    const mhcetId  = await generateMhcetId()
    const mhcetPwd = generatePassword()

    // Use updateOne to bypass validation on fields we're not changing
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          status:            'approved',
          mhcetId:           mhcetId,
          mhcetPassword:     mhcetPwd,
          mustResetPassword: true,
          approvedAt:        new Date(),
        }
      }
    )

    let emailWarning = ''
    try {
      const emailPayload = {
        name:      user.name,
        email:     user.email,
        branch:    user.branch || 'N/A',
        mhcetId:   mhcetId,
        password:  mhcetPwd,
      }
      console.log('📧 Sending email payload:', emailPayload)
      const emailRes = await axios.post(
        `${process.env.EMAIL_SERVICE_URL || 'http://localhost:8000'}/send-approval`,
        emailPayload
      )
      console.log(`✅ Approval email sent to ${user.email}`)
    } catch (emailErr) {
      console.error('⚠️ Email service error:', emailErr.response?.data || emailErr.message)
      emailWarning = ' (Warning: Email service unreachable. Email not sent.)'
    }

    res.json({
      message:  `Student approved. MHT-CET ID: ${mhcetId}${emailWarning}`,
      mhcetId,
      user: { _id: user._id, name: user.name, email: user.email, status: 'approved' },
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/users/:id/resend-credentials — admin resends credentials email
router.post('/:id/resend-credentials', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user) return res.status(404).json({ message: 'User not found' })
    if (user.status !== 'approved' || !user.mhcetId) {
      return res.status(400).json({ message: 'User is not approved yet' })
    }

    try {
      const emailPayload = {
        name:      user.name,
        email:     user.email,
        branch:    user.branch || 'N/A',
        mhcetId:   user.mhcetId,
        password:  user.mhcetPassword,
      }
      await axios.post(
        `${process.env.EMAIL_SERVICE_URL || 'http://localhost:8000'}/send-approval`,
        emailPayload
      )
      res.json({ message: `Credentials successfully resent to ${user.email}` })
    } catch (emailErr) {
      console.error('⚠️ Email service error:', emailErr.response?.data || emailErr.message)
      res.status(500).json({ message: 'Failed to send email. The email service might be offline.' })
    }
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/users/:id/reject — admin rejects student
router.post('/:id/reject', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    const { reason } = req.body
    const user = await User.findById(req.params.id)
    if (!user) return res.status(404).json({ message: 'User not found' })

    const rejectionReason = reason || 'Application did not meet requirements'

    // Notify student via email before deleting
    try {
      await axios.post(`${process.env.EMAIL_SERVICE_URL || 'http://localhost:8000'}/send-rejection`, {
        name:   user.name,
        email:  user.email,
        reason: rejectionReason,
      })
    } catch (emailErr) {
      console.error('⚠️ Email service error:', emailErr.message)
    }

    // Delete the user from the database
    await User.findByIdAndDelete(req.params.id)

    res.json({ message: 'Student rejected and deleted', user: { _id: user._id, name: user.name, status: 'rejected' } })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// DELETE /api/users/:id — admin deletes a student and cascades to test results
router.delete('/:id', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user) return res.status(404).json({ message: 'User not found' })

    // Remove related test results manually to avoid orphaned records
    const TestResult = require('../models/TestResult')
    await TestResult.deleteMany({ userId: user._id })

    await User.findByIdAndDelete(req.params.id)
    res.json({ message: 'User deleted', userId: user._id })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router