const test = require('node:test')
const assert = require('node:assert/strict')
const {
  resultEmail,
  parentResultEmail,
  welcomeEmail,
  passwordChangedEmail,
} = require('../services/emailTemplates')

test('result template escapes untrusted labels and reports saved score metrics', () => {
  const email = resultEmail({
    studentName: '<img src=x onerror=alert(1)>',
    testName: 'Mock <script>alert(1)</script>',
    result: {
      score: 14,
      totalMarks: 20,
      percentile: 70,
      correct: 7,
      incorrect: 2,
      unanswered: 1,
      duration: 90,
      attemptedAt: '2026-10-11T09:00:00.000Z',
      answers: { confidential: 'must not appear in email' },
    },
    reportUrl: 'https://example.test/results',
  })

  assert.match(email.htmlContent, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.doesNotMatch(email.htmlContent, /<script>|<img src=x/)
  assert.match(email.htmlContent, /70\.0%/)
  assert.match(email.textContent, /Accuracy: 77\.8%/)
  assert.doesNotMatch(email.htmlContent, /must not appear in email/)
  assert.match(email.htmlContent, /https:\/\/example\.test\/results/)
})

test('parent, welcome, and password notifications include secure setup and report links only', () => {
  const parent = parentResultEmail({
    studentName: 'Aarav',
    testName: 'CET Practice',
    result: { score: 8, totalMarks: 10, percentile: 80 },
    reportUrl: 'https://api.example.test/api/email/parent-report/secure-token',
  })

  test('initial welcome email includes the temporary password and forces a password change', () => {
    const welcome = welcomeEmail({
      studentName: 'Aarav',
      username: 'MHC-2026-00001',
      loginUrl: 'https://cetnova.example.test/login',
      temporaryPassword: 'safe-temp-password-123',
    })

    assert.match(welcome.htmlContent, /safe-temp-password-123/)
    assert.match(welcome.textContent, /Temporary password: safe-temp-password-123/)
    assert.match(welcome.textContent, /must change this password immediately after your first sign-in/i)
    assert.doesNotMatch(welcome.htmlContent, /setup_token/)
  })
  const welcome = welcomeEmail({
    studentName: 'Aarav',
    username: 'MHC-2026-00001',
    loginUrl: 'https://cetnova.example.test/login',
    setupUrl: 'https://cetnova.example.test/login?setup_token=one-time-token',
  })
  const password = passwordChangedEmail({ studentName: 'Aarav', loginUrl: 'https://cetnova.example.test/login' })

  assert.match(parent.htmlContent, /secure-token/)
  assert.match(parent.textContent, /80\.0%/)
  assert.match(welcome.htmlContent, /MHC-2026-00001/)
  assert.match(welcome.textContent, /one-time-token/)
  assert.doesNotMatch(welcome.htmlContent, /password is .* /i)
  assert.match(password.textContent, /password .* was changed/i)
  assert.doesNotMatch(password.textContent, /new password/i)
})
