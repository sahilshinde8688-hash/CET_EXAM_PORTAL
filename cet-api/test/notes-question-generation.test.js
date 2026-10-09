const test = require('node:test')
const assert = require('node:assert/strict')
const JSZip = require('jszip')
const {
  extractDocument,
  normalizeQuestion,
  planQuestions,
  validateEditedQuestion,
  validateConfig,
} = require('../services/notesQuestionGeneration')

const slideXml = (paragraphs) => `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>${paragraphs.map((text) => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`).join('')}</p:spTree></p:cSld></p:sld>`

test('extracts PPTX text while retaining slide numbers and paragraph order', async () => {
  const zip = new JSZip()
  zip.file('ppt/slides/slide2.xml', slideXml(['Photosynthesis', 'Light energy is converted into chemical energy.']))
  zip.file('ppt/slides/slide1.xml', slideXml(['Cell Biology', 'Cells are the basic unit of life.']))
  const buffer = await zip.generateAsync({ type: 'nodebuffer' })

  const result = await extractDocument(buffer, 'biology.pptx')
  assert.equal(result.sourceType, 'slide')
  assert.deepEqual(result.pages.map((page) => page.sourcePage), [1, 2])
  assert.match(result.pages[0].text, /Cells are the basic unit of life/)
  assert.match(result.pages[1].text, /Light energy is converted into chemical energy/)
})

test('rejects empty PowerPoint presentations', async () => {
  const zip = new JSZip()
  zip.file('ppt/presentation.xml', '<p:presentation />')
  const buffer = await zip.generateAsync({ type: 'nodebuffer' })

  await assert.rejects(
    extractDocument(buffer, 'empty.pptx'),
    /No readable slides/,
  )
})

test('reports corrupted and unsupported note files clearly', async () => {
  await assert.rejects(extractDocument(Buffer.from('not a zip archive'), 'broken.pptx'), /corrupted/)
  await assert.rejects(extractDocument(Buffer.from('notes'), 'notes.docx'), /Unsupported file type/)
})

test('validates mixed difficulty and custom topic configuration', () => {
  const config = validateConfig({
    subject: 'Biology',
    count: 20,
    difficulty: 'Mixed',
    mixedDifficulty: { Medium: 20, Hard: 50, 'Very Hard': 30 },
    topicDistribution: { mode: 'custom', values: { Genetics: 60, 'Cell Biology': 40 } },
    generateExplanations: false,
    includeNumericalQuestions: true,
  })
  assert.equal(config.count, 20)
  assert.equal(config.topicDistribution.mode, 'custom')
  assert.deepEqual(config.mixedDifficulty, { Medium: 20, Hard: 50, 'Very Hard': 30 })
  assert.equal(config.generateExplanations, false)
  assert.equal(config.includeNumericalQuestions, true)

  const defaultMixedConfig = validateConfig({ subject: 'Physics', count: 10, difficulty: 'Mixed' })
  assert.deepEqual(defaultMixedConfig.mixedDifficulty, { Medium: 20, Hard: 50, 'Very Hard': 30 })

  assert.throws(() => validateConfig({
    subject: 'Biology',
    count: 5,
    difficulty: 'Mixed',
    mixedDifficulty: { Medium: 30, Hard: 40, 'Very Hard': 20 },
  }), /add up to 100%/)
  assert.throws(() => validateConfig({
    subject: 'Biology',
    count: 5,
    difficulty: 'Mixed',
    mixedDifficulty: { Easy: 20, Medium: 20, Hard: 50, 'Very Hard': 10 },
  }), /Medium, Hard and Very Hard/)
  assert.throws(() => validateConfig({
    subject: 'Biology',
    count: 101,
    difficulty: 'Hard',
  }), /between 1 and 100/)
  assert.throws(() => validateConfig({
    subject: 'Biology',
    count: 5,
    difficulty: 'Easy',
  }), /supported difficulty/)
  assert.throws(() => validateConfig({
    subject: 'Biology',
    count: 5,
    difficulty: 'Hard',
    includeNumericalQuestions: 'yes',
  }), /whether numerical questions/)
})

test('allocates the default mixed difficulty proportions across the whole question set', () => {
  const config = validateConfig({ subject: 'Physics', count: 10, difficulty: 'Mixed' })
  const topics = [
    { name: 'Motion', subtopics: [], concepts: ['velocity'], keyFacts: ['rate of change'], sourcePages: [1] },
    { name: 'Forces', subtopics: [], concepts: ['force'], keyFacts: ['Newton laws'], sourcePages: [2] },
  ]
  const questions = planQuestions(config, topics, 'page')
  const counts = Object.fromEntries(['Medium', 'Hard', 'Very Hard'].map((difficulty) => [
    difficulty,
    questions.filter((question) => question.difficulty === difficulty).length,
  ]))
  assert.deepEqual(counts, { Medium: 2, Hard: 5, 'Very Hard': 3 })
  assert.equal(questions.length, config.count)
})

test('rejects malformed edited MCQs before accepting them for review', async () => {
  const validation = await validateEditedQuestion({
    question: {
      subject: 'Physics',
      topic: 'Motion',
      subTopic: '',
      text: 'A sample question?',
      options: ['Same answer', 'Same answer', 'Third', 'Fourth'],
      solution: 'An explanation.',
      correctIndex: 0,
      requestedDifficulty: 'Hard',
      sourcePage: 1,
      evidence: 'This evidence is not present in the source at all.',
    },
    pages: [{ sourcePage: 1, text: 'A source page with enough content to support valid questions.' }],
    topic: { name: 'Motion', concepts: [], subtopics: [], sourcePages: [1] },
  })
  assert.ok(validation.validationIssues.includes('Options must be unique.'))
  assert.ok(validation.validationIssues.includes('The supporting excerpt is not verifiable on its source page or slide.'))
})

test('shuffles options while keeping the correct answer index aligned', () => {
  const sourcePage = 'The acceleration is proportional to the net force and inversely proportional to mass.'
  const options = ['10 m/s', '20 m/s', '30 m/s', '40 m/s']
  const results = Array.from({ length: 30 }, () => normalizeQuestion({
    text: 'Which value follows from the stated relationship?',
    options,
    correctIndex: 3,
    explanation: 'Substitute the given values into the relationship.',
    sourcePage: 1,
    evidence: sourcePage,
    supported: true,
    confidence: 0.95,
  }, {
    topic: { name: 'Forces' },
    difficulty: 'Very Hard',
  }, { subject: 'Physics' }, 'notes.pdf', 'page', [{ sourcePage: 1, text: sourcePage }]))

  results.forEach((question) => {
    assert.equal(question.options.length, 4)
    assert.equal(question.options[question.correctIndex], options[3])
    assert.equal(question.requestedDifficulty, 'Very Hard')
  })
  assert.ok(new Set(results.map((question) => question.correctIndex)).size > 1)
})
