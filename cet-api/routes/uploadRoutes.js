const express  = require('express')
const router   = express.Router()
const { upload, uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary')
const User     = require('../models/User')
const { protect } = require('../middleware/auth')
const { uploadLimiter } = require('../middleware/rateLimit')

// POST /api/upload/profile — upload student profile photo
router.post('/profile', protect, uploadLimiter, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No image file provided' })

    // Upload to Cloudinary under cet-students folder
    const result = await uploadToCloudinary(
      req.file.buffer,
      'cet-students',
      `student_${req.user._id}`  // consistent public ID per student
    )

    // Save URL to user's photo field
    await User.updateOne(
      { _id: req.user._id },
      { $set: { photo: result.secure_url } }
    )

    res.json({
      message:  'Profile photo updated',
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

    const student = await User.findById(req.params.id)
    if (!student) return res.status(404).json({ message: 'Student not found' })

    // Delete old photo from Cloudinary if exists
    if (student.photo) {
      const oldPublicId = `cet-students/student_${req.params.id}`
      await deleteFromCloudinary(oldPublicId).catch(() => {})
    }

    const result = await uploadToCloudinary(
      req.file.buffer,
      'cet-students',
      `student_${req.params.id}`
    )

    await User.updateOne(
      { _id: req.params.id },
      { $set: { photo: result.secure_url } }
    )

    res.json({
      message:  'Student photo updated',
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
