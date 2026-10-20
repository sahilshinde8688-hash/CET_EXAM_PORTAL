const test = require('node:test')
const assert = require('node:assert/strict')
const { createQuestionHash } = require('../utils/questionHash')

const baseQuestion = {
  subject: 'Mathematics',
  chapter: 'Matrices - Formation and Basic',
  topic: 'Matrices',
  text: 'Solve.',
  options: ['1', '2', '3', '4'],
  correctIndex: 1,
  solution: 'x = 2',
}

test('creates a stable hash for the same complete question', () => {
  assert.equal(createQuestionHash(baseQuestion), createQuestionHash({ ...baseQuestion }))
})

test('allows a generic stem when its image or answers distinguish the question', () => {
  const withDifferentImage = { ...baseQuestion, imageUrl: 'https://example.test/matrix-a.png' }
  const withAnotherImage = { ...baseQuestion, imageUrl: 'https://example.test/matrix-b.png' }
  const withDifferentOptions = { ...baseQuestion, options: ['5', '6', '7', '8'] }

  assert.notEqual(createQuestionHash(withDifferentImage), createQuestionHash(withAnotherImage))
  assert.notEqual(createQuestionHash(baseQuestion), createQuestionHash(withDifferentOptions))
})

test('keeps equivalent text and reordered options stable when the correct answer is unchanged', () => {
  const reorderedOptions = {
    ...baseQuestion,
    text: '  SOLVE ',
    options: ['4', '3', '2', '1'],
    correctIndex: 2,
  }

  assert.equal(createQuestionHash(baseQuestion), createQuestionHash(reorderedOptions))
})

test('ignores rich-text tags when fingerprinting question meaning', () => {
  const plain = { ...baseQuestion, text: 'Find x²', options: ['1', '2', '3', '4'] }
  const formatted = { ...plain, text: '<p>Find x<sup>2</sup></p>' }
  assert.equal(createQuestionHash(plain), createQuestionHash(formatted))
  assert.notEqual(createQuestionHash(plain), createQuestionHash({ ...plain, text: 'Find x₂' }))
})

test('returns null for questions without a usable text fingerprint', () => {
  assert.equal(createQuestionHash({ ...baseQuestion, text: '... —' }), null)
})
