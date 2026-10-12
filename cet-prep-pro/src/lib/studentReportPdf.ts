import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { StudentReportData } from './api'

type SubjectSummary = {
  subject: string
  questions: number
  correct: number
  incorrect: number
  unattempted: number
  score: number
  maxMarks: number
}

const navy: [number, number, number] = [22, 52, 98]
const blue: [number, number, number] = [37, 99, 235]
const slate: [number, number, number] = [71, 85, 105]
const fmt = (value: number, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '0'
const dateText = (value?: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—'
const safeName = (value: string) => value.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'Student'

export async function downloadStudentReportPdf(report: StudentReportData) {
  const logoResponse = await fetch(`${import.meta.env?.BASE_URL || '/'}logo.png`)
  if (!logoResponse.ok) throw new Error('CETNova logo could not be loaded for the report.')
  const logoBytes = new Uint8Array(await logoResponse.arrayBuffer())
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 14
  const contentWidth = pageWidth - margin * 2
  const student = report.student
  const results = [...report.results].sort((a, b) => Date.parse(a.attemptedAt) - Date.parse(b.attemptedAt))
  const completedAssigned = new Set(report.attempts
    .filter(attempt => attempt.status === 'submitted')
    .map(attempt => attempt.assignmentId)).size
  const assignedCount = report.assignments.length
  const completion = assignedCount ? completedAssigned / assignedCount * 100 : 0
  const percentages = results.map(result => result.totalMarks > 0 ? result.score / result.totalMarks * 100 : 0)
  const averagePercentage = percentages.length ? percentages.reduce((sum, value) => sum + value, 0) / percentages.length : 0
  const highestIndex = percentages.length ? percentages.indexOf(Math.max(...percentages)) : -1
  const totalCorrect = results.reduce((sum, result) => sum + (Number(result.correct) || 0), 0)
  const totalIncorrect = results.reduce((sum, result) => sum + (Number(result.incorrect) || 0), 0)
  const totalUnattempted = results.reduce((sum, result) => sum + (Number(result.unanswered) || 0), 0)
  const attempted = totalCorrect + totalIncorrect
  const accuracy = attempted ? totalCorrect / attempted * 100 : 0
  const totalQuestions = results.reduce((sum, result) => sum + (Number(result.totalQuestions) || 0), 0)
  const subjects = new Map<string, SubjectSummary>()

  for (const result of results) {
    const scoreMap = new Map((result.subjectWiseScores || []).map(item => [item.subject, item]))
    const questionMap = result.subjectQuestionStats || {}
    for (const subject of new Set([...scoreMap.keys(), ...Object.keys(questionMap)])) {
      const current = subjects.get(subject) || { subject, questions: 0, correct: 0, incorrect: 0, unattempted: 0, score: 0, maxMarks: 0 }
      const questionStats = questionMap[subject]
      const subjectScore = scoreMap.get(subject)
      if (questionStats) {
        current.questions += questionStats.totalQuestions
        current.correct += questionStats.correct
        current.incorrect += questionStats.incorrect
        current.unattempted += questionStats.unattempted
      }
      if (subjectScore) {
        current.score += Number(subjectScore.score) || 0
        current.maxMarks += Number(subjectScore.maxScore) || 0
      }
      subjects.set(subject, current)
    }
  }

  const subjectRows = [...subjects.values()].sort((a, b) => a.subject.localeCompare(b.subject))
  const dateRange = report.reportPeriod.from || report.reportPeriod.to
    ? `${report.reportPeriod.from || 'Beginning'} to ${report.reportPeriod.to || 'Today'}`
    : 'All available history'

  const heading = (title: string, y: number) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...navy)
    doc.text(title, margin, y)
    doc.setDrawColor(219, 231, 246)
    doc.line(margin, y + 2, pageWidth - margin, y + 2)
    return y + 8
  }

  const footer = () => {
    const pageCount = doc.getNumberOfPages()
    for (let page = 1; page <= pageCount; page++) {
      doc.setPage(page)
      doc.setDrawColor(219, 231, 246)
      doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...slate)
      doc.text('CETNova · Student Performance Report', margin, pageHeight - 7)
      doc.text(`Generated ${dateText(new Date().toISOString())}`, pageWidth / 2, pageHeight - 7, { align: 'center' })
      doc.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 7, { align: 'right' })
    }
  }

  doc.setFillColor(239, 246, 255)
  doc.rect(0, 0, pageWidth, 40, 'F')
  doc.addImage(logoBytes, 'PNG', margin, 5, 30, 20)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...navy)
  doc.text('Student Performance Report', pageWidth - margin, 17, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...slate)
  doc.text(`Report period: ${dateRange}`, pageWidth - margin, 23, { align: 'right' })
  doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, pageWidth - margin, 28, { align: 'right' })

  let y = 47
  y = heading('STUDENT INFORMATION', y)
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.5, textColor: slate, lineColor: [226, 232, 240] },
    body: [
      ['Student name', student.name || '—', 'Roll number', student.mhcetId || '—'],
      ['Student ID', student._id || student.id || '—', 'Branch / course', student.branch || student.examType || '—'],
      ['Email', student.email || '—', 'Batch', student.batch ? String(student.batch) : '—'],
      ['Institute', 'CETNova', 'Registration date', dateText(student.createdAt)],
    ],
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 30 }, 1: { cellWidth: 58 }, 2: { fontStyle: 'bold', cellWidth: 30 }, 3: { cellWidth: 'auto' } },
  })
  y = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable!.finalY + 8

  y = heading('PERFORMANCE SUMMARY', y)
  const cardGap = 3
  const cardWidth = (contentWidth - cardGap * 3) / 4
  const cards = [
    ['Assigned tests', String(assignedCount), `${completedAssigned} completed · ${fmt(completion, 0)}% completion`],
    ['Tests attempted', String(results.length), 'Submitted results'],
    ['Average score', `${fmt(averagePercentage)}%`, 'Normalized per test'],
    ['Highest score', highestIndex >= 0 ? `${fmt(percentages[highestIndex])}%` : '—', highestIndex >= 0 ? results[highestIndex].testName : 'No completed tests'],
  ]
  cards.forEach(([label, value, sub], index) => {
    const x = margin + index * (cardWidth + cardGap)
    doc.setFillColor(248, 250, 252)
    doc.setDrawColor(226, 232, 240)
    doc.roundedRect(x, y, cardWidth, 22, 2, 2, 'FD')
    doc.setFontSize(7)
    doc.setTextColor(...slate)
    doc.text(label, x + 3, y + 5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(...blue)
    doc.text(value, x + 3, y + 12)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...slate)
    doc.text(doc.splitTextToSize(sub, cardWidth - 6).slice(0, 1), x + 3, y + 18)
  })
  y += 30

  y = heading('OVERALL PERFORMANCE', y)
  const metricText = `Questions: ${totalQuestions} total · ${attempted} attempted · ${totalUnattempted} unattempted     Correct: ${totalCorrect}     Incorrect: ${totalIncorrect}     Accuracy: ${attempted ? `${fmt(accuracy)}% of attempted questions` : 'N/A'}`
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...slate)
  doc.text(doc.splitTextToSize(metricText, contentWidth), margin, y)
  y += 10
  if (subjectRows.length) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...navy)
    doc.text('Subject score comparison', margin, y)
    const chartX = margin + 43
    const chartWidth = contentWidth - 48
    subjectRows.forEach((subject, index) => {
      const rowY = y + 5 + index * 7
      const pct = subject.maxMarks ? Math.max(0, Math.min(100, subject.score / subject.maxMarks * 100)) : 0
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...slate)
      doc.text(doc.splitTextToSize(subject.subject, 40).slice(0, 1), margin, rowY + 3)
      doc.setFillColor(226, 232, 240)
      doc.roundedRect(chartX, rowY, chartWidth, 4, 1, 1, 'F')
      doc.setFillColor(...blue)
      if (pct > 0) doc.roundedRect(chartX, rowY, chartWidth * pct / 100, 4, 1, 1, 'F')
      doc.setFont('helvetica', 'bold')
      doc.text(`${fmt(pct)}%`, pageWidth - margin, rowY + 3, { align: 'right' })
    })
    y += 8 + subjectRows.length * 7
  }

  y = heading('SUBJECT-WISE PERFORMANCE', y)
  if (subjectRows.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin, bottom: 18 },
      theme: 'grid',
      head: [['Subject', 'Questions', 'Correct', 'Incorrect', 'Unattempted', 'Score', 'Max marks', 'Accuracy']],
      body: subjectRows.map(subject => {
        const answered = subject.correct + subject.incorrect
        return [
          subject.subject,
          String(subject.questions),
          String(subject.correct),
          String(subject.incorrect),
          String(subject.unattempted),
          fmt(subject.score),
          fmt(subject.maxMarks),
          answered ? `${fmt(subject.correct / answered * 100)}%` : 'N/A',
        ]
      }),
      styles: { font: 'helvetica', fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
      headStyles: { fillColor: navy, textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 0: { cellWidth: 34 }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } },
    })
    y = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable!.finalY + 8
  } else {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...slate)
    doc.text('No subject-level results are available for this period.', margin, y)
    y += 8
  }

  if (results.length > 1) {
    if (y > pageHeight - 65) {
      doc.addPage()
      y = margin
    }
    y = heading('SCORE TREND', y)
    const plot = { x: margin + 10, y: y + 3, w: contentWidth - 20, h: 34 }
    doc.setDrawColor(203, 213, 225)
    doc.line(plot.x, plot.y + plot.h, plot.x + plot.w, plot.y + plot.h)
    doc.line(plot.x, plot.y, plot.x, plot.y + plot.h)
    doc.setDrawColor(...blue)
    doc.setFillColor(...blue)
    percentages.forEach((value, index) => {
      const x = plot.x + (percentages.length === 1 ? plot.w / 2 : index * plot.w / (percentages.length - 1))
      const pointY = plot.y + plot.h - (Math.max(0, Math.min(100, value)) / 100) * plot.h
      if (index > 0) {
        const previousX = plot.x + (index - 1) * plot.w / (percentages.length - 1)
        const previousY = plot.y + plot.h - (Math.max(0, Math.min(100, percentages[index - 1])) / 100) * plot.h
        doc.line(previousX, previousY, x, pointY)
      }
      doc.circle(x, pointY, 1, 'F')
    })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...slate)
    doc.text('Attempt score (% of that test maximum)', plot.x, plot.y + plot.h + 5)
    y = plot.y + plot.h + 12
  }

  if (y > pageHeight - 45) {
    doc.addPage()
    y = margin
  }
  y = heading('STRENGTHS & AREAS FOR IMPROVEMENT', y)
  const strengths = subjectRows.filter(subject => subject.correct + subject.incorrect >= 5 && subject.correct / Math.max(1, subject.correct + subject.incorrect) >= 0.75)
  const improvements = subjectRows.filter(subject => subject.correct + subject.incorrect >= 5 && subject.correct / Math.max(1, subject.correct + subject.incorrect) < 0.5)
  const strengthText = strengths.length ? strengths.map(subject => `${subject.subject} (${fmt(subject.correct / (subject.correct + subject.incorrect) * 100)}%)`).join(', ') : 'No subject has enough attempted questions to identify a reliable strength.'
  const improvementText = improvements.length ? improvements.map(subject => `${subject.subject} (${fmt(subject.correct / (subject.correct + subject.incorrect) * 100)}%)`).join(', ') : 'No subject has enough evidence to identify a specific improvement area.'
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(22, 101, 52)
  doc.text('Strengths', margin, y)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...slate)
  const strengthLines = doc.splitTextToSize(strengthText, contentWidth - 22)
  doc.text(strengthLines, margin + 22, y)
  y += Math.max(6, strengthLines.length * 4)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(185, 28, 28)
  doc.text('Improve', margin, y)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...slate)
  const improvementLines = doc.splitTextToSize(improvementText, contentWidth - 22)
  doc.text(improvementLines, margin + 22, y)
  y += Math.max(7, improvementLines.length * 4 + 3)

  const assignedAttemptById = new Map(report.attempts.map(attempt => [attempt.id, attempt]))
  const history = results.map(result => ({
    date: result.attemptedAt,
    result,
    attempt: result.mockTestAttemptId ? assignedAttemptById.get(result.mockTestAttemptId) : undefined,
  }))
  const knownResultIds = new Set(results.map(result => result.id))
  report.attempts.filter(attempt => !attempt.resultId || !knownResultIds.has(attempt.resultId)).forEach(attempt => {
    history.push({ date: attempt.startedAt, result: null, attempt })
  })
  history.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))

  if (y > pageHeight - 45) {
    doc.addPage()
    y = margin
  }
  y = heading('RECENT TEST HISTORY', y)
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin, bottom: 18 },
    theme: 'grid',
    showHead: 'everyPage',
    head: [['#', 'Test name', 'Type / status', 'Date', 'Score', 'Accuracy']],
    body: history.map((entry, index) => {
      const result = entry.result
      const answeredCount = result ? (Number(result.correct) || 0) + (Number(result.incorrect) || 0) : 0
      return [
        String(index + 1),
        entry.attempt?.testName || result?.testName || 'Test',
        result ? (result.mockTestAttemptId ? 'Assigned' : result.mockTestId ? 'Mock' : 'Normal') : entry.attempt?.status.replace('_', ' ') || 'Incomplete',
        dateText(entry.date),
        result ? `${fmt(result.score, 0)} / ${fmt(result.totalMarks, 0)}` : '—',
        result && answeredCount ? `${fmt(Number(result.correct) / answeredCount * 100)}%` : 'N/A',
      ]
    }),
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 2.2, overflow: 'linebreak' },
    headStyles: { fillColor: navy, textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { cellWidth: 8, halign: 'right' }, 1: { cellWidth: 65 }, 2: { cellWidth: 30 }, 3: { cellWidth: 27 }, 4: { cellWidth: 27, halign: 'right' }, 5: { cellWidth: 'auto', halign: 'right' } },
  })

  footer()
  const filename = `CETNova_Student_Report_${safeName(student.branch || 'Student')}_${safeName(student.mhcetId || student.name || 'Report')}.pdf`
  doc.save(filename)
}
