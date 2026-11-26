import type { MockTest, Question } from './api'

export type MockTestCategory = 'Full Length' | 'Subject-wise' | 'Chapter-wise' | 'Previous Year'
export type NormalizedMockTestSubject = 'Physics' | 'Chemistry' | 'Mathematics' | 'Biology' | 'All Subjects'

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null

export const normalizeMockTestSubject = (value: string): NormalizedMockTestSubject => {
  const subject = value.trim().toLowerCase()
  if (subject === 'physics') return 'Physics'
  if (subject === 'chemistry') return 'Chemistry'
  if (subject === 'mathematics' || subject === 'math' || subject === 'maths') return 'Mathematics'
  if (subject === 'biology') return 'Biology'
  return 'All Subjects'
}

export const getMockTestCategory = (
  test: Pick<MockTest, 'title' | 'subject' | 'config'>,
): MockTestCategory => {
  const config = asRecord(test.config)
  const category = typeof config?.category === 'string' ? config.category.toLowerCase() : ''
  const title = test.title.toLowerCase()
  if (category.includes('previous year') || category.includes('past paper')
    || /\bpyq\b|previous[\s-]*year|past[\s-]*paper/i.test(title)) return 'Previous Year'
  if (category.includes('chapter') || category.includes('topic')) return 'Chapter-wise'
  if (category.includes('subject')) return 'Subject-wise'
  if (category.includes('full length')) return 'Full Length'
  return normalizeMockTestSubject(test.subject) === 'All Subjects' ? 'Full Length' : 'Subject-wise'
}

export const getMockTestMaximumMarks = (test: Pick<MockTest, 'config'>): number | null => {
  const config = asRecord(test.config)
  const sections = config?.sections
  if (!Array.isArray(sections)) return null
  const total = sections.reduce((sum, item) => {
    const section = asRecord(item)
    const questionIds = section?.questionIds
    const positiveMarks = Number(section?.positiveMarks)
    return sum + (Array.isArray(questionIds) && Number.isFinite(positiveMarks) && positiveMarks > 0
      ? questionIds.length * positiveMarks
      : 0)
  }, 0)
  return total > 0 ? total : null
}

export const selectCustomPracticeQuestionIds = (
  questions: readonly Pick<Question, '_id' | 'chapter' | 'topic' | 'difficulty'>[],
  options: { chapter?: string; difficulty?: 'All Levels' | Question['difficulty']; count: number },
): string[] => {
  const uniqueQuestions = Array.from(new Map(
    questions
      .filter(question => question._id.trim())
      .filter(question => !options.chapter || question.chapter === options.chapter || question.topic === options.chapter)
      .filter(question => options.difficulty === 'All Levels' || question.difficulty === options.difficulty)
      .map(question => [question._id, question]),
  ).values())
  for (let index = uniqueQuestions.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[uniqueQuestions[index], uniqueQuestions[swapIndex]] = [uniqueQuestions[swapIndex], uniqueQuestions[index]]
  }
  return uniqueQuestions.slice(0, Math.max(0, options.count)).map(question => question._id)
}
