# Secure Authentication System Documentation

## Overview

This authentication system implements industry-standard security practices for a React + Node.js/Express + MongoDB application. It provides secure session management with JWT tokens, refresh tokens, and comprehensive protection against common web vulnerabilities.

## Architecture

### Backend (Node.js + Express)
- **JWT-based authentication** with short-lived access tokens (15 minutes)
- **Refresh token rotation** with secure HTTP-only cookies
- **Session tracking** with device info and IP address logging
- **CSRF protection** using double-submit cookie pattern
- **Rate limiting** to prevent brute-force attacks
- **Security headers** via Helmet.js

### Frontend (React + TypeScript)
- **Automatic token refresh** when access tokens expire
- **CSRF token injection** for all state-changing requests
- **Session persistence** with automatic restoration on app load
- **Redirect guards** for authenticated/unauthenticated users

## Security Features

### 1. Cookie Security
```javascript
// All auth cookies use these flags:
{
  httpOnly: true,      // Prevents XSS attacks
  secure: production,  // HTTPS only in production
  sameSite: 'lax',     // CSRF protection
  path: '/',          // Available across entire app
}
```

**Access Token**: 15-minute expiry, stored in HttpOnly cookie
**Refresh Token**: 7 days (30 days if "Remember me" checked), stored in HttpOnly cookie
**CSRF Token**: 24-hour expiry, NOT HttpOnly (JavaScript needs to read it)

### 2. CSRF Protection

**How it works:**
1. Server generates CSRF token and sets it in a cookie on every request
2. Frontend reads the cookie and includes it in `X-CSRF-Token` header for state-changing requests (POST, PUT, PATCH, DELETE)
3. Server validates the token matches between cookie and header using constant-time comparison

**Frontend Implementation:**
```typescript
const getCsrfToken = (): string | null => {
  const match = document.cookie.match(/(?:^|; )csrfToken=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : null
}

// Automatically added to state-changing requests
const csrfToken = getCsrfToken()
headers['X-CSRF-Token'] = csrfToken
```

### 3. Rate Limiting

**Limits:**
- **Login**: 5 attempts per 15 minutes (per IP + email)
- **Registration**: 3 attempts per hour
- **Password Reset**: 3 attempts per hour
- **Token Refresh**: 10 attempts per 5 minutes
- **General API**: 100 requests per 15 minutes (authenticated users)

### 4. Security Headers

Implemented via Helmet.js:
- Content Security Policy (CSP)
- X-Frame-Options (clickjacking protection)
- X-Content-Type-Options (MIME sniffing protection)
- Strict-Transport-Security (HTTPS enforcement)
- Cross-Origin policies
- And more...

### 5. Password Security

- **Bcrypt hashing** with 10 salt rounds
- **Minimum 6 characters** enforced
- **Passwords never stored in cookies** (only session IDs/JWT)
- **Separate password field** for MHT-CET provisional credentials

### 6. Session Management

**Session Structure:**
```javascript
{
  sessionId: "UUID",
  userId: "ObjectId",
  deviceName: "Chrome on Windows",
  browser: "Chrome 120",
  operatingSystem: "Windows 11",
  ipAddress: "192.168.1.1",
  country: "India",
  loginAt: "2024-01-01T00:00:00Z",
  lastActivity: "2024-01-01T00:00:00Z",
  expiresAt: "2024-01-01T00:30:00Z", // 30 minutes
  revokedAt: null
}
```

**Features:**
- Automatic expiration after 30 minutes of inactivity
- Device tracking for security monitoring
- Login history for audit trails
- Support for multiple concurrent sessions

### 7. JWT Token Structure

**Access Token (15 minutes):**
```javascript
{
  id: "userId",
  sessionId: "sessionUUID",
  type: "access",
  iat: 1234567890,
  exp: 1234567890 + 900
}
```

**Refresh Token (7/30 days):**
```javascript
{
  id: "userId",
  sessionId: "sessionUUID",
  type: "refresh",
  jti: "uniqueTokenId",
  iat: 1234567890,
  exp: 1234567890 + (7 * 24 * 60 * 60)
}
```

## Attack Protection

### XSS (Cross-Site Scripting)
✅ **Protected by:**
- HttpOnly cookies (JavaScript can't access tokens)
- Content Security Policy headers
- Input sanitization
- React's built-in XSS protection

### CSRF (Cross-Site Request Forgery)
✅ **Protected by:**
- SameSite=Lax cookies
- Double-submit CSRF token pattern
- CSRF token validation on all state-changing requests
- Constant-time token comparison (prevents timing attacks)

### Session Fixation
✅ **Protected by:**
- New session ID created on every login
- New session ID created on every token refresh
- Session IDs are UUIDs (unpredictable)

### Brute-Force Attacks
✅ **Protected by:**
- Rate limiting on login endpoint
- Login attempt tracking per IP + email
- Account lockout after too many failed attempts (via rate limiter)

### Credential Stuffing
✅ **Protected by:**
- Rate limiting per IP and email
- Login history tracking
- Device/IP monitoring

## Implementation Details

### Backend Files

**Middleware:**
- `middleware/auth.js` - Authentication and authorization
- `middleware/csrf.js` - CSRF token generation and validation
- `middleware/rateLimit.js` - Rate limiting
- `middleware/securityHeaders.js` - Security headers and CORS

**Routes:**
- `routes/authRoutes.js` - Login, logout, register, refresh, me

**Models:**
- `models/User.js` - User schema with password hashing
- `models/Session.js` - Session tracking
- `models/RefreshToken.js` - Refresh token storage
- `models/LoginHistory.js` - Audit logging

**Utils:**
- `utils/authHelpers.js` - Token signing, cookie management, hashing

### Frontend Files

**API Layer:**
- `src/lib/api.ts` - All API calls with automatic CSRF and token refresh

**Components:**
- `src/components/SignIn.tsx` - Login/Register component
- `src/App.tsx` - Route guards and session restoration

**Session Management:**
- `session.get()` - Retrieve stored user from localStorage
- `session.save(user)` - Persist user data
- `session.clear()` - Clear on logout

## Usage Examples

### Login Flow

1. User submits login form
2. Frontend reads CSRF token from cookie
3. Frontend sends POST to `/api/auth/login` with CSRF token in header
4. Backend validates CSRF token
5. Backend verifies credentials
6. Backend creates:
   - Session record
   - Refresh token record
   - Access token (JWT)
   - Refresh token (JWT)
7. Backend sets three cookies:
   - `accessToken` (HttpOnly, 15min)
   - `refreshToken` (HttpOnly, 7/30 days)
   - `csrfToken` (Not HttpOnly, 24 hours)
8. Frontend saves user to localStorage
9. Frontend redirects to dashboard

### Token Refresh Flow

1. User makes API request with expired access token
2. Backend returns 401 Unauthorized
3. Frontend calls `/api/auth/refresh` with refresh token
4. Backend validates refresh token
5. Backend creates new access token
6. Backend sets new `accessToken` cookie
7. Frontend retries original request with new token
8. If refresh fails, user is redirected to login

### Logout Flow

1. User clicks logout
2. Frontend reads CSRF token
3. Frontend sends POST to `/api/auth/logout` with CSRF token
4. Backend validates CSRF token
5. Backend marks refresh token as revoked in database
6. Backend clears all cookies
7. Frontend clears localStorage
8. Frontend redirects to login page

## Environment Variables Required

```env
# Server (.env)
NODE_ENV=production|development
PORT=5000
MONGO_URI=mongodb://localhost:27017/cet-portal
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
CLIENT_URL=https://your-frontend-domain.com
# Optional: comma-separated list of additional frontend origins
CORS_ORIGINS=https://your-frontend-domain.com,https://preview.example.com

# Optional (for production scaling)
REDIS_URL=redis://localhost:6379  # For distributed rate limiting
```

## Testing the Implementation

### Manual Testing Checklist

**Authentication:**
- [ ] User can register
- [ ] User can login with email/password
- [ ] User can login with MHT-CET ID
- [ ] Pending users see appropriate message
- [ ] Rejected users see appropriate message

**Session Management:**
- [ ] User is redirected to dashboard after login
- [ ] User is redirected to login if not authenticated
- [ ] Session persists on page refresh
- [ ] Session expires after 30 minutes inactivity
- [ ] Access token auto-refreshes before expiry

**Security:**
- [ ] Cookies are HttpOnly (check DevTools)
- [ ] Cookies have Secure flag in production
- [ ] Cookies have SameSite=Lax
- [ ] CSRF token is present in cookies
- [ ] CSRF token is sent in headers for POST/PUT/DELETE
- [ ] Rate limiting works (5 failed logins = blocked)
- [ ] Security headers are present (check Response Headers)

**Logout:**
- [ ] User can logout
- [ ] Cookies are cleared
- [ ] localStorage is cleared
- [ ] User is redirected to login
- [ ] User cannot access protected routes after logout

**Protected Routes:**
- [ ] Unauthenticated users redirected to login
- [ ] Authenticated users can access dashboard
- [ ] Admin routes require admin role
- [ ] 401 errors redirect to login

## Common Issues and Solutions

**Issue**: CSRF token missing errors
**Solution**: Ensure frontend reads cookie before making requests. Add small delay if needed.

**Issue**: Token refresh loop
**Solution**: Check that refresh endpoint returns valid tokens and cookies are being set.

**Issue**: Rate limit too strict in development
**Solution**: Add `?skipRateLimit=true` to URLs or adjust limits in `rateLimit.js`.

**Issue**: CORS errors
**Solution**: Add the exact frontend origin (including `https://` and no trailing slash) to `CLIENT_URL` or the comma-separated `CORS_ORIGINS` env variable on the API host, then redeploy/restart the API.

## Production Deployment Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use strong `JWT_SECRET` (minimum 32 characters, random)
- [ ] Enable HTTPS (Secure cookies require it)
- [ ] Set `CLIENT_URL` to production frontend URL
- [ ] Configure Redis for distributed rate limiting
- [ ] Set up MongoDB with authentication
- [ ] Enable CSP in production mode
- [ ] Remove `'unsafe-inline'` and `'unsafe-eval'` from CSP if possible
- [ ] Configure proper log rotation
- [ ] Set up monitoring for failed login attempts
- [ ] Implement IP blocking for repeated attacks
- [ ] Regular security audits

## Performance Considerations

- **JWT verification**: Fast, no database lookup needed
- **Refresh token lookup**: Database query (indexed by tokenHash)
- **Session lookup**: Database query (indexed by sessionId)
- **Rate limiting**: In-memory (single server) or Redis (multi-server)
- **CSRF tokens**: In-memory with hourly cleanup

## Maintenance

**Regular Tasks:**
- Monitor login history for suspicious activity
- Review and clean up expired sessions (TTL index handles this)
- Rotate JWT_SECRET periodically (requires all users to re-login)
- Update dependencies regularly (especially security-related)

**Scaling:**
- Move CSRF token storage to Redis for multi-server setups
- Use Redis for rate limiting across multiple instances
- Consider session clustering for large user bases

## Security Best Practices Implemented

1. ✅ Never store passwords in cookies or localStorage
2. ✅ Use HttpOnly cookies for tokens
3. ✅ Implement token expiration and rotation
4. ✅ Validate all user input
5. ✅ Use parameterized queries (Mongoose)
6. ✅ Implement rate limiting
7. ✅ Log security events
8. ✅ Use HTTPS in production
9. ✅ Implement CSRF protection
10. ✅ Set security headers
11. ✅ Hash passwords with bcrypt
12. ✅ Use strong JWT secrets
13. ✅ Implement session expiration
14. ✅ Track device information
15. ✅ Provide logout functionality

## Additional Notes

- **Session Fixation Prevention**: New session created on each login
- **Token Binding**: JWT tokens bound to session ID for extra security
- **Device Tracking**: Monitor concurrent sessions from different devices
- **Audit Logging**: All authentication events logged with IP and user agent
- **Graceful Degradation**: App works even if CSRF token generation fails

---

**Author**: Secure Authentication System  
**Version**: 1.0  
**Last Updated**: 2024