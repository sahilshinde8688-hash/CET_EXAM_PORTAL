const jwt = require('jsonwebtoken')
const User = require('../models/User')

const protect = async (req, res, next) => {
  let token = req.cookies?.accessToken

  if (!token && req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1]
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authenticated. Please log in again.' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    if (decoded.type !== 'access') {
      return res.status(401).json({ message: 'Invalid token type.' })
    }

    const user = await User.findById(decoded.id).select('-password -mhcetPassword')
    if (!user) {
      return res.status(401).json({ message: 'User no longer exists.' })
    }

    req.user = user
    req.sessionId = decoded.sessionId
    return next()
  } catch (error) {
    return res.status(401).json({ message: 'Session expired or invalid.' })
  }
}

const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') return next()
  return res.status(403).json({ message: 'Admin access only' })
}

module.exports = { protect, adminOnly }
