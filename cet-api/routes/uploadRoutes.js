const express = require('express')
const router = express.Router()
const { upload, uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary')
const db = require('../services/dbService')
const { protect } = require('../middleware/auth')
const { uploadLimiter } = require('../middleware/rateLimit')

// POST /api/upload/profile — upload student profile photo
router.post('/profile', protect, uploadLimiter, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No image file provided' })

    const userId = req.user.id || req.user._id

    const result = await uploadToCloudinary(
      req.file.buffer,
      'cet-students',
      `student_${userId}`
    )

    await db.updateUser(userId, { photo: result.secure_url })

    res.json({
      message: 'Profile photo updated',
      photoUrl: result.secure_url,
      publicId: result.public_id,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/upload/admin/student/:id — admin uploads photo for a student
router.post('/admin/student/:id', protect, uploadLimiter, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No image file provided' })

    const student = await db.findUserById(req.params.id)
    if (!student) return res.status(404).json({ message: 'Student not found' })

    if (student.photo) {
      const oldPublicId = `cet-students/student_${req.params.id}`
      await deleteFromCloudinary(oldPublicId).catch(() => {})
    }

    const result = await uploadToCloudinary(
      req.file.buffer,
      'cet-students',
      `student_${req.params.id}`
    )

    await db.updateUser(req.params.id, { photo: result.secure_url })

    res.json({
      message: 'Student photo updated',
      photoUrl: result.secure_url,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/upload/question — admin uploads a question image
router.post('/question', protect, uploadLimiter, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No image file provided' })

    const result = await uploadToCloudinary(
      req.file.buffer,
      'cet-questions',
      `question_${Date.now()}`
    )

    res.json({
      message: 'Question image uploaded',
      imageUrl: result.secure_url,
      publicId: result.public_id,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router
