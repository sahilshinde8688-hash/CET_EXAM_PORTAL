const cloudinary = require('cloudinary').v2
const multer     = require('multer')

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

// Memory storage — stream buffer directly to Cloudinary
const storage = multer.memoryStorage()
const upload  = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Only image files allowed'))
  },
})

/**
 * Upload a buffer to Cloudinary
 */
const uploadToCloudinary = (buffer, folder = 'cet-students', publicId = undefined) => {
  return new Promise((resolve, reject) => {
    const options = {
      folder,
      resource_type: 'image',
      overwrite: true,
      upload_preset: process.env.CLOUDINARY_UPLOAD_PRESET,
    }
    if (publicId) options.public_id = publicId

    cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error)
      resolve(result)
    }).end(buffer)
  })
}

const deleteFromCloudinary = (publicId) =>
  cloudinary.uploader.destroy(publicId)

module.exports = { cloudinary, upload, uploadToCloudinary, deleteFromCloudinary }
