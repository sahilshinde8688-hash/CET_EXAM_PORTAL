// Export and Download Utilities for CET Prep Pro

import { TestResult, Question } from './api'

/**
 * Downloads a CSV file with the student's full mock test history
 */
export function downloadTestHistoryCSV(history: TestResult[], candidateName = 'Student') {
  if (!history || history.length === 0) {
    alert('No test history available to download.')
    return
  }

  const headers = [
    'Test Name',
    'Subject',
    'Date',
    'Time',
    'Score',
    'Total Marks',
    'Percentage (%)',
    'Percentile',
    'Correct',
    'Incorrect',
    'Unanswered',
    'Duration (min)',
  ]

  const rows = history.map(t => {
    const d = new Date(t.attemptedAt)
    const dateStr = d.toLocaleDateString()
    const timeStr = d.toLocaleTimeString()
    const score = Number(t.score) || 0
    const totalMarks = Number(t.totalMarks) || 100
    const pct = totalMarks > 0 ? ((score / totalMarks) * 100).toFixed(1) : '0.0'
    const durationMin = Math.round((Number(t.duration) || 0) / 60)

    return [
      `"${(t.testName || 'Mock Test').replace(/"/g, '""')}"`,
      `"${(t.subject || 'General').replace(/"/g, '""')}"`,
      `"${dateStr}"`,
      `"${timeStr}"`,
      score,
      totalMarks,
      pct,
      t.percentile ? Number(t.percentile).toFixed(1) : '0.0',
      t.correct ?? 0,
      t.incorrect ?? 0,
      t.unanswered ?? 0,
      durationMin,
    ].join(',')
  })

  const csvContent = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', `CET_Prep_Pro_Results_${candidateName.replace(/\s+/g, '_')}_${Date.now()}.csv`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Generates an official printable PDF report window for a single test result
 */
export function downloadSingleTestReport(
  test: Partial<TestResult> & {
    candidateName?: string
    rollNumber?: string
    percentage?: number
    timeTaken?: string
  }
) {
  const printWindow = window.open('', '_blank', 'width=850,height=900')
  if (!printWindow) {
    window.print()
    return
  }

  const score = Number(test.score) || 0
  const maxScore = Number(test.totalMarks) || 100
  const pct = test.percentage !== undefined ? test.percentage.toFixed(1) : maxScore > 0 ? ((score / maxScore) * 100).toFixed(1) : '0.0'
  const dateStr = test.attemptedAt ? new Date(test.attemptedAt).toLocaleDateString() : new Date().toLocaleDateString()

  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>${test.testName || 'Test Report'} - Official Scorecard</title>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; padding: 40px; margin: 0; background: #fff; line-height: 1.5; }
    .header { border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-end; }
    .brand { font-size: 24px; font-weight: 800; color: #2563eb; }
    .subhead { color: #64748b; font-size: 13px; }
    .score-card { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 12px; padding: 24px; margin-bottom: 24px; text-align: center; }
    .score-val { font-size: 48px; font-weight: 800; color: #2563eb; margin: 8px 0; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
    .stat-box { border: 1px solid #e2e8f0; padding: 14px; border-radius: 8px; text-align: center; }
    .stat-label { font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600; }
    .stat-value { font-size: 20px; font-weight: 700; margin-top: 4px; }
    .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 16px; font-size: 12px; color: #94a3b8; text-align: center; }
    @media print { body { padding: 20px; } button { display: none; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">CET PREP PRO</div>
      <div class="subhead">MHT-CET Entrance Examination Platform</div>
    </div>
    <div style="text-align: right;">
      <div style="font-weight: 600;">Official Examination Scorecard</div>
      <div class="subhead">Date: ${dateStr}</div>
    </div>
  </div>

  <h2>${test.testName || 'MHT-CET Mock Examination'}</h2>
  <p>Candidate: <b>${test.candidateName || 'Student'}</b> ${test.rollNumber ? `• Roll: ${test.rollNumber}` : ''}</p>

  <div class="score-card">
    <div style="font-weight: 600; color: #64748b; text-transform: uppercase; font-size: 13px;">Total Score Achieved</div>
    <div class="score-val">${score} <span style="font-size: 20px; color: #64748b;">/ ${maxScore}</span></div>
    <div style="font-size: 15px; font-weight: 600; color: #16a34a;">Percentage: ${pct}% • Qualified Status</div>
  </div>

  <div class="stats-grid">
    <div class="stat-box">
      <div class="stat-label">Correct</div>
      <div class="stat-value" style="color: #16a34a;">${test.correct ?? 0}</div>
    </div>
    <div class="stat-box">
      <div class="stat-label">Incorrect</div>
      <div class="stat-value" style="color: #dc2626;">${test.incorrect ?? 0}</div>
    </div>
    <div class="stat-box">
      <div class="stat-label">Unattempted</div>
      <div class="stat-value" style="color: #d97706;">${test.unanswered ?? 0}</div>
    </div>
    <div class="stat-box">
      <div class="stat-label">Time Taken</div>
      <div class="stat-value">${test.timeTaken || 'Full Duration'}</div>
    </div>
  </div>

  <div style="text-align: center; margin: 30px 0;">
    <button onclick="window.print()" style="padding: 10px 24px; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 14px;">
      Print / Save as PDF
    </button>
  </div>

  <div class="footer">
    © 2026 CET Prep Pro. All Rights Reserved. Generated electronically for student performance review.
  </div>
</body>
</html>`

  printWindow.document.write(html)
  printWindow.document.close()
}

/**
 * Downloads a complete offline HTML Question & Solution Booklet
 */
export function downloadCompleteSolutionBooklet(
  examName: string,
  questions: Question[],
  answers: Record<string, number | string> = {},
  aiSolutions: Record<string, string> = {}
) {
  if (!questions || questions.length === 0) {
    alert('No questions available to download.')
    return
  }

  const itemsHtml = questions.map((q, idx) => {
    const qKey = q._id || q.text.slice(0, 30)
    const userAns = answers[q._id] !== undefined ? Number(answers[q._id]) : null
    const correctLetter = String.fromCharCode(65 + Number(q.correctIndex ?? 0))
    const userLetter = userAns !== null ? String.fromCharCode(65 + Number(userAns)) : null
    const isCorrect = userAns !== null && userAns === Number(q.correctIndex ?? 0)
    const aiSol = aiSolutions[qKey] || ''

    return `
      <div class="q-item ${isCorrect ? 'is-correct' : userAns !== null ? 'is-incorrect' : 'is-unattempted'}">
        <div class="q-head">
          <span><b>Q${idx + 1}.</b> ${q.subject || 'General'} ${q.topic ? `• ${q.topic}` : ''}</span>
          <span class="pill ${isCorrect ? 'pill-green' : userAns !== null ? 'pill-red' : 'pill-amber'}">
            ${isCorrect ? 'Correct (+1)' : userAns !== null ? 'Incorrect (0)' : 'Unattempted (0)'}
          </span>
        </div>
        <div class="q-text">${escapeHtml(q.text)}</div>
        <div class="options">
          ${q.options.map((opt, optIdx) => {
            const letter = String.fromCharCode(65 + optIdx)
            const isThisCorrect = optIdx === Number(q.correctIndex ?? 0)
            const isThisUser = userAns !== null && optIdx === userAns
            return `
              <div class="opt ${isThisCorrect ? 'opt-correct' : isThisUser ? 'opt-wrong' : ''}">
                <b>${letter})</b> ${escapeHtml(opt)}
                ${isThisCorrect ? '<span style="color:#16a34a; font-weight:bold;"> ✓ Correct</span>' : ''}
                ${isThisUser && !isThisCorrect ? '<span style="color:#dc2626; font-weight:bold;"> ✗ Your Pick</span>' : ''}
              </div>
            `
          }).join('')}
        </div>
        <div class="ans-meta">
          Correct Answer: <b>Option ${correctLetter}</b> | Your Answer: <b>${userLetter ? `Option ${userLetter}` : 'Not Attempted'}</b>
        </div>
        ${q.solution ? `<div class="sol-box"><b>Reference Solution:</b><br/>${escapeHtml(q.solution)}</div>` : ''}
        ${aiSol ? `<div class="ai-sol-box"><b>AI Step-by-Step Derivation:</b><br/><pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(aiSol)}</pre></div>` : ''}
      </div>
    `
  }).join('')

  const fullHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${examName} - Solutions Booklet</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1e293b; max-width: 900px; margin: 0 auto; padding: 32px 20px; background: #f8fafc; }
    .header { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 24px; text-align: center; }
    .q-item { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
    .is-correct { border-left: 5px solid #16a34a; }
    .is-incorrect { border-left: 5px solid #dc2626; }
    .is-unattempted { border-left: 5px solid #d97706; }
    .q-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .pill { padding: 3px 10px; border-radius: 14px; font-size: 12px; font-weight: 700; }
    .pill-green { background: #f0fdf4; color: #15803d; border: 1px solid #86efac; }
    .pill-red { background: #fef2f2; color: #b91c1c; border: 1px solid #fca5a5; }
    .pill-amber { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
    .q-text { font-size: 15.5px; font-weight: 500; margin-bottom: 16px; color: #0f172a; }
    .options { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
    .opt { padding: 10px 14px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; background: #f8fafc; }
    .opt-correct { border-color: #86efac; background: #f0fdf4; }
    .opt-wrong { border-color: #fca5a5; background: #fef2f2; }
    .ans-meta { font-size: 13.5px; color: #475569; padding: 8px 12px; background: #f1f5f9; border-radius: 6px; margin-bottom: 12px; }
    .sol-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 16px; font-size: 13.5px; color: #1e3a8a; margin-top: 10px; }
    .ai-sol-box { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px 18px; font-size: 13.5px; margin-top: 12px; }
    @media print { body { background: #fff; padding: 0; } .q-item { page-break-inside: avoid; } }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="margin:0 0 6px; color:#2563eb;">CET PREP PRO</h1>
    <h2 style="margin:0 0 6px; color:#0f172a;">${examName} - Complete Solutions Booklet</h2>
    <p style="margin:0; color:#64748b; font-size:14px;">Total Questions: ${questions.length} • Generated on ${new Date().toLocaleDateString()}</p>
    <div style="margin-top:16px;">
      <button onclick="window.print()" style="padding:8px 20px; background:#2563eb; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600;">Print to PDF</button>
    </div>
  </div>
  ${itemsHtml}
</body>
</html>`

  const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', `${examName.replace(/\s+/g, '_')}_Solutions_Booklet.html`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Share report via navigator.share or clipboard fallback
 */
export async function shareTestReport(examName: string, score: number, maxScore: number, percentile: string | number): Promise<boolean> {
  const shareText = `🎯 CET Prep Pro Exam Result\nExam: ${examName}\nScore: ${score}/${maxScore} (${((score / maxScore) * 100).toFixed(1)}%)\nPercentile: ${percentile}th\nCheck it out on CET Prep Pro!`
  
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'My CET Exam Result',
        text: shareText,
        url: window.location.href,
      })
      return true
    } catch {
      // fallback to clipboard
    }
  }

  try {
    await navigator.clipboard.writeText(shareText)
    alert('Result summary copied to clipboard! You can paste and share it anywhere.')
    return true
  } catch {
    alert(shareText)
    return false
  }
}

/**
 * Generates an offline printable Question Bank Paper / Booklet
 */
export function exportQuestionBankHTML(questions: Question[], title = 'CET Question Bank') {
  if (!questions || questions.length === 0) {
    alert('No questions available to export.')
    return
  }

  const itemsHtml = questions.map((q, idx) => {
    const correctLetter = String.fromCharCode(65 + Number(q.correctIndex ?? 0))
    return `
      <div class="qb-card">
        <div class="qb-head">
          <span class="qb-num">Question ${idx + 1}</span>
          <span class="qb-meta">${escapeHtml(q.subject || 'General')} • ${escapeHtml(q.topic || 'General')} • Marks: +${q.marks || 2}</span>
        </div>
        <div class="qb-text">${escapeHtml(q.text)}</div>
        <div class="qb-options">
          ${q.options.map((opt, optIdx) => {
            const letter = String.fromCharCode(65 + optIdx)
            return `<div class="qb-opt"><b>${letter})</b> ${escapeHtml(opt)}</div>`
          }).join('')}
        </div>
        <div class="qb-ans">
          <b>Correct Answer:</b> Option ${correctLetter}
          ${q.solution ? `<div style="margin-top: 6px;"><b>Solution:</b> ${escapeHtml(q.solution)}</div>` : ''}
        </div>
      </div>
    `
  }).join('')

  const fullHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${title} - CET Prep Pro</title>
  <style>
    body { font-family: 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #0f172a; max-width: 960px; margin: 0 auto; padding: 32px 24px; background: #f8fafc; }
    .header { background: #fff; border: 1px solid #cbd5e1; border-radius: 12px; padding: 24px; margin-bottom: 24px; text-align: center; }
    .qb-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin-bottom: 18px; page-break-inside: avoid; }
    .qb-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px; }
    .qb-num { font-weight: 700; color: #2563eb; font-size: 15px; }
    .qb-meta { font-size: 12.5px; color: #64748b; font-weight: 600; }
    .qb-text { font-size: 15px; font-weight: 500; margin-bottom: 14px; color: #1e293b; }
    .qb-options { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
    .qb-opt { padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13.5px; background: #f8fafc; }
    .qb-ans { font-size: 13.5px; color: #15803d; background: #f0fdf4; border: 1px solid #bbf7d0; padding: 10px 14px; border-radius: 6px; }
    @media print { body { background: #fff; padding: 0; } button { display: none; } }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="margin: 0 0 6px; color: #2563eb;">CET PREP PRO</h1>
    <h2 style="margin: 0 0 6px; color: #0f172a;">${title}</h2>
    <p style="margin: 0; color: #64748b; font-size: 14px;">Total Questions: ${questions.length} • Generated on ${new Date().toLocaleDateString()}</p>
    <div style="margin-top: 16px;">
      <button onclick="window.print()" style="padding: 9px 20px; background: #2563eb; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">Print / Save as PDF</button>
    </div>
  </div>
  ${itemsHtml}
</body>
</html>`

  const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8;' })
  const blobUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', blobUrl)
  link.setAttribute('download', `${title.replace(/\s+/g, '_')}_${Date.now()}.html`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(blobUrl)
}

function escapeHtml(str: string): string {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
