/**
 * CSRF Protection Middleware (Disabled / Pass-through)
 */

const generateCsrfToken = (req, res, next) => {
  req.csrfToken = 'disabled'
  res.setHeader('X-CSRF-Token', 'disabled')
  next()
}

const validateCsrfToken = (req, res, next) => {
  // Pass-through: do not block any requests
  next()
}

const createCsrfToken = () => 'disabled'
const verifyCsrfToken = () => true

module.exports = {
  generateCsrfToken,
  validateCsrfToken,
  createCsrfToken,
  verifyCsrfToken,
}
