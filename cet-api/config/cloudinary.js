const cloudinary = require('cloudinary').v2
const multer = require('multer')
const path = require('path')

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

const isConfigured = (value) => {
  if (!value) return false
  return !/^your_|^your-/i.test(value.trim())
}

const storage = multer.memoryStorage()

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp']

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype) || !ALLOWED_EXTENSIONS.includes(ext)) {
      return cb(new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.'))
    }
    cb(null, true)
  },
})

/**
 * Upload a buffer to Cloudinary
 */
const uploadToCloudinary = (buffer, folder = 'cet-students', publicId = undefined) => {
  return new Promise((resolve, reject) => {
    if (!isConfigured(process.env.CLOUDINARY_CLOUD_NAME) || !isConfigured(process.env.CLOUDINARY_API_KEY) || !isConfigured(process.env.CLOUDINARY_API_SECRET)) {
      // In local dev without Cloudinary, return fallback data URI
      const base64 = buffer.toString('base64')
      return resolve({
        secure_url: `data:image/jpeg;base64,${base64}`,
        public_id: publicId || `mock_${Date.now()}`,
      })
    }

    const options = {
      folder,
      resource_type: 'image',
      overwrite: true,
    }
    if (process.env.CLOUDINARY_UPLOAD_PRESET) {
      options.upload_preset = process.env.CLOUDINARY_UPLOAD_PRESET
    }
    if (publicId) options.public_id = publicId

    cloudinary.uploader
      .upload_stream(options, (error, result) => {
        if (error) return reject(error)
        resolve(result)
      })
      .end(buffer)
  })
}

const deleteFromCloudinary = (publicId) => {
  if (!isConfigured(process.env.CLOUDINARY_CLOUD_NAME) || !isConfigured(process.env.CLOUDINARY_API_KEY) || !isConfigured(process.env.CLOUDINARY_API_SECRET)) return Promise.resolve()
  return cloudinary.uploader.destroy(publicId)
}

module.exports = { cloudinary, upload, uploadToCloudinary, deleteFromCloudinary }
