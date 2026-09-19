const express = require('express')
const router = express.Router()
const axios = require('axios')
const bcrypt = require('bcryptjs')
const db = require('../services/dbService')
const { protect, adminOnly } = require('../middleware/auth')
const { apiLimiter, passwordResetLimiter } = require('../middleware/rateLimit')
const { validateCsrfToken } = require('../middleware/csrf')

// Generate unique MHT-CET ID: MHC-YYYY-NNNNN
const generateMhcetId = async () => {
  const year = new Date().getFullYear()
  const users = await db.getAllUsers()
  const count = users.filter((u) => Boolean(u.mhcetId)).length
  const num = String(count + 1).padStart(5, '0')
  return `MHC-${year}-${num}`
}

// Generate secure random temporary password (8 characters)
const generatePassword = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#$'
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

// GET /api/users/me — Profile of logged in user
router.get('/me', protect, apiLimiter, (req, res) => {
  const user = { ...req.user }
  delete user.password
  delete user.mhcetPassword
  res.json(user)
})

// PUT /api/users/profile — Update user profile
router.put('/profile', protect, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    const { name, email, phone, branch, batch } = req.body
    const userId = req.user.id || req.user._id

    const user = await db.findUserById(userId)
    if (!user) return res.status(404).json({ success: false, message: 'User not found' })

    const updates = {}

    if (email && email.toLowerCase() !== user.email.toLowerCase()) {
      const cleanEmail = email.toLowerCase().trim()
      const emailUser = await db.findUserByEmail(cleanEmail)
      if (emailUser && emailUser.id !== user.id) {
        return res.status(400).json({ success: false, message: 'Email already in use' })
      }
      updates.email = cleanEmail
    }

    if (phone && phone !== user.phone) {
      const cleanPhone = String(phone).trim()
      const allUsers = await db.getAllUsers()
      const phoneUser = allUsers.find((u) => u.phone === cleanPhone && u.id !== user.id)
      if (phoneUser) return res.status(400).json({ success: false, message: 'Phone number already in use' })
      updates.phone = cleanPhone
    }

    if (name) updates.name = String(name).trim().slice(0, 100)
    if (branch && ['Byculla', 'Worli', 'Prabhadevi'].includes(branch)) updates.branch = branch
    if (batch) updates.batch = Number(batch)

    const updatedUser = await db.updateUser(user.id, updates)
    delete updatedUser.password
    delete updatedUser.mhcetPassword

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: updatedUser,
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// GET /api/users — ADMIN ONLY: list students
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
    res.status(500).json({ success: false, message: err.message })
  }
})

// POST /api/users/reset-password — Student resets password
router.post('/reset-password', protect, validateCsrfToken, passwordResetLimiter, async (req, res) => {
  try {
    const { newPassword } = req.body
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' })
    }

    const userId = req.user.id || req.user._id
    const user = await db.findUserById(userId)
    if (!user) return res.status(404).json({ success: false, message: 'User not found' })

    const hashedPassword = await bcrypt.hash(String(newPassword), 10)
    const updatedUser = await db.updateUser(userId, {
      password: hashedPassword,
      mhcetPassword: null,
      mustResetPassword: false,
    })

    delete updatedUser.password
    delete updatedUser.mhcetPassword

    res.json({
      success: true,
      message: 'Password reset successful',
      user: updatedUser,
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// GET /api/users/stats — ADMIN ONLY: dashboard stats
router.get('/stats', protect, adminOnly, apiLimiter, async (req, res) => {
  try {
    const students = await db.getAllUsers({ role: 'student' })
    const total = students.length
    const pending = students.filter((s) => s.status === 'pending').length
    const approved = students.filter((s) => s.status === 'approved').length
    const rejected = students.filter((s) => s.status === 'rejected').length

    res.json({ total, pending, approved, rejected })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// POST /api/users/:id/approve — ADMIN ONLY: approve student
router.post('/:id/approve', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    const user = await db.findUserById(req.params.id)
    if (!user) return res.status(404).json({ success: false, message: 'User not found' })
    if (user.status === 'approved') return res.status(400).json({ success: false, message: 'Already approved' })

    const mhcetId = await generateMhcetId()
    const mhcetPwd = generatePassword()
    const hashedPassword = await bcrypt.hash(mhcetPwd, 10)

    const updatedUser = await db.updateUser(user.id, {
      status: 'approved',
      mhcetId,
      password: hashedPassword,
      mhcetPassword: mhcetPwd,
      mustResetPassword: true,
      approvedAt: new Date().toISOString(),
    })

    const sanitizedUser = { ...updatedUser }
    delete sanitizedUser.password
    // Do not delete mhcetPassword so the admin UI can receive and display it

    let emailWarning = ''
    try {
      const emailPayload = {
        name: user.name,
        email: user.email,
        branch: user.branch || 'N/A',
        mhcetId: mhcetId,
        password: mhcetPwd, // Dispatched once via email, not persisted in DB
      }
      await axios.post(
        `${process.env.EMAIL_SERVICE_URL || 'http://localhost:8000'}/send-approval`,
        emailPayload,
        { timeout: 5000 }
      )
    } catch (emailErr) {
      console.warn('⚠️ External email notification notice:', emailErr.message)
      emailWarning = ' (Note: Email service unreachable. Notify student with temporary password if needed.)'
    }

    res.json({
      success: true,
      message: `Student approved. MHT-CET ID: ${mhcetId}${emailWarning}`,
      mhcetId,
      user: sanitizedUser,
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// POST /api/users/:id/resend-credentials — ADMIN ONLY: issue new credentials & email
router.post('/:id/resend-credentials', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    const user = await db.findUserById(req.params.id)
    if (!user) return res.status(404).json({ success: false, message: 'User not found' })
    if (user.status !== 'approved' || !user.mhcetId) {
      return res.status(400).json({ success: false, message: 'User is not approved yet' })
    }

    const newTempPassword = generatePassword()
    const hashedPassword = await bcrypt.hash(newTempPassword, 10)

    const updatedUser = await db.updateUser(user.id, {
      password: hashedPassword,
      mhcetPassword: newTempPassword,
      mustResetPassword: true,
    })

    try {
      const emailPayload = {
        name: user.name,
        email: user.email,
        branch: user.branch || 'N/A',
        mhcetId: user.mhcetId,
        password: newTempPassword,
      }
      await axios.post(
        `${process.env.EMAIL_SERVICE_URL || 'http://localhost:8000'}/send-approval`,
        emailPayload,
        { timeout: 5000 }
      )
      res.json({ success: true, message: `New credentials sent to ${user.email}`, password: newTempPassword })
    } catch (emailErr) {
      console.error('⚠️ Email service error:', emailErr.message)
      res.status(500).json({ success: false, message: 'Failed to send email. The email service is unreachable.' })
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// POST /api/users/:id/reject — ADMIN ONLY: reject student
router.post('/:id/reject', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    const { reason } = req.body
    const user = await db.findUserById(req.params.id)
    if (!user) return res.status(404).json({ success: false, message: 'User not found' })

    const rejectionReason = reason || 'Application did not meet requirements'

    try {
      await axios.post(
        `${process.env.EMAIL_SERVICE_URL || 'http://localhost:8000'}/send-rejection`,
        {
          name: user.name,
          email: user.email,
          reason: rejectionReason,
        },
        { timeout: 5000 }
      )
    } catch (emailErr) {
      console.warn('⚠️ Email rejection notification notice:', emailErr.message)
    }

    await db.deleteUser(req.params.id)

    res.json({ success: true, message: 'Student rejected and removed.' })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// POST /api/users/bulk-approve — ADMIN ONLY: approve multiple students
router.post('/bulk-approve', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    const { ids } = req.body
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'No student IDs provided' })
    }

    const results = []
    for (const id of ids) {
      try {
        const user = await db.findUserById(id)
        if (!user || user.status === 'approved') continue

        const mhcetId = await generateMhcetId()
        const mhcetPwd = generatePassword()
        const hashedPassword = await bcrypt.hash(mhcetPwd, 10)

        const updatedUser = await db.updateUser(user.id, {
          status: 'approved',
          mhcetId,
          password: hashedPassword,
          mhcetPassword: mhcetPwd,
          mustResetPassword: true,
          approvedAt: new Date().toISOString(),
        })

        const sanitized = { ...updatedUser }
        delete sanitized.password

        try {
          await axios.post(
            `${process.env.EMAIL_SERVICE_URL || 'http://localhost:8000'}/send-approval`,
            {
              name: user.name,
              email: user.email,
              branch: user.branch || 'N/A',
              mhcetId,
              password: mhcetPwd,
            },
            { timeout: 3000 }
          )
        } catch {}

        results.push(sanitized)
      } catch (innerErr) {
        console.error(`Error approving user ${id}:`, innerErr.message)
      }
    }

    res.json({
      success: true,
      count: results.length,
      message: `Successfully approved ${results.length} student(s).`,
      users: results,
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// POST /api/users/bulk-reject — ADMIN ONLY: reject multiple students
router.post('/bulk-reject', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    const { ids, reason } = req.body
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'No student IDs provided' })
    }

    let count = 0
    for (const id of ids) {
      try {
        const user = await db.findUserById(id)
        if (!user) continue

        try {
          await axios.post(
            `${process.env.EMAIL_SERVICE_URL || 'http://localhost:8000'}/send-rejection`,
            {
              name: user.name,
              email: user.email,
              reason: reason || 'Application did not meet requirements',
            },
            { timeout: 3000 }
          )
        } catch {}

        await db.deleteUser(id)
        count++
      } catch (innerErr) {
        console.error(`Error rejecting user ${id}:`, innerErr.message)
      }
    }

    res.json({
      success: true,
      count,
      message: `Successfully rejected ${count} applicant(s).`,
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// GET /api/users/export — ADMIN ONLY: Export students to Excel (.xlsx) batch-wise
router.get('/export', protect, adminOnly, async (req, res) => {
  try {
    const XLSX = require('xlsx')
    const { batch, status } = req.query
    const filter = { role: 'student' }
    if (status && status !== 'All') filter.status = status
    if (batch && batch !== 'All') filter.batch = Number(batch)

    const students = await db.getAllUsers(filter)

    const formatRow = (s) => ({
      'Name of the student': s.name || '',
      'Email ID': s.email || '',
      'Student Unique No.': s.mhcetId || s.id || 'Pending',
      'Username': s.mhcetId || s.email || '',
      'Password': s.mhcetPassword || (s.status === 'pending' ? 'Pending Approval' : '••••••••'),
      'Batch': s.batch ? `Batch ${s.batch}` : 'N/A',
      'Branch': s.branch || 'N/A',
      'Phone Number': s.phone || 'N/A',
      'Status': s.status ? (s.status.charAt(0).toUpperCase() + s.status.slice(1)) : 'Pending',
      'Registered Date': s.createdAt ? new Date(s.createdAt).toLocaleDateString('en-IN') : 'N/A',
    })

    const wb = XLSX.utils.book_new()
    const rows = students.map(formatRow)
    const wsAll = XLSX.utils.json_to_sheet(rows)

    const colWidths = [
      { wch: 25 }, // Name
      { wch: 28 }, // Email
      { wch: 20 }, // Student Unique No.
      { wch: 20 }, // Username
      { wch: 18 }, // Password
      { wch: 14 }, // Batch
      { wch: 16 }, // Branch
      { wch: 16 }, // Phone
      { wch: 14 }, // Status
      { wch: 16 }, // Date
    ]
    wsAll['!cols'] = colWidths
    XLSX.utils.book_append_sheet(wb, wsAll, 'All Students')

    // Add separate tabs for each batch
    const distinctBatches = [...new Set(students.map((s) => s.batch).filter(Boolean))].sort()
    distinctBatches.forEach((b) => {
      const batchStudents = students.filter((s) => s.batch === b)
      if (batchStudents.length > 0) {
        const wsBatch = XLSX.utils.json_to_sheet(batchStudents.map(formatRow))
        wsBatch['!cols'] = colWidths
        XLSX.utils.book_append_sheet(wb, wsBatch, `Batch ${b}`)
      }
    })

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const filename = `Students_Export_${batch ? `Batch_${batch}` : 'All_Batches'}_${new Date().toISOString().slice(0, 10)}.xlsx`

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.send(buffer)
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// PUT /api/users/:id — ADMIN ONLY: update any student details
router.put('/:id', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    const { name, email, phone, branch, batch, status } = req.body
    const user = await db.findUserById(req.params.id)
    if (!user) return res.status(404).json({ success: false, message: 'User not found' })

    const updates = {}
    if (name) updates.name = String(name).trim().slice(0, 100)
    if (email) updates.email = String(email).trim().toLowerCase()
    if (phone) updates.phone = String(phone).trim()
    if (branch) updates.branch = branch
    if (batch) updates.batch = Number(batch)
    if (status) updates.status = status

    const updatedUser = await db.updateUser(req.params.id, updates)
    delete updatedUser.password

    res.json({
      success: true,
      message: 'Student updated successfully',
      user: updatedUser,
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// DELETE /api/users/:id — ADMIN ONLY: delete student
router.delete('/:id', protect, adminOnly, validateCsrfToken, apiLimiter, async (req, res) => {
  try {
    const user = await db.findUserById(req.params.id)
    if (!user) return res.status(404).json({ success: false, message: 'User not found' })

    await db.deleteUser(req.params.id)
    res.json({ success: true, message: 'User deleted' })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router