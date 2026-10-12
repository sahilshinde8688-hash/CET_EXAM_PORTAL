import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { Question, TestResult } from './api'

interface SolutionsBookletInput {
  testName: string
  testId: string
  candidateName: string
  rollNumber: string
  result: TestResult
  questions: Question[]
}

const navy: [number, number, number] = [15, 39, 77]
const blue: [number, number, number] = [37, 99, 235]
const slate: [number, number, number] = [71, 85, 105]
const green: [number, number, number] = [21, 128, 61]
const greenLight: [number, number, number] = [240, 253, 244]
const greenBorder: [number, number, number] = [134, 239, 172]
const red: [number, number, number] = [185, 28, 28]
const redLight: [number, number, number] = [254, 242, 242]
const redBorder: [number, number, number] = [252, 165, 165]
const amber: [number, number, number] = [180, 83, 9]
const amberLight: [number, number, number] = [255, 251, 235]
const amberBorder: [number, number, number] = [253, 230, 138]
const neutralLight: [number, number, number] = [248, 250, 252]
const line: [number, number, number] = [226, 232, 240]
const lineHeightFactor = 0.42
const baseUrl = import.meta.env.BASE_URL || '/'
const safeName = (value: string) =>
  value.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'Test'
const dateText = (value?: string) => {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not available'
  return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}
const getAnswer = (answer: unknown) => {
  if (answer === undefined || answer === null || answer === '') return null
  const parsed = Number(answer)
  return Number.isInteger(parsed) ? parsed : null
}
const blobToPng = async (blob: Blob, maxDimension = 1600) => {
  const image = new Image()
  const objectUrl = URL.createObjectURL(blob)
  try {
    image.src = objectUrl
    await image.decode()
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image could not be converted for the booklet.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
const getImageData = async (url: string) => {
  const blob = url.startsWith('data:image/')
    ? await (await fetch(url)).blob()
    : await (async () => {
      const response = await fetch(url, { credentials: 'omit' })
      if (!response.ok) throw new Error(`Question image could not be loaded (${response.status}).`)
      return response.blob()
    })()
  if (!blob.type.startsWith('image/')) throw new Error('The question image URL did not return an image.')
  return blobToPng(blob)
}

export async function downloadSolutionsBookletPdf({
  testName,
  testId,
  candidateName,
  rollNumber,
  result,
  questions,
}: SolutionsBookletInput) {
  if (!questions.length) throw new Error('No questions are available for this test result.')
  if (questions.some(question => !Array.isArray(question.options) || !question.options.length
    || !Number.isInteger(Number(question.correctIndex))
    || Number(question.correctIndex) < 0
    || Number(question.correctIndex) >= question.options.length)) {
    throw new Error('A question is missing its answer options or verified answer key. The booklet was not generated.')
  }

  const logoResponse = await fetch(`${baseUrl}logo.png`)
  if (!logoResponse.ok) throw new Error('CETNova logo could not be loaded for the booklet.')
  const logoBlob = await logoResponse.blob()
  const logoData = await blobToPng(logoBlob, 700)

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 15
  const contentWidth = pageWidth - margin * 2
  const contentTop = 24
  const contentBottom = pageHeight - 18
  const answers = result.answers || {}
  const examType = /jee/i.test(testName) ? 'JEE' : /neet/i.test(testName) ? 'NEET' : /cet/i.test(testName) ? 'MHT-CET' : 'Mock examination'
  const subjects = [...new Set(questions.map(question => question.subject).filter(Boolean))]
  const subjectLabel = subjects.length ? subjects.join(', ') : result.subject || 'Not available'
  const answerStates = questions.map(question => {
    const selected = getAnswer(answers[question._id])
    const correct = selected !== null && selected === Number(question.correctIndex)
    return { selected, correct, unattempted: selected === null }
  })
  let runningScore = 0
  const questionMarkDetails = questions.map((question, index) => {
    const { selected, correct } = answerStates[index]
    const marks = Number(question.marks) || 0
    if (selected === null) return { awarded: 0, deducted: 0 }
    if (correct) {
      runningScore += marks
      return { awarded: marks, deducted: 0 }
    }
    if (/jee|neet/i.test(testName)) {
      const before = runningScore
      runningScore = Math.max(0, runningScore - (Number(question.negativeMarks) || 0))
      return { awarded: 0, deducted: before - runningScore }
    }
    return { awarded: 0, deducted: 0 }
  })

  const addPageHeader = () => {
    doc.setFillColor(239, 246, 255)
    doc.rect(0, 0, pageWidth, 19, 'F')
    doc.addImage(logoData, 'PNG', margin, 2, 24, 15)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...navy)
    doc.text(doc.splitTextToSize(testName, pageWidth - margin * 2 - 34).slice(0, 1), pageWidth - margin, 11, { align: 'right' })
  }

  const ensureRoom = (height: number) => {
    if (y + height > contentBottom) {
      doc.addPage()
      addPageHeader()
      y = contentTop
    }
  }

  const addText = (text: string, x: number, startY: number, width: number, fontSize = 10, color: [number, number, number] = slate, bold = false) => {
    const lines = doc.splitTextToSize(text || 'Not available', width) as string[]
    const lineHeight = fontSize * lineHeightFactor
    const totalHeight = lines.length * lineHeight
    const pageYBeforeRoomCheck = y
    if (totalHeight <= contentBottom - contentTop) ensureRoom(totalHeight)
    let offset = 0
    let currentY = y !== pageYBeforeRoomCheck ? y : startY
    while (offset < lines.length) {
      const availableLines = Math.floor((contentBottom - currentY) / lineHeight)
      if (availableLines < 1) {
        doc.addPage()
        addPageHeader()
        currentY = contentTop
        continue
      }
      const chunk = lines.slice(offset, offset + availableLines)
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setFontSize(fontSize)
      doc.setTextColor(...color)
      doc.setCharSpace(0)
      doc.text(chunk, x, currentY)
      currentY += chunk.length * lineHeight
      offset += chunk.length
      if (offset < lines.length) {
        doc.addPage()
        addPageHeader()
        currentY = contentTop
      }
    }
    return currentY
  }

  const lineBlock = (text: string, fontSize = 10) => {
    const wrapped = doc.splitTextToSize(text || 'Not available', contentWidth - 4) as string[]
    return wrapped.length * fontSize * lineHeightFactor + 2
  }

  let y = contentTop

  doc.setFillColor(239, 246, 255)
  doc.rect(0, 0, pageWidth, 19, 'F')
  doc.addImage(logoData, 'PNG', pageWidth / 2 - 32, 22, 64, 40)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(23)
  doc.setTextColor(...navy)
  doc.text('Complete Solution Booklet', pageWidth / 2, 79, { align: 'center' })
  doc.setDrawColor(...blue)
  doc.setLineWidth(0.8)
  doc.line(margin + 30, 85, pageWidth - margin - 30, 85)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(13)
  doc.setTextColor(...blue)
  doc.text(doc.splitTextToSize(testName, contentWidth - 16), pageWidth / 2, 96, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...slate)
  doc.text('Student answer review · Verified answer key · Official result data', pageWidth / 2, 103, { align: 'center' })
  y = 112

  const coverRows: Array<[string, string]> = [
    ['Test ID', testId || 'Not available'],
    ['Student', candidateName || 'Student'],
    ['Roll number', rollNumber || 'Not available'],
    ['Subject', subjectLabel],
    ['Examination type', examType],
    ['Submitted', dateText(result.attemptedAt)],
    ['Total questions', String(questions.length)],
    ['Correct / Incorrect / Unattempted', `${Number(result.correct) || 0} / ${Number(result.incorrect) || 0} / ${Number(result.unanswered) || 0}`],
    ['Final score', `${Number(result.score) || 0} / ${Number(result.totalMarks) || 0}`],
  ]
  autoTable(doc, {
    startY: y,
    margin: { left: margin + 10, right: margin + 10 },
    theme: 'grid',
    body: coverRows,
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 4, textColor: slate, lineColor: line },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 63, textColor: navy }, 1: { cellWidth: 'auto' } },
    alternateRowStyles: { fillColor: [255, 255, 255] },
  })

  doc.addPage()
  addPageHeader()
  y = contentTop
  const imageCache = new Map<string, string>()

  for (let index = 0; index < questions.length; index++) {
    const question = questions[index]
    const { selected, correct, unattempted } = answerStates[index]
    const questionHeader = `Q${index + 1}  |  ${question.subject || 'General'}${question.chapter ? `  |  ${question.chapter}` : ''}${question.topic ? ` / ${question.topic}` : ''}`
    const questionLines = doc.splitTextToSize(question.text || 'Question text unavailable.', contentWidth - 8) as string[]
    const optionLines = question.options.map((option, optionIndex) =>
      doc.splitTextToSize(`${String.fromCharCode(65 + optionIndex)}) ${option}`, contentWidth - 14) as string[]
    )
    const solution = question.solution?.trim() || 'Detailed solution not available.'
    const estimatedHeight = 15
      + questionLines.length * 4.5
      + optionLines.reduce((sum, option) => sum + option.length * 4 + 9, 0)
      + 31
      + doc.splitTextToSize(solution, contentWidth - 10).length * 4.2
    if (estimatedHeight < contentBottom - contentTop) ensureRoom(estimatedHeight)
    else ensureRoom(35)

    doc.setFillColor(248, 250, 252)
    doc.setDrawColor(...line)
    doc.roundedRect(margin, y, contentWidth, 9, 1.5, 1.5, 'FD')
    y = addText(questionHeader, margin + 3, y + 6, contentWidth - 6, 10, navy, true) + 3
    const marks = Number(question.marks) || 0
    const negative = /jee|neet/i.test(testName) ? Number(question.negativeMarks) || 0 : 0
    y = addText(
      `Marks: +${marks} correct${negative ? ` / -${negative} incorrect` : ' / no negative marking'}   |   Result: ${correct ? 'Correct' : unattempted ? 'Unattempted' : 'Incorrect'}`,
      margin + 2, y, contentWidth - 4, 9, correct ? green : unattempted ? amber : red, true,
    ) + 3
    y = addText(question.text || 'Question text unavailable.', margin + 2, y, contentWidth - 4, 11, navy) + 4

    if (question.imageUrl) {
      let imageData = imageCache.get(question.imageUrl)
      if (!imageData) {
        try {
          imageData = await getImageData(question.imageUrl)
          imageCache.set(question.imageUrl, imageData)
        } catch (error) {
          throw new Error(`Q${index + 1}: ${error instanceof Error ? error.message : 'Question image could not be loaded.'}`)
        }
      }
      const dimensions = doc.getImageProperties(imageData)
      const width = Math.min(contentWidth - 8, 160)
      const height = Math.min(75, width * dimensions.height / dimensions.width)
      ensureRoom(height + 7)
      doc.addImage(imageData, dimensions.fileType, margin + 4, y, width, height)
      y += height + 7
    }

    for (let optionIndex = 0; optionIndex < question.options.length; optionIndex++) {
      const optionHeight = optionLines[optionIndex].length * 4.2 + 10
      ensureRoom(optionHeight + 8)
      const isCorrectOption = optionIndex === Number(question.correctIndex)
      const isSelectedWrong = selected === optionIndex && !correct
      const fill = isCorrectOption ? greenLight : isSelectedWrong ? redLight : neutralLight
      const border = isCorrectOption ? greenBorder : isSelectedWrong ? redBorder : line
      doc.setFillColor(...fill)
      doc.setDrawColor(...border)
      doc.roundedRect(margin + 2, y - 2, contentWidth - 4, optionHeight, 1.2, 1.2, 'FD')
      const optionY = y + 2
      const optionEndY = addText(optionLines[optionIndex].join('\n'), margin + 6, optionY + 3, contentWidth - 14, 10, isCorrectOption ? green : isSelectedWrong ? red : slate, isCorrectOption || isSelectedWrong)
      if (isCorrectOption || selected === optionIndex) {
        const suffix = isCorrectOption && selected === optionIndex ? 'Correct answer - Your answer' : isCorrectOption ? 'Correct answer' : 'Your answer'
        addText(suffix, margin + 11, optionEndY + 1, contentWidth - 24, 8, isCorrectOption ? green : red, true)
      }
      y = optionY + optionHeight + 2
    }

    const correctOption = question.options[Number(question.correctIndex)] || 'Correct option unavailable'
    const yourOption = selected === null ? 'Not Attempted' : question.options[selected] || `Option ${selected + 1}`
    const { awarded, deducted } = questionMarkDetails[index]
    const analysis = `Correct answer: ${correctOption}  |  Your answer: ${yourOption}  |  Marks awarded: ${awarded > 0 ? '+' : ''}${awarded}${deducted ? `  |  Negative marks deducted: -${deducted}` : ''}`
    const analysisHeight = lineBlock(analysis, 9.5) + 7
    ensureRoom(analysisHeight)
    const analysisFill = correct ? greenLight : unattempted ? amberLight : redLight
    const analysisBorder = correct ? greenBorder : unattempted ? amberBorder : redBorder
    const analysisColor = correct ? green : unattempted ? amber : red
    doc.setFillColor(...analysisFill)
    doc.setDrawColor(...analysisBorder)
    doc.roundedRect(margin + 2, y, contentWidth - 4, analysisHeight, 1.5, 1.5, 'FD')
    y = addText(analysis, margin + 6, y + 6, contentWidth - 12, 9.5, analysisColor, true) + 5
    ensureRoom(14)
    doc.setFillColor(239, 246, 255)
    doc.setDrawColor(191, 219, 254)
    doc.roundedRect(margin + 2, y, contentWidth - 4, 12, 1.5, 1.5, 'FD')
    y = addText('Explanation / step-by-step solution', margin + 6, y + 8, contentWidth - 12, 9.5, navy, true) + 3
    y = addText(solution, margin + 6, y, contentWidth - 12, 10, slate) + 9
    if (index < questions.length - 1) {
      ensureRoom(5)
      doc.setDrawColor(...line)
      doc.line(margin, y, pageWidth - margin, y)
      y += 7
    }
  }

  const pageCount = doc.getNumberOfPages()
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page)
    doc.setDrawColor(...line)
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...slate)
    doc.text(`CETNova - ${testName}`, margin, pageHeight - 7)
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 7, { align: 'right' })
  }

  doc.save(`CETNova_Solutions_Booklet_${safeName(testName)}_${safeName(candidateName)}.pdf`)
}
