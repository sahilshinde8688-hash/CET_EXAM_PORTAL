const express = require('express')
const router = express.Router()
const axios = require('axios')
const bcrypt = require('bcryptjs')
const db = require('../services/dbService')
const { protect, adminOnly } = require('../middleware/auth')
const { apiLimiter } = require('../middleware/rateLimit')

// Generate unique MHT-CET ID: MHC-YYYY-NNNNN
const generateMhcetId = async () => {
  const year = new Date().getFullYear()
  const users = await db.getAllUsers()
  const count = users.filter((u) => Boolean(u.mhcetId)).length
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

    const user = await db.findUserById(req.user.id || req.user._id)
    if (!user) return res.status(404).json({ message: 'User not found' })

    const updates = {}

    if (email && email !== user.email) {
      const emailUser = await db.findUserByEmail(email)
      if (emailUser && emailUser.id !== user.id) {
        return res.status(400).json({ message: 'Email already in use' })
      }
      updates.email = email
    }

    if (phone && phone !== user.phone) {
      const allUsers = await db.getAllUsers()
      const phoneUser = allUsers.find((u) => u.phone === phone && u.id !== user.id)
      if (phoneUser) return res.status(400).json({ message: 'Phone number already in use' })
      updates.phone = phone
    }

    if (name) updates.name = name
    if (branch) updates.branch = branch
    if (batch) updates.batch = Number(batch)

    const updatedUser = await db.updateUser(user.id, updates)

    res.json({
      message: 'Profile updated successfully',
      user: {
        _id: updatedUser.id,
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        branch: updatedUser.branch,
        batch: updatedUser.batch,
        role: updatedUser.role,
        status: updatedUser.status,
        mhcetId: updatedUser.mhcetId,
        photo: updatedUser.photo,
        createdAt: updatedUser.createdAt,
      },
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
    const users = await db.getAllUsers(filter)
    const sanitizedUsers = users.map((u) => {
      const userObj = { ...u, _id: u.id }
      delete userObj.password
      return userObj
    })
    res.json(sanitizedUsers)
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

    const userId = req.user.id || req.user._id
    const user = await db.findUserById(userId)
    if (!user) return res.status(404).json({ message: 'User not found' })

    if (!user.mustResetPassword)
      return res.status(400).json({ message: 'Password reset is not required' })

    const hashedPassword = await bcrypt.hash(newPassword, 10)
    const updatedUser = await db.updateUser(userId, {
      password: hashedPassword,
      mhcetPassword: newPassword,
      mustResetPassword: false,
    })

    res.json({
      message: 'Password reset successful',
      user: { _id: updatedUser.id, id: updatedUser.id, name: updatedUser.name, email: updatedUser.email },
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/users/stats — admin dashboard stats
router.get('/stats', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    const students = await db.getAllUsers({ role: 'student' })
    const total = students.length
    const pending = students.filter((s) => s.status === 'pending').length
    const approved = students.filter((s) => s.status === 'approved').length
    const rejected = students.filter((s) => s.status === 'rejected').length

    res.json({ total, pending, approved, rejected })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/users/:id/approve — admin approves student
router.post('/:id/approve', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    const user = await db.findUserById(req.params.id)
    if (!user) return res.status(404).json({ message: 'User not found' })
    if (user.status === 'approved') return res.status(400).json({ message: 'Already approved' })

    const mhcetId = await generateMhcetId()
    const mhcetPwd = generatePassword()

    const updatedUser = await db.updateUser(user.id, {
      status: 'approved',
      mhcetId,
      mhcetPassword: mhcetPwd,
      mustResetPassword: true,
      approvedAt: new Date().toISOString(),
    })

    let emailWarning = ''
    try {
      const emailPayload = {
        name: user.name,
        email: user.email,
        branch: user.branch || 'N/A',
        mhcetId: mhcetId,
        password: mhcetPwd,
      }
      console.log('📧 Sending email payload:', emailPayload)
      await axios.post(
        `${process.env.EMAIL_SERVICE_URL || 'http://localhost:8000'}/send-approval`,
        emailPayload
      )
      console.log(`✅ Approval email sent to ${user.email}`)
    } catch (emailErr) {
      console.error('⚠️ Email service error:', emailErr.response?.data || emailErr.message)
      emailWarning = ' (Warning: Email service unreachable. Email not sent.)'
    }

    res.json({
      message: `Student approved. MHT-CET ID: ${mhcetId}${emailWarning}`,
      mhcetId,
      user: { _id: updatedUser.id, id: updatedUser.id, name: updatedUser.name, email: updatedUser.email, status: 'approved' },
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/users/:id/resend-credentials — admin resends credentials email
router.post('/:id/resend-credentials', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    const user = await db.findUserById(req.params.id)
    if (!user) return res.status(404).json({ message: 'User not found' })
    if (user.status !== 'approved' || !user.mhcetId) {
      return res.status(400).json({ message: 'User is not approved yet' })
    }

    try {
      const emailPayload = {
        name: user.name,
        email: user.email,
        branch: user.branch || 'N/A',
        mhcetId: user.mhcetId,
        password: user.mhcetPassword,
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
    const user = await db.findUserById(req.params.id)
    if (!user) return res.status(404).json({ message: 'User not found' })

    const rejectionReason = reason || 'Application did not meet requirements'

    try {
      await axios.post(`${process.env.EMAIL_SERVICE_URL || 'http://localhost:8000'}/send-rejection`, {
        name: user.name,
        email: user.email,
        reason: rejectionReason,
      })
    } catch (emailErr) {
      console.error('⚠️ Email service error:', emailErr.message)
    }

    await db.deleteUser(req.params.id)

    res.json({ message: 'Student rejected and deleted', user: { _id: user.id, id: user.id, name: user.name, status: 'rejected' } })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// DELETE /api/users/:id — admin deletes a student
router.delete('/:id', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    const user = await db.findUserById(req.params.id)
    if (!user) return res.status(404).json({ message: 'User not found' })

    await db.deleteUser(req.params.id)
    res.json({ message: 'User deleted', userId: user.id })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router