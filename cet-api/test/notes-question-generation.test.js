const test = require('node:test')
const assert = require('node:assert/strict')
const JSZip = require('jszip')
const {
  callAi,
  NotesGenerationError,
  extractDocument,
  normalizeQuestion,
  planQuestions,
  matchTopicsToSyllabus,
  validateEditedQuestion,
  validateConfig,
  generateFromNotes,
} = require('../services/notesQuestionGeneration')

const slideXml = (paragraphs) => `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>${paragraphs.map((text) => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`).join('')}</p:spTree></p:cSld></p:sld>`

test('uses the configured OpenAI API key and default notes model', async () => {
 const previousApiKey = process.env.OPENAI_API_KEY
 const previousModel = process.env.NOTES_QUESTION_MODEL
 const previousFetch = global.fetch
 process.env.OPENAI_API_KEY = 'test-openai-key'
 delete process.env.NOTES_QUESTION_MODEL
 let request
 global.fetch = async (url, options) => {
   request = { url, options }
   return {
     ok: true,
     json: async () => ({ choices: [{ message: { content: '{"topics":[]}' } }] }),
   }
 }

 try {
   assert.deepEqual(await callAi('notes prompt', 'test analysis'), { topics: [] })
   assert.equal(request.url, 'https://api.openai.com/v1/chat/completions')
   assert.equal(request.options.headers.Authorization, 'Bearer test-openai-key')
   assert.equal(JSON.parse(request.options.body).model, 'gpt-4o-mini')
 } finally {
   global.fetch = previousFetch
   if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY
   else process.env.OPENAI_API_KEY = previousApiKey
   if (previousModel === undefined) delete process.env.NOTES_QUESTION_MODEL
   else process.env.NOTES_QUESTION_MODEL = previousModel
 }
})

test('reports missing OpenAI API configuration without making a request', async () => {
 const previousApiKey = process.env.OPENAI_API_KEY
 const previousFetch = global.fetch
 delete process.env.OPENAI_API_KEY
 global.fetch = async () => {
   throw new Error('fetch should not be called without a key')
 }

 try {
   await assert.rejects(
     callAi('notes prompt', 'test analysis'),
     (error) => error instanceof NotesGenerationError && error.statusCode === 503 && /OPENAI_API_KEY/.test(error.message),
   )
 } finally {
   global.fetch = previousFetch
   if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY
   else process.env.OPENAI_API_KEY = previousApiKey
 }
})

test('includes OpenAI model error details when the provider rejects a request', async () => {
 const previousApiKey = process.env.OPENAI_API_KEY
 const previousModel = process.env.NOTES_QUESTION_MODEL
 const previousFetch = global.fetch
 process.env.OPENAI_API_KEY = 'test-openai-key'
 delete process.env.NOTES_QUESTION_MODEL
 global.fetch = async () => ({
  ok: false,
  status: 404,
  text: async () => JSON.stringify({   error: { message: 'model is not available' } }),
 })

 try {
  await assert.rejects(
    callAi('notes prompt', 'test analysis'),
    /gpt-4o-mini.*HTTP 404.*model is not available/,
  )
 } finally {
  global.fetch = previousFetch
  if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = previousApiKey
  if (previousModel === undefined) delete process.env.NOTES_QUESTION_MODEL
  else process.env.NOTES_QUESTION_MODEL = previousModel
 }
})

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
    chapters: ['Cell Biology'],
    topics: ['Cell Division'],
    questionsPerBatch: 3,
    difficulty: 'Mixed',
    mixedDifficulty: { Medium: 20, Hard: 50, 'Very Hard': 30 },
    topicDistribution: { mode: 'custom', values: { Genetics: 60, 'Cell Biology': 40 } },
    generateExplanations: false,
    includeNumericalQuestions: true,
  })
  assert.equal(config.count, 20)
  assert.deepEqual(config.chapters, ['Cell Biology'])
  assert.deepEqual(config.topics, ['Cell Division'])
  assert.equal(config.questionsPerBatch, 3)
  assert.equal(config.topicDistribution.mode, 'custom')
  assert.deepEqual(config.mixedDifficulty, { Easy: 0, Medium: 20, Hard: 80 })
  assert.equal(config.generateExplanations, false)
  assert.equal(config.includeNumericalQuestions, true)

  const defaultMixedConfig = validateConfig({ subject: 'Physics', count: 10, difficulty: 'Mixed' })
  assert.deepEqual(defaultMixedConfig.mixedDifficulty, { Easy: 30, Medium: 50, Hard: 20 })

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
  }), /Easy, Medium and Hard/)
  assert.throws(() => validateConfig({
    subject: 'Biology',
    count: 101,
    difficulty: 'Hard',
  }), /between 1 and 100/)
  assert.throws(() => validateConfig({
    subject: 'Biology',
    count: 5,
    difficulty: 'Impossible',
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
  const counts = Object.fromEntries(['Easy', 'Medium', 'Hard'].map((difficulty) => [
    difficulty,
    questions.filter((question) => question.difficulty === difficulty).length,
  ]))
  assert.deepEqual(counts, { Easy: 3, Medium: 5, Hard: 2 })
  assert.equal(questions.length, config.count)
})

test('restricts question planning to the selected syllabus chapters and topics', () => {
  const config = validateConfig({
    subject: 'Physics',
    count: 5,
    difficulty: 'Easy',
    chapters: ['Chapter 2'],
    topics: ['Thermodynamics'],
  })
  const questions = planQuestions(config, [
    { name: 'Oscillations', chapterName: 'Chapter 1', syllabusTopicName: 'Oscillations', syllabusStatus: 'confirmed', subtopics: [], concepts: [], keyFacts: [], sourcePages: [1] },
    { name: 'Thermodynamics', chapterName: 'Chapter 2', syllabusTopicName: 'Thermodynamics', syllabusStatus: 'confirmed', subtopics: [], concepts: [], keyFacts: [], sourcePages: [2] },
  ], 'page')
  assert.equal(questions.length, 5)
  assert.ok(questions.every(({ topic }) => topic.name === 'Thermodynamics'))
})

test('matches topics conservatively and preserves the syllabus chapter/topic order', () => {
  const mapped = matchTopicsToSyllabus([
    { name: 'Thermodynamics', subtopics: [], concepts: [], keyFacts: [], sourcePages: [2] },
    { name: 'Unrelated notes topic', subtopics: [], concepts: [], keyFacts: [], sourcePages: [1] },
    { name: 'Oscillations', subtopics: [], concepts: [], keyFacts: [], sourcePages: [3] },
  ], [
    { name: 'Chapter 1', topics: [{ name: 'Oscillations', subtopics: [] }] },
    { name: 'Chapter 2', topics: [{ name: 'Thermodynamics', subtopics: [] }] },
  ])

  assert.deepEqual(mapped.map(({ syllabusTopicName, syllabusStatus }) => [syllabusTopicName, syllabusStatus]), [
    ['Oscillations', 'confirmed'],
    ['Thermodynamics', 'confirmed'],
    ['', 'out_of_syllabus'],
  ])
  assert.deepEqual(mapped.map(({ name }) => name), ['Oscillations', 'Thermodynamics', 'Unrelated notes topic'])
})

test('requires a separately extracted syllabus before generating questions', async () => {
  await assert.rejects(
    generateFromNotes({
      fileName: 'notes.pptx',
      rawConfig: { subject: 'Physics', count: 5, difficulty: 'Easy' },
      pages: [{ sourcePage: 1, text: 'A sufficiently long source page with useful educational notes covering concepts, examples, formulas, and explanations for students.' }],
      sourceType: 'slide',
    }),
    /official CET syllabus as a separate/,
  )
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
