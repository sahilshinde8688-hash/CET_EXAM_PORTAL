const db = require('./dbService')

const evaluateMockTestAttempt = async (attempt, assignment) => {
  const questions = await db.getQuestions({ ids: attempt.questionIds, isActive: true }, { isAdmin: true })
  const questionsById = new Map(questions.map(question => [String(question._id), question]))
  let score = 0
  let correct = 0
  let incorrect = 0
  let totalMarks = 0
  const subjectScores = new Map()
  const answers = attempt.answers || {}

  for (const questionId of attempt.questionIds) {
    const question = questionsById.get(String(questionId))
    if (!question) throw Object.assign(new Error('A question in this attempt is no longer available.'), { status: 409 })
    const marks = Number(question.marks)
    const optionOrder = attempt.optionOrders[String(questionId)] || question.options.map((_, index) => index)
    totalMarks += marks
    const subject = question.subject || 'General'
    const summary = subjectScores.get(subject) || { score: 0, maxScore: 0 }
    summary.maxScore += marks

    if (answers[questionId] !== undefined && answers[questionId] !== null) {
      const selected = Number(answers[questionId])
      if (!Number.isInteger(selected) || selected < 0 || selected >= optionOrder.length) {
        throw Object.assign(new Error('One or more saved answers are invalid.'), { status: 409 })
      }
      if (Number(optionOrder[selected]) === Number(question.correctIndex)) {
        correct += 1
        score += marks
        summary.score += marks
      } else {
        incorrect += 1
        if (/jee|neet/i.test(assignment.mockTestName)) {
          const deduction = Number(question.negativeMarks) || 0
          score = Math.max(0, score - deduction)
          summary.score = Math.max(0, summary.score - deduction)
        }
      }
    }
    subjectScores.set(subject, summary)
  }

  const reviewAnswers = Object.fromEntries(Object.entries(answers).map(([questionId, selectedIndex]) => [
    questionId,
    Number(attempt.optionOrders[questionId]?.[selectedIndex] ?? selectedIndex),
  ]))
  return {
    userId: attempt.studentId,
    testName: assignment.mockTestName,
    subject: 'Mock Test',
    score,
    totalMarks,
    percentile: totalMarks ? (score / totalMarks) * 100 : 0,
    duration: Number(attempt.timeSpent) || 0,
    correct,
    incorrect,
    unanswered: attempt.questionIds.length - correct - incorrect,
    totalQuestions: attempt.questionIds.length,
    subjectWiseScores: Array.from(subjectScores.entries()).map(([subject, values]) => ({
      subject,
      ...values,
      percentage: values.maxScore ? (values.score / values.maxScore) * 100 : 0,
    })),
    answers: reviewAnswers,
    questionIds: attempt.questionIds,
    mockTestAttemptId: attempt._id,
  }
}

const evaluateAndSaveMockTestAttempt = async (attempt, assignment) => {
  const resultData = await evaluateMockTestAttempt(attempt, assignment)
  const result = await db.createTestResult(resultData)
  const updatedAttempt = await db.updateMockTestAttempt(attempt._id, {
    resultId: result._id,
    score: result.score,
  })
  return { result, attempt: updatedAttempt }
}

module.exports = { evaluateMockTestAttempt, evaluateAndSaveMockTestAttempt }
