# Secure Authentication System Documentation

## Overview

This authentication system uses the React frontend, Node.js/Express API, and Supabase Postgres. JWTs are held in HttpOnly cookies and checked against server-side session records; browser storage is not proof of authentication.

## Architecture

### Backend (Node.js + Express)
- **JWT-based authentication** with short-lived access tokens (up to 15 minutes)
- **Refresh tokens** with secure HTTP-only cookies bound to a revocable server-side session
- **Session tracking** with device info, IP address, last activity, and inactivity validation
- **CSRF protection** using double-submit cookie pattern
- **Rate limiting** to prevent brute-force attacks
- **Security headers** via Helmet.js

### Frontend (React + TypeScript)
- **Automatic token refresh** when access tokens expire
- **CSRF token injection** for all state-changing requests
- **Server-verified session restoration** on app load, navigation, browser history, and tab visibility
- **Redirect guards** that wait for the API session check before rendering protected pages

## Security Features

### 1. Cookie Security
```javascript
// Authentication cookies use these flags:
{
  httpOnly: true,      // Prevents XSS attacks
  secure: production,  // HTTPS only in production
  sameSite: production ? 'none' : 'lax', // Cross-origin production frontend/API
  path: '/',          // Available across entire app
}
```

**Access Token**: up to 15 minutes; active users transparently refresh it.
**Refresh Token**: has no independent fixed JWT lifetime; it is bound to a persisted, revocable session and can only be used while that session remains active.
**Session**: expires after the configured period of inactivity, 30 minutes by default. The server validates the persisted `last_activity` timestamp on protected requests. Administrators can change the inactivity timeout from Security settings (1–1440 minutes); `SESSION_INACTIVITY_TIMEOUT_MINUTES` supplies the server fallback.
**CSRF Token**: separate from authentication; readable by JavaScript for the double-submit header and rolled with the session cookies.

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

- **Bcrypt hashing**; administrator passwords use 12 salt rounds
- **Administrator passwords** must be at least 12 characters and include uppercase, lowercase, a number, and a symbol (maximum 72 UTF-8 bytes)
- **Student passwords** retain the existing minimum-length policy
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
  createdAt: "2024-01-01T00:00:00Z",
  lastActivity: "2024-01-01T00:00:00Z",
  expiresAt: "2024-01-01T00:30:00Z", // Inactivity deadline; extended as activity is recorded
  mfa_verified: true, // Required for administrator sessions
  revokedAt: null
}
```

**Features:**
- Expiration only after the configured period without recorded activity
- Persisted activity timestamp is authoritative; refreshing or navigating does not reset the session
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

**Refresh Token (bound to the persisted session):**
```javascript
{
  id: "userId",
  sessionId: "sessionUUID",
  type: "refresh",
  jti: "uniqueTokenId",
  iat: 1234567890,
  exp: 1234567890 + 7200
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
- SameSite=Lax in development; SameSite=None with Secure in cross-origin production
- Double-submit CSRF token pattern
- CSRF token validation on all state-changing requests
- Constant-time token comparison (prevents timing attacks)

### Session Fixation
✅ **Protected by:**
- New session ID created on every login
- Refresh tokens remain bound to their original session ID and server-side inactivity deadline
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

**Supabase tables:**
- `users` - User records
- `sessions` - Server-validated session lifetime and revocation state
- `refresh_tokens` - Hashed refresh-token records
- `login_history` - Authentication audit logging

**Utils:**
- `utils/authHelpers.js` - Token signing, cookie management, hashing

### Frontend Files

**API Layer:**
- `src/lib/api.ts` - All API calls with automatic CSRF and token refresh

**Components:**
- `src/components/SignIn.tsx` - Login/Register component
- `src/App.tsx` - Route guards and session restoration

**Session Management:**
- `GET /api/auth/session` validates the HttpOnly cookie and returns the user plus `expiresAt`.
- `session.get()` reads display data only; it never grants access.
- `session.save(user)` caches display data after server verification.
- `session.clear()` removes the cached user on logout or expiry.

## Usage Examples

### Login Flow

1. User submits login form
2. Frontend reads CSRF token from cookie
3. Frontend sends POST to `/api/auth/login` with CSRF token in header
4. Backend validates CSRF token
5. Backend verifies credentials
6. The backend issues a short-lived MFA challenge instead of a session for every account. First-time setup requires a TOTP code from the authenticator before enrollment is saved; subsequent logins require a current TOTP or unused backup code.
7. After MFA succeeds, backend creates:
   - Session record
   - Refresh token record
   - Access token (JWT)
   - Refresh token (JWT)
8. Backend sets three cookies:
  - `accessToken` (HttpOnly, up to 15 minutes)
  - `refreshToken` (HttpOnly, rolled forward with active use)
  - `csrfToken` (readable by JavaScript, rolled forward with the session cookies)
9. Frontend saves display-only user information to localStorage
10. Frontend redirects to dashboard

### Session Check and Refresh Flow

1. User makes API request with expired access token
2. Backend returns 401 Unauthorized
3. Frontend calls `/api/auth/refresh` once with the refresh cookie
4. Backend validates the JWT, refresh-token record, and persisted inactivity deadline
5. Backend records activity and rolls the session deadline and cookies forward
6. Frontend retries the original request once
7. If the inactivity deadline has passed, backend revokes the session and returns `401` with `code: SESSION_EXPIRED`; the client clears auth state and redirects to `/login`

The frontend tracks meaningful interaction locally and periodically sends a throttled activity heartbeat. Near the inactivity deadline it displays a warning with a **Stay Signed In** action. These client timers are only a user-experience aid; protected API requests and refreshes are validated against server-persisted activity.

### Logout Flow

1. User clicks logout
2. Frontend reads CSRF token
3. Frontend sends POST to `/api/auth/logout` with CSRF token
4. Backend validates CSRF token
5. Backend marks the session and refresh token as revoked in the database
6. Backend clears all cookies
7. Frontend clears only authentication-related local state (exam progress is preserved)
8. Frontend redirects to login page

## TOTP MFA setup, deployment, and recovery

All student and administrator accounts require MFA; there is no self-service MFA-disable endpoint. TOTP uses RFC 6238, compatible with Google Authenticator and Microsoft Authenticator. The TOTP secret is encrypted with AES-256-GCM in the database, and backup codes are stored as hashes.

### Apply and configure

1. Back up the Supabase database. Apply [`supabase/migrations/20261125_admin_totp_mfa.sql`](./supabase/migrations/20261125_admin_totp_mfa.sql) and [`supabase/migrations/20261126000000_allow_student_totp_mfa.sql`](./supabase/migrations/20261126000000_allow_student_totp_mfa.sql) in order, or use the project's normal Supabase migration workflow (`supabase db push`). Apply them before deploying/restarting the API; do not run migrations against production without the usual review and backup.
2. Set `ADMIN_TOTP_ENCRYPTION_KEY` in the API's secret manager. Generate a base64-encoded 32-byte key with:
   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   Keep this key stable and backed up separately from the database. Changing or losing it makes existing TOTP secrets undecryptable. Never commit the key or put it in a frontend `VITE_` variable. The API refuses to start in production without it.
3. Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `FRONTEND_URL`, and `NODE_ENV=production` in the backend environment. Do not copy real credentials into `.env.example`.
4. Install backend dependencies from `cet-api` with `npm install`, then deploy the latest API to Render. A Vercel frontend deployment alone does not update the API that issues login challenges. Existing student sessions will be revoked after MFA enforcement is deployed, so students must sign in again and enroll an authenticator.
5. If there are no admin accounts, create the first one from the repository root with `node scripts/createSuperAdmin.js`. The script prompts for the email and a strong password; it does not print the password. It refuses to create a duplicate admin. Existing administrator accounts can sign in with their existing password once; a legacy plaintext password is migrated to bcrypt on successful login, and weak admin passwords must be changed before continuing.
6. On the first login for each student or administrator account, scan the displayed QR code in Google Authenticator or Microsoft Authenticator. If scanning is unavailable, enter the manual key shown during this authenticated setup step. Enter the generated six-digit code to confirm enrollment, then store the displayed one-time backup codes offline in a secure place.
7. Later logins for every account require the six-digit authenticator code. A single-use backup code can be entered instead if the phone is unavailable. Administrators can rotate their backup codes from the Security settings page after confirming their current password and a fresh second factor.

The setup QR/manual key is returned only to the password-authenticated, short-lived MFA challenge and is held temporarily in the login page while setup is pending. It is not included in regular user/session responses or stored in browser local storage. Do not share screenshots of the QR code or manual key.

### HTTPS and operational safeguards

Serve the site and API only over HTTPS in production. Set `NODE_ENV=production` so authentication cookies use the secure flag, configure the exact frontend origin in CORS, and use a strong unique `JWT_SECRET`. Keep the Supabase service-role key and TOTP encryption key server-side. Production deployments should configure Redis (`REDIS_URL`) so IP rate limits are shared across API instances; MFA failures are additionally tracked in the database with a five-failure, 15-minute account lockout.

Sessions are only issued after MFA, regenerated after successful authentication, stored server-side with MFA verification state, and protected by the existing CSRF checks and inactivity timeout. Logout revokes the persisted session. The administrator Security settings page supports password changes, backup-code rotation, revoking other sessions, and viewing recent login/security events.

### Lost authenticator recovery

- If the phone is lost but a backup code is available, sign in with the code and contact an administrator to reset MFA before enrolling a replacement authenticator.
- If both the phone and every backup code are unavailable, there is no application-level bypass. A trusted administrator must verify the account owner's identity and perform a documented, audited recovery using the Supabase service-role/SQL access: revoke all that user's active sessions and refresh tokens, delete their pending MFA challenges, clear the encrypted TOTP secret and backup-code hashes, and set `totp_enabled` to `false` for that specific user row. The next password login will require fresh MFA enrollment. Do not expose this operation through an unauthenticated route or execute it based only on an email request. Back up and review the database before making the change.

## Environment Variables Required

```env
# Server (.env)
NODE_ENV=production|development
PORT=5000
SESSION_INACTIVITY_TIMEOUT_MINUTES=30
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=server-only-secret
FRONTEND_URL=https://your-frontend-domain.com
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
- [ ] Session expires at the absolute configured lifetime (default 2 hours)
- [ ] An expired session returns `401` with `code: SESSION_EXPIRED`
- [ ] Old sessions created before deployment are capped from their server creation time
- [ ] Access token auto-refreshes before expiry

**Security:**
- [ ] Cookies are HttpOnly (check DevTools)
- [ ] Cookies have Secure flag in production
- [ ] Cookies have the configured SameSite policy (`None` + `Secure` for cross-origin production)
- [ ] CSRF token is present in cookies
- [ ] CSRF token is sent in headers for POST/PUT/DELETE
- [ ] Rate limiting works (5 failed logins = blocked)
- [ ] Security headers are present (check Response Headers)

**Logout:**
- [ ] User can logout
- [ ] Cookies are cleared
- [ ] Authentication-related local state is cleared without deleting exam progress
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

**Issue**: Session expired message appears after returning to the app
**Solution**: The session expires after the configured inactivity timeout. If the user was continuously active, verify the activity heartbeat and protected API requests are reaching the API server.

**Issue**: Rate limit too strict in development
**Solution**: Add `?skipRateLimit=true` to URLs or adjust limits in `rateLimit.js`.

**Issue**: CORS errors
**Solution**: Add the exact frontend origin (including `https://` and no trailing slash) to `CLIENT_URL` or the comma-separated `CORS_ORIGINS` env variable on the API host, then redeploy/restart the API.

## Production Deployment Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use strong `JWT_SECRET` (minimum 32 characters, random)
- [ ] Enable HTTPS (Secure cookies require it)
- [ ] Set `FRONTEND_URL` to production frontend URL
- [ ] Set `SESSION_INACTIVITY_TIMEOUT_MINUTES` (default: `30` minutes) or configure the value in Admin → Security
- [ ] Configure Redis for distributed rate limiting
- [ ] Set up Supabase service-role access only on the API server
- [ ] Enable CSP in production mode
- [ ] Remove `'unsafe-inline'` and `'unsafe-eval'` from CSP if possible
- [ ] Configure proper log rotation
- [ ] Set up monitoring for failed login attempts
- [ ] Implement IP blocking for repeated attacks
- [ ] Regular security audits

## Performance Considerations

- **JWT verification**: Followed by a database session lookup on every protected request
- **Refresh token lookup**: Database query (indexed by token hash)
- **Session lookup**: Database query (indexed by sessionId)
- **Rate limiting**: In-memory (single server) or Redis (multi-server)
- **CSRF tokens**: Signed stateless values with a bounded lifetime

## Maintenance

**Regular Tasks:**
- Monitor login history for suspicious activity
- Review and clean up expired sessions and refresh-token records
- Rotate JWT_SECRET periodically (requires all users to re-login)
- Update dependencies regularly (especially security-related)

**Scaling:**
- Move CSRF token storage to Redis for multi-server setups
- Use Redis for rate limiting across multiple instances
- Consider session clustering for large user bases

## Security Best Practices Implemented

1. ✅ Never store passwords in cookies or localStorage
2. ✅ Use HttpOnly cookies for tokens
3. ✅ Enforce absolute token/session expiry and revoke on logout
4. ✅ Validate all user input
5. ✅ Use parameterized Supabase queries
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