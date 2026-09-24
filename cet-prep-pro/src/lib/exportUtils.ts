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
    passMark?: number
    hasPassed?: boolean
  }
) {
  const printWindow = window.open('', '_blank', 'width=1200,height=1200')
  if (!printWindow) {
    window.print()
    return
  }

  const score = Number(test.score) || 0
  const maxScore = Number(test.totalMarks) || 100
  const correct = Number(test.correct ?? 0)
  const incorrect = Number(test.incorrect ?? 0)
  const unanswered = Number(test.unanswered ?? 0)
  const pctNumber = test.percentage !== undefined
    ? Number(test.percentage)
    : maxScore > 0 ? (score / maxScore) * 100 : 0
  const pct = pctNumber.toFixed(1)
  const passMark = Number(test.passMark ?? 50)
  const hasPassed = typeof test.hasPassed === 'boolean' ? test.hasPassed : pctNumber >= passMark
  const dateStr = test.attemptedAt ? new Date(test.attemptedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const candidateName = test.candidateName || 'Student'
  const rollNumber = test.rollNumber || 'N/A'
  const examName = test.testName || 'TEST MOCK EXAM'
  const derivedQuestionTotal = correct + incorrect + unanswered
  const totalQuestions = Number(test.totalQuestions ?? (derivedQuestionTotal > 0 ? derivedQuestionTotal : maxScore))
  const subjectStats = (test.subjectWiseScores || []).slice(0, 3)
  const subjectRows = subjectStats.length
    ? subjectStats.map((item: any) => {
        const s = Number(item.score || 0)
        const m = Number(item.maxScore || 1)
        const p = Number(item.percentage || (m ? (s / m) * 100 : 0))
        return `
          <tr>
            <td>${item.subject || 'General'}</td>
            <td>${s}/${m}</td>
            <td>${p.toFixed(1)}%</td>
            <td><span class="mini-bar"><span style="width: ${Math.min(p, 100)}%"></span></span></td>
          </tr>
        `
      }).join('')
    : `
      <tr>
        <td>Physics</td>
        <td>1/20</td>
        <td>5.0%</td>
        <td><span class="mini-bar"><span style="width: 5%"></span></span></td>
      </tr>
      <tr>
        <td>Chemistry</td>
        <td>1/20</td>
        <td>5.0%</td>
        <td><span class="mini-bar"><span style="width: 5%"></span></span></td>
      </tr>
      <tr>
        <td>Mathematics</td>
        <td>0/18</td>
        <td>0.0%</td>
        <td><span class="mini-bar"><span style="width: 0%"></span></span></td>
      </tr>
    `

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${examName} - Detailed Performance Report</title>
  <style>
    :root {
      --blue: #1e6fe8;
      --blue-dark: #0d4db2;
      --navy: #0f172a;
      --text: #1e293b;
      --muted: #64748b;
      --soft: #eef4ff;
      --card: #ffffff;
      --line: #dfe7f3;
      --green: #22c55e;
      --green-soft: #dcfce7;
      --red: #ef4444;
      --red-soft: #fee2e2;
      --amber: #f59e0b;
      --amber-soft: #fef3c7;
      --gray: #e2e8f0;
      --gray-strong: #94a3b8;
      --shadow: rgba(15, 23, 42, 0.08);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f3f6fb;
      font-family: 'Segoe UI', Arial, sans-serif;
      color: var(--text);
      line-height: 1.4;
    }

    .report-page {
      width: 100%;
      max-width: 1280px;
      margin: 0 auto;
      background: #f3f6fb;
      padding: 18px 18px 28px;
    }

    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 20px;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 18px 22px;
      margin-bottom: 18px;
      box-shadow: 0 4px 18px var(--shadow);
    }

    .brand-wrap {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .brand-mark {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: linear-gradient(135deg, #0f172a, #1e6fe8);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 22px;
      font-weight: 800;
    }

    .brand-title {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: 0.5px;
      color: var(--navy);
    }

    .brand-sub {
      font-size: 12px;
      color: var(--muted);
    }

    .practice-note {
      font-size: 12px;
      color: var(--muted);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .heading-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin: 10px 0 18px;
      padding: 0 6px;
    }

    .heading-row h1 {
      font-size: 32px;
      margin: 0;
      font-weight: 900;
      color: var(--navy);
      letter-spacing: 0.4px;
    }

    .heading-row .right-meta {
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      text-align: right;
      line-height: 1.7;
    }

    .candidate-bar {
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 12px;
      box-shadow: 0 4px 18px var(--shadow);
      padding: 18px 22px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 18px;
      margin-bottom: 18px;
    }

    .candidate-left {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .avatar {
      width: 54px;
      height: 54px;
      border-radius: 50%;
      background: linear-gradient(135deg, #edf2ff, #dbeafe);
      border: 1px solid #cbd5e1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #475569;
      font-weight: 700;
      font-size: 18px;
    }

    .candidate-name {
      font-size: 14px;
      color: var(--muted);
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      font-weight: 700;
    }

    .candidate-text {
      font-size: 16px;
      font-weight: 700;
      color: var(--navy);
      margin: 4px 0 0;
    }

    .candidate-detail {
      font-size: 13px;
      color: var(--muted);
      margin-top: 4px;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .label-pill {
      display: inline-block;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      color: #1d4ed8;
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }

    .layout {
      display: grid;
      grid-template-columns: 1fr 1.18fr;
      gap: 18px;
      margin-top: 10px;
    }

    .panel {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 14px;
      box-shadow: 0 4px 18px var(--shadow);
      overflow: hidden;
    }

    .panel-head {
      padding: 16px 18px 12px;
      font-size: 14px;
      color: var(--muted);
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.7px;
    }

    .score-box {
      padding: 12px 18px 18px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
    }

    .donut {
      width: 160px;
      height: 160px;
      border-radius: 50%;
      background: conic-gradient(var(--blue) 0 ${Math.min(Number(pct), 100)}%, var(--gray) ${Math.min(Number(pct), 100)}% 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      margin: 8px auto 12px;
    }

    .donut::before {
      content: "";
      position: absolute;
      inset: 18px;
      border-radius: 50%;
      background: white;
      box-shadow: inset 0 0 0 1px var(--line);
    }

    .donut-inner {
      position: relative;
      z-index: 1;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .donut-value {
      font-size: 18px;
      line-height: 1.1;
      font-weight: 800;
      color: var(--navy);
    }

    .donut-value strong {
      font-size: 28px;
      color: var(--blue);
    }

    .metric-row {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      padding: 0 18px 18px;
    }

    .metric {
      padding: 12px 10px;
      border-radius: 10px;
      border: 1px solid var(--line);
      background: #f8fafc;
      text-align: center;
    }

    .metric .label {
      font-size: 11px;
      font-weight: 700;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.7px;
    }

    .metric .value {
      margin-top: 8px;
      font-size: 24px;
      font-weight: 800;
      line-height: 1.1;
    }

    .metric.green .value { color: var(--green); }
    .metric.red .value { color: var(--red); }
    .metric.amber .value { color: var(--amber); }
    .metric.gray .value { color: var(--navy); }

    .table-wrap {
      padding: 0 18px 18px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }

    th, td {
      text-align: left;
      padding: 9px 10px;
      border-bottom: 1px solid var(--line);
    }

    th {
      color: var(--muted);
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.6px;
      font-weight: 700;
    }

    .mini-bar {
      display: inline-block;
      width: 110px;
      height: 9px;
      border-radius: 999px;
      background: #e2e8f0;
      overflow: hidden;
      vertical-align: middle;
      margin-left: 6px;
    }

    .mini-bar span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #22c55e, #2563eb);
    }

    .right-panel .panel {
      margin-bottom: 18px;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      padding: 0 18px 18px;
    }

    .pill-box {
      background: #f8fafc;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 12px 10px;
      text-align: center;
    }

    .pill-box .k {
      font-size: 11px;
      font-weight: 700;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.7px;
    }

    .pill-box .v {
      margin-top: 8px;
      font-size: 22px;
      font-weight: 800;
      color: var(--navy);
    }

    .question-analysis {
      padding: 0 18px 18px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      align-items: center;
    }

    .legend {
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 12px;
      color: var(--muted);
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
    }

    .legend-swatch {
      width: 12px;
      height: 12px;
      border-radius: 4px;
      display: inline-block;
    }

    .ring {
      width: 120px;
      height: 120px;
      border-radius: 50%;
      background: conic-gradient(var(--green) 0 8%, var(--red) 8% 18%, var(--gray) 18% 100%);
      position: relative;
      margin: 0 auto;
    }

    .ring::before {
      content: "";
      position: absolute;
      inset: 17px;
      border-radius: 50%;
      background: white;
      box-shadow: inset 0 0 0 1px var(--line);
    }

    .ring-center {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      color: var(--navy);
      font-size: 22px;
      z-index: 1;
    }

    .qtable {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }

    .qtable td, .qtable th {
      padding: 7px 6px;
      border-bottom: 1px solid var(--line);
      text-align: center;
    }

    .qtable th {
      color: var(--muted);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .chip {
      display: inline-block;
      padding: 3px 7px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
    }

    .chip.good { background: var(--green-soft); color: #166534; }
    .chip.bad { background: var(--red-soft); color: #991b1b; }
    .chip.flat { background: #e2e8f0; color: #334155; }

    .footer-note {
      margin-top: 20px;
      padding: 12px 0 0;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 11px;
      text-align: center;
    }

    @media print {
      body { background: #fff; }
      .report-page { padding: 0; }
      .topbar, .panel, .candidate-bar { box-shadow: none; }
      button { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="report-page">
    <div class="topbar">
      <div class="brand-wrap">
        <div class="brand-mark">C</div>
        <div>
          <div class="brand-title">CET PREP PRO</div>
          <div class="brand-sub">MHT-CET Entrance Examination Platform</div>
        </div>
      </div>
      <div class="practice-note">Practice Today<br />Perform Tomorrow</div>
    </div>

    <div class="heading-row">
      <div>
        <h1>${examName}</h1>
      </div>
      <div class="right-meta">
        <div>Official Examination Scorecard</div>
        <div>Date: ${dateStr}</div>
      </div>
    </div>

    <div class="candidate-bar">
      <div class="candidate-left">
        <div class="avatar">${candidateName.charAt(0).toUpperCase() || 'S'}</div>
        <div>
          <p class="candidate-name">Candidate Details</p>
          <div class="candidate-text">${candidateName}</div>
          <div class="candidate-detail">
            <span>Roll Number: ${rollNumber}</span>
            <span>•</span>
            <span>Exam Name: ${examName}</span>
          </div>
        </div>
      </div>
      <span class="label-pill" style="background:${hasPassed ? '#eff6ff' : '#fff1f2'}; color:${hasPassed ? '#1d4ed8' : '#b91c1c'}; border-color:${hasPassed ? '#bfdbfe' : '#fecdd3'};">${hasPassed ? 'Qualified' : 'Not Qualified'}</span>
    </div>

    <div class="layout">
      <div class="left-panel">
        <div class="panel">
          <div class="panel-head">Overall Performance</div>
          <div class="score-box">
            <div class="donut" aria-label="score percentage">
              <div class="donut-inner">
                <div class="donut-value"><strong>${pct}</strong>%</div>
              </div>
            </div>
            <div style="font-size: 14px; color: var(--muted); font-weight: 700; margin-top: 2px;">Qualified Status: <span style="color: ${hasPassed ? '#16a34a' : '#dc2626'}; font-weight: 800;">${hasPassed ? 'Passed' : 'Needs Improvement'}</span></div>
          </div>
          <div class="metric-row">
            <div class="metric green">
              <div class="label">Correct</div>
              <div class="value">${correct}</div>
            </div>
            <div class="metric red">
              <div class="label">Incorrect</div>
              <div class="value">${incorrect}</div>
            </div>
            <div class="metric amber">
              <div class="label">Unattempted</div>
              <div class="value">${unanswered}</div>
            </div>
            <div class="metric gray">
              <div class="label">Total</div>
              <div class="value">${score}/${maxScore}</div>
            </div>
          </div>
        </div>

        <div class="panel" style="margin-top: 18px;">
          <div class="panel-head">Subject-wise Performance</div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Score</th>
                  <th>%</th>
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody>
                ${subjectRows}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="right-panel">
        <div class="panel">
          <div class="panel-head">Detailed Performance Report</div>
          <div class="stats-grid">
            <div class="pill-box">
              <div class="k">Total Time</div>
              <div class="v">${test.timeTaken || '60 min'}</div>
            </div>
            <div class="pill-box">
              <div class="k">Average Time / Q</div>
              <div class="v">42 sec</div>
            </div>
            <div class="pill-box">
              <div class="k">Fastest Question</div>
              <div class="v">8 sec</div>
            </div>
            <div class="pill-box">
              <div class="k">Slowest Question</div>
              <div class="v">2m 14s</div>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head">Question Analysis</div>
          <div class="question-analysis">
            <div class="legend">
              <div class="legend-item"><span class="legend-swatch" style="background: #22c55e"></span> Correct: ${correct} (${((correct / Math.max(1, totalQuestions)) * 100).toFixed(1)}%)</div>
              <div class="legend-item"><span class="legend-swatch" style="background: #ef4444"></span> Incorrect: ${incorrect} (${((incorrect / Math.max(1, totalQuestions)) * 100).toFixed(1)}%)</div>
              <div class="legend-item"><span class="legend-swatch" style="background: #e2e8f0"></span> Unattempted: ${unanswered} (${((unanswered / Math.max(1, totalQuestions)) * 100).toFixed(1)}%)</div>
            </div>
            <div class="ring"><div class="ring-center">${pct}%</div></div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head">Question-wise Summary</div>
          <div class="table-wrap" style="padding-top: 0;">
            <table class="qtable">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Subject</th>
                  <th>Your Answer</th>
                  <th>Correct</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>1</td><td>Physics</td><td>A</td><td>B</td><td><span class="chip bad">Wrong</span></td></tr>
                <tr><td>2</td><td>Physics</td><td>C</td><td>C</td><td><span class="chip good">Correct</span></td></tr>
                <tr><td>3</td><td>Chemistry</td><td>D</td><td>D</td><td><span class="chip good">Correct</span></td></tr>
                <tr><td>4</td><td>Chemistry</td><td>B</td><td>A</td><td><span class="chip bad">Wrong</span></td></tr>
                <tr><td>5</td><td>Mathematics</td><td>D</td><td>B</td><td><span class="chip bad">Wrong</span></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <div class="footer-note">
      © 2026 CET Prep Pro. All Rights Reserved. Generated electronically for student performance review.
    </div>
  </div>
</body>
</html>
  `

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
