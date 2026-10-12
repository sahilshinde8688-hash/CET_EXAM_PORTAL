const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character]))

const formatDuration = seconds => {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value < 0) return 'Not recorded'
  const minutes = Math.floor(value / 60)
  const remainingSeconds = Math.floor(value % 60)
  return `${minutes}m ${remainingSeconds}s`
}

const layout = (title, content) => `<!doctype html>
<html lang="en">
  <head><meta name="viewport" content="width=device-width, initial-scale=1"><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
  <body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#172033">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 12px">
      <tr><td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden">
          <tr><td style="padding:24px 32px;background:#102a56;color:#fff">
            <div style="font-size:22px;font-weight:700;letter-spacing:.3px">CETNova</div>
            <div style="margin-top:5px;color:#cbdaf2;font-size:13px">Prepare smarter. Perform better.</div>
          </td></tr>
          <tr><td style="padding:28px 32px">${content}</td></tr>
          <tr><td style="padding:18px 32px;background:#f8fafc;color:#64748b;font-size:12px;line-height:1.6">
            This is an automated message from CETNova. If you need help, contact your institution's support team.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`

const button = (label, url) => `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">${escapeHtml(label)}</a></p>`

const resultEmail = ({ studentName, testName, result, reportUrl }) => {
  const total = Number(result.totalMarks) || 0
  const score = Number(result.score) || 0
  const savedPercentage = Number(result.percentile)
  const percentage = result.percentile !== null && result.percentile !== undefined && Number.isFinite(savedPercentage)
    ? savedPercentage
    : total > 0 ? (score / total) * 100 : 0
  const attempted = (Number(result.correct) || 0) + (Number(result.incorrect) || 0)
  const accuracy = attempted > 0 ? (Number(result.correct) / attempted) * 100 : 0
  const submitted = result.attemptedAt
    ? new Date(result.attemptedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })
    : 'Not recorded'
  const content = `<h1 style="margin:0 0 12px;font-size:24px">Your exam result is ready</h1>
    <p style="line-height:1.6">Hello ${escapeHtml(studentName)}, your <strong>${escapeHtml(testName)}</strong> result has been finalized.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;background:#f8fafc;border-radius:10px">
      <tr><td style="padding:18px 20px"><div style="color:#64748b;font-size:13px">MARKS OBTAINED</div><div style="margin-top:6px;font-size:28px;font-weight:700;color:#1d4ed8">${escapeHtml(score)} / ${escapeHtml(total)}</div></td>
      <td style="padding:18px 20px"><div style="color:#64748b;font-size:13px">PERCENTAGE</div><div style="margin-top:6px;font-size:28px;font-weight:700">${percentage.toFixed(1)}%</div></td></tr>
    </table>
    <p style="line-height:1.8"><strong>Submitted:</strong> ${escapeHtml(submitted)}<br>
    <strong>Correct:</strong> ${escapeHtml(result.correct ?? 0)} &nbsp; <strong>Incorrect:</strong> ${escapeHtml(result.incorrect ?? 0)} &nbsp; <strong>Unanswered:</strong> ${escapeHtml(result.unanswered ?? 0)}<br>
    <strong>Accuracy:</strong> ${accuracy.toFixed(1)}% &nbsp; <strong>Time taken:</strong> ${escapeHtml(formatDuration(result.duration))}</p>
    <p style="line-height:1.6">Review your report card and spend time understanding any questions you missed. Consistent review helps turn every practice test into progress.</p>
    ${button('View your report card', reportUrl)}`
  const text = `Hello ${studentName},\n\nYour ${testName} result is ready.\nMarks: ${score}/${total}\nPercentage: ${percentage.toFixed(1)}%\nCorrect: ${result.correct ?? 0}; incorrect: ${result.incorrect ?? 0}; unanswered: ${result.unanswered ?? 0}\nAccuracy: ${accuracy.toFixed(1)}%\nTime taken: ${formatDuration(result.duration)}\nSubmitted: ${submitted}\n\nReview incorrect answers in your report card: ${reportUrl}\n\nCETNova`
  return { subject: `Your ${testName} result is ready`, htmlContent: layout('Exam result', content), textContent: text }
}

const parentResultEmail = ({ studentName, testName, result, reportUrl }) => {
  const total = Number(result.totalMarks) || 0
  const score = Number(result.score) || 0
  const savedPercentage = Number(result.percentile)
  const percentage = result.percentile !== null && result.percentile !== undefined && Number.isFinite(savedPercentage)
    ? savedPercentage
    : total > 0 ? (score / total) * 100 : 0
  const content = `<h1 style="margin:0 0 12px;font-size:24px">A CETNova practice result is available</h1>
    <p style="line-height:1.6">A result for <strong>${escapeHtml(studentName)}</strong> is ready for <strong>${escapeHtml(testName)}</strong>.</p>
    <div style="margin:20px 0;padding:18px;background:#f8fafc;border-radius:10px">
      <div style="color:#64748b;font-size:13px">SCORE</div>
      <div style="margin-top:6px;font-size:26px;font-weight:700;color:#1d4ed8">${escapeHtml(score)} / ${escapeHtml(total)} (${percentage.toFixed(1)}%)</div>
    </div>
    <p style="line-height:1.6">Encourage ${escapeHtml(studentName)} to review the report and use any missed questions as a guide for further practice.</p>
    ${button('View secure report', reportUrl)}
    <p style="color:#64748b;font-size:12px;line-height:1.5">This private link expires in seven days. Please do not forward it.</p>`
  const text = `A CETNova practice result for ${studentName} is ready.\nTest: ${testName}\nScore: ${score}/${total} (${percentage.toFixed(1)}%)\nView the secure report (expires in seven days): ${reportUrl}\n\nCETNova`
  return { subject: `CETNova result update for ${studentName}`, htmlContent: layout('Student result update', content), textContent: text }
}

const welcomeEmail = ({ studentName, username, loginUrl, setupUrl, temporaryPassword }) => {
  if (temporaryPassword) {
    const content = `<h1 style="margin:0 0 12px;font-size:24px">Welcome to CETNova, ${escapeHtml(studentName)}!</h1>
      <p style="line-height:1.6">Your student account is ready. Sign in with your username <strong>${escapeHtml(username)}</strong> and this temporary password:</p>
      <p style="margin:20px 0;padding:16px;background:#f1f5f9;border-radius:8px;font-family:monospace;font-size:18px;word-break:break-all"><strong>${escapeHtml(temporaryPassword)}</strong></p>
      ${button('Sign in to CETNova', loginUrl)}
      <p style="line-height:1.6"><strong>You must change this password immediately after your first sign-in.</strong> Do not share it. If you did not expect this account, contact your institution's support team.</p>`
    const text = `Welcome to CETNova, ${studentName}!\nUsername: ${username}\nTemporary password: ${temporaryPassword}\nSign in: ${loginUrl}\nYou must change this password immediately after your first sign-in. Do not share it.`
    return { subject: 'Welcome to CETNova — your temporary password', htmlContent: layout('Welcome to CETNova', content), textContent: text }
  }

  const content = `<h1 style="margin:0 0 12px;font-size:24px">Welcome to CETNova, ${escapeHtml(studentName)}!</h1>
    <p style="line-height:1.6">Your student account is ready. Your username is <strong>${escapeHtml(username)}</strong>.</p>
    <p style="line-height:1.6">Choose a private password using the secure, single-use setup link below. This link expires in 24 hours.</p>
    ${button('Set up your password', setupUrl)}
    <p style="line-height:1.6">After setup, sign in at <a href="${escapeHtml(loginUrl)}" style="color:#2563eb">${escapeHtml(loginUrl)}</a>. If the link has expired, ask your administrator to resend the setup email. Contact your institution's support team if you need help.</p>`
  const text = `Welcome to CETNova, ${studentName}!\nUsername: ${username}\nSet your password using this single-use link (expires in 24 hours): ${setupUrl}\nLogin: ${loginUrl}\nIf the link expires, ask your administrator to resend the setup email.`
  return { subject: 'Welcome to CETNova — set up your account', htmlContent: layout('Welcome to CETNova', content), textContent: text }
}

const passwordChangedEmail = ({ studentName, loginUrl }) => {
  const content = `<h1 style="margin:0 0 12px;font-size:24px">Your password was changed</h1>
    <p style="line-height:1.6">Hello ${escapeHtml(studentName)}, this is a security notice confirming that the password for your CETNova account was changed.</p>
    <p style="line-height:1.6">If you did not make this change, contact your institution's support team immediately.</p>
    ${button('Go to CETNova sign in', loginUrl)}`
  const text = `Hello ${studentName}, the password for your CETNova account was changed. If you did not make this change, contact your institution's support team immediately. Sign in: ${loginUrl}`
  return { subject: 'CETNova account password changed', htmlContent: layout('Password changed', content), textContent: text }
}

module.exports = { escapeHtml, resultEmail, parentResultEmail, welcomeEmail, passwordChangedEmail }
