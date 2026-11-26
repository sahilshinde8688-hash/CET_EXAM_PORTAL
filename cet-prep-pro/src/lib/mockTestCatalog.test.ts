// Runtime validation coverage for student mock-test catalog data and custom practice selection.
import { describe, expect, it } from 'vitest'
import type { MockTest, Question } from './api'
import {
  getMockTestCategory,
  getMockTestMaximumMarks,
  normalizeMockTestSubject,
  selectCustomPracticeQuestionIds,
} from './mockTestCatalog'

const makeTest = (overrides: Partial<MockTest> = {}): MockTest => ({
  _id: 'test-1',
  title: 'Practice set',
  subject: 'Physics',
  questions: 2,
  duration: 30,
  difficulty: 'Medium',
  status: 'active',
  attempts: 0,
  avgScore: 0,
  createdBy: 'Admin',
  createdAt: '2025-01-01T00:00:00.000Z',
  ...overrides,
})

const makeQuestion = (overrides: Partial<Question> = {}): Question => ({
  _id: 'question-1',
  subject: 'Physics',
  chapter: 'Mechanics',
  topic: 'Motion',
  text: 'Question',
  options: ['A', 'B'],
  correctIndex: 0,
  marks: 1,
  negativeMarks: 0,
  difficulty: 'Medium',
  isActive: true,
  ...overrides,
})

describe('mock test catalog metadata', () => {
  it('uses the published category rather than availability status', () => {
    expect(getMockTestCategory(makeTest({
      status: 'scheduled',
      config: { category: 'Previous Year Question Paper' },
    }))).toBe('Previous Year')
    expect(getMockTestCategory(makeTest({
      config: { category: 'Chapter-wise Test' },
    }))).toBe('Chapter-wise')
  })

  it('falls back to the real subject field for legacy tests', () => {
    expect(getMockTestCategory(makeTest({ subject: 'Mathematics' }))).toBe('Subject-wise')
    expect(getMockTestCategory(makeTest({ subject: 'PCM' }))).toBe('Full Length')
    expect(normalizeMockTestSubject('Maths')).toBe('Mathematics')
  })

  it('computes a maximum only when section marking data exists', () => {
    expect(getMockTestMaximumMarks(makeTest({
      config: {
        sections: [
          { questionIds: ['q1', 'q2'], positiveMarks: 2 },
          { questionIds: ['q3'], positiveMarks: 4 },
        ],
      },
    }))).toBe(8)
    expect(getMockTestMaximumMarks(makeTest({ config: {} }))).toBeNull()
  })
})

describe('custom practice selection', () => {
  it('selects only unique questions matching the chosen chapter and difficulty', () => {
    const questions = [
      makeQuestion({ _id: 'q1', chapter: 'Mechanics', difficulty: 'Hard' }),
      makeQuestion({ _id: 'q2', chapter: 'Mechanics', difficulty: 'Easy' }),
      makeQuestion({ _id: 'q3', chapter: 'Optics', difficulty: 'Hard' }),
      makeQuestion({ _id: 'q1', chapter: 'Mechanics', difficulty: 'Hard' }),
    ]
    const selected = selectCustomPracticeQuestionIds(questions, {
      chapter: 'Mechanics',
      difficulty: 'Hard',
      count: 10,
    })
    expect(selected).toEqual(['q1'])
  })

  it('returns an empty set when no chapter and difficulty match', () => {
    const selected = selectCustomPracticeQuestionIds(
      [makeQuestion({ chapter: 'Optics', difficulty: 'Easy' })],
      { chapter: 'Mechanics', difficulty: 'Hard', count: 10 },
    )
    expect(selected).toEqual([])
  })
})
