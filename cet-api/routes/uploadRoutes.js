const express = require('express')
const router = express.Router()
const { upload, uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary')
const db = require('../services/dbService')
const { protect, adminOnly } = require('../middleware/auth')
const { uploadLimiter } = require('../middleware/rateLimit')
const { validateCsrfToken } = require('../middleware/csrf')

const handleUploadError = (err, req, res, next) => {
  if (err) {
    return res.status(400).json({ success: false, message: err.message || 'File upload error.' })
  }
  next()
}

// POST /api/upload/profile — Student uploads their own profile photo
router.post(
  '/profile',
  protect,
  validateCsrfToken,
  uploadLimiter,
  upload.single('image'),
  handleUploadError,
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, message: 'No image file provided' })

      const userId = req.user.id || req.user._id

      const user = await db.findUserById(userId)
      if (!user) return res.status(404).json({ success: false, message: 'User not found' })

      if (user.photo) {
        await deleteFromCloudinary(`cet-students/student_${userId}`).catch(() => {})
      }

      const result = await uploadToCloudinary(req.file.buffer, 'cet-students', `student_${userId}`)

      await db.updateUser(userId, { photo: result.secure_url })

      res.json({
        success: true,
        message: 'Profile photo updated',
        photoUrl: result.secure_url,
        publicId: result.public_id,
      })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message })
    }
  }
)

// DELETE /api/upload/profile - Remove the logged-in user's profile photo
router.delete(
  '/profile',
  protect,
  validateCsrfToken,
  uploadLimiter,
  async (req, res) => {
    try {
      const userId = req.user.id || req.user._id
      const user = await db.findUserById(userId)
      if (!user) return res.status(404).json({ success: false, message: 'User not found' })

      if (user.photo) {
        await deleteFromCloudinary(`cet-students/student_${userId}`).catch(() => {})
      }

      await db.updateUser(userId, { photo: null })
      res.json({ success: true, message: 'Profile photo removed' })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message })
    }
  }
)

// POST /api/upload/admin/student/:id — ADMIN ONLY: admin uploads photo for student
router.post(
  '/admin/student/:id',
  protect,
  adminOnly,
  validateCsrfToken,
  uploadLimiter,
  upload.single('image'),
  handleUploadError,
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, message: 'No image file provided' })

      const student = await db.findUserById(req.params.id)
      if (!student) return res.status(404).json({ success: false, message: 'Student not found' })

      if (student.photo) {
        const oldPublicId = `cet-students/student_${req.params.id}`
        await deleteFromCloudinary(oldPublicId).catch(() => {})
      }

      const result = await uploadToCloudinary(req.file.buffer, 'cet-students', `student_${req.params.id}`)

      await db.updateUser(req.params.id, { photo: result.secure_url })

      res.json({
        success: true,
        message: 'Student photo updated',
        photoUrl: result.secure_url,
      })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message })
    }
  }
)

// POST /api/upload/question — ADMIN ONLY: admin uploads question image
router.post(
  '/question',
  protect,
  adminOnly,
  validateCsrfToken,
  uploadLimiter,
  upload.single('image'),
  handleUploadError,
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, message: 'No image file provided' })

      const result = await uploadToCloudinary(req.file.buffer, 'cet-questions', `question_${Date.now()}`)

      res.json({
        success: true,
        message: 'Question image uploaded',
        imageUrl: result.secure_url,
        publicId: result.public_id,
      })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message })
    }
  }
)

module.exports = router
