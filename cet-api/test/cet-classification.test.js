const test = require('node:test')
const assert = require('node:assert/strict')

const {
  classifyQuestion,
  classifyQuestions,
  buildAnalysis,
  getCetTaxonomy,
  canonicalSubject,
  normalizeForClassification,
  QUESTION_TYPES,
  CET_RELEVANCE_LEVELS,
  CET_DIFFICULTY_LEVELS,
  UNCLASSIFIED,
} = require('../services/cetClassification')

/** One question shaped exactly like pdfQuestionParser output. */
const parsed = (over = {}) => ({
  questionNumber: 1,
  question: '',
  options: {},
  correctAnswer: 'A',
  correctIndex: 0,
  subject: '',
  chapter: '',
  topic: '',
  difficulty: 'Medium',
  solution: '',
  confidence: 0.9,
  needsReview: false,
  reviewReason: '',
  warnings: [],
  ...over,
})

test('classifies a mathematics question into subject / chapter / topic', () => {
  const result = classifyQuestion(parsed({
    question: 'If A is a square matrix of order 3 and |A| = 5, then |adj A| is equal to:',
    options: { A: '5', B: '25', C: '125', D: '625' },
    solution: '|adj A| = |A|^(n-1) = 5^2 = 25',
  }))
  assert.equal(result.subject, 'Mathematics')
  assert.equal(result.chapter, 'Matrices')
  assert.equal(result.topic, 'Adjoint')
  assert.equal(result.cetRelevance, 'Highly Relevant')
  assert.ok(QUESTION_TYPES.includes(result.questionType))
  assert.ok(CET_DIFFICULTY_LEVELS.includes(result.cetDifficulty))
  assert.ok(result.classificationConfidence > 0.5)
})

test('classifies plural chemistry vocabulary (regression: options/solution plurals)', () => {
  const result = classifyQuestion(parsed({
    question: 'Tollens reagent test is used for the detection of:',
    options: { A: 'Aldehydes', B: 'Ketones', C: 'Alcohols', D: 'Ethers' },
    solution: 'Tollens reagent gives a silver mirror with aldehydes.',
  }))
  assert.equal(result.subject, 'Chemistry')
  assert.equal(result.chapter, 'Aldehydes, Ketones & Carboxylic Acids')
  assert.equal(result.topic, 'Aldehydes & Ketones')
})

test('classifies a numerical physics kinematics question', () => {
  const result = classifyQuestion(parsed({
    question: 'A car accelerates uniformly from rest and covers 40 m in 4 s. Its acceleration is:',
    options: { A: '5 m/s^2', B: '10 m/s^2', C: '2.5 m/s^2', D: '20 m/s^2' },
    solution: 's = ut + (1/2)at^2, so 40 = 0 + (1/2)a(16), a = 5 m/s^2.',
  }))
  assert.equal(result.subject, 'Physics')
  assert.equal(result.chapter, 'Motion in a Plane')
  assert.equal(result.questionType, 'Numerical')
})

test('classifies biology questions from option vocabulary', () => {
  const result = classifyQuestion(parsed({
    question: 'Mendel proposed the law of segregation based on his experiments on:',
    options: { A: 'Pisum sativum', B: 'Drosophila', C: 'Neurospora', D: 'Zea mays' },
    solution: 'Mendel worked on garden pea, Pisum sativum.',
  }))
  assert.equal(result.subject, 'Biology')
  assert.equal(result.chapter, 'Genetics & Evolution')
  assert.equal(result.topic, 'Mendelian Genetics')
})

test('a PDF-printed "Subject:" line wins over keyword inference', () => {
  const result = classifyQuestion(parsed({
    question: 'What is the capital of France?',
    options: { A: 'Paris', B: 'Rome', C: 'Berlin', D: 'Madrid' },
    subject: 'PHYSICS',
  }))
  assert.equal(result.subject, 'Physics')
  assert.equal(result.classificationSource, 'pdf')
  assert.equal(result.chapter, '')
})

test('a PDF-printed chapter label maps onto the syllabus taxonomy', () => {
  const result = classifyQuestion(parsed({
    question: 'If A is a square matrix of order 3 and |A| = 5, then |adj A| is equal to:',
    options: { A: '5', B: '25', C: '125', D: '625' },
    subject: 'Mathematics',
    chapter: 'Matrices',
  }))
  assert.equal(result.subject, 'Mathematics')
  assert.equal(result.chapter, 'Matrices')
  assert.equal(result.classificationSource, 'pdf')
})

test('unclassifiable questions are not forced into a subject', () => {
  const result = classifyQuestion(parsed({
    question: 'What is the capital of France?',
    options: { A: 'Paris', B: 'Rome', C: 'Berlin', D: 'Madrid' },
  }))
  assert.equal(result.subject, '')
  assert.equal(result.chapter, '')
  assert.equal(result.topic, '')
  assert.equal(result.cetRelevance, 'Not Relevant')
})

test('a PDF-printed difficulty label overrides the heuristic', () => {
  const result = classifyQuestion(parsed({
    question: 'The SI unit of force is:',
    options: { A: 'Newton', B: 'Joule', C: 'Watt', D: 'Pascal' },
    difficulty: 'Easy',
  }))
  assert.equal(result.subject, 'Physics')
  assert.equal(result.cetDifficulty, 'Easy')
})

test('classifyQuestions decorates every question and preserves parser fields', () => {
  const input = [
    parsed({
      questionNumber: 7,
      question: 'Which organelle is known as the powerhouse of the cell?',
      options: { A: 'Ribosome', B: 'Mitochondria', C: 'Lysosome', D: 'Golgi body' },
      solution: 'Mitochondria produce ATP.',
      duplicate: true,
      duplicateOfId: 'abc',
    }),
    parsed({ questionNumber: 8, question: 'What is the capital of France?', options: { A: 'Paris', B: 'Rome' } }),
  ]
  const out = classifyQuestions(input, { sourcePdf: 'Biology_Set_02.pdf' })
  assert.equal(out.length, 2)
  assert.equal(out[0].subject, 'Biology')
  assert.equal(out[0].duplicate, true)
  assert.equal(out[0].duplicateOfId, 'abc')
  assert.equal(out[0].questionNumber, 7)
  assert.equal(out[0].confidence, 0.9)
  assert.equal(out[0].sourcePdf, 'Biology_Set_02.pdf')
  assert.equal(out[1].sourcePdf, 'Biology_Set_02.pdf')
  assert.equal(out[1].subject, '')
})

test('buildAnalysis aggregates subjects, chapters, difficulty and relevance', () => {
  const questions = classifyQuestions(
    [
      parsed({ questionNumber: 1, question: 'If A is a square matrix of order 3 and |A| = 5, then |adj A| is equal to:', options: { A: '5', B: '25' } }),
      parsed({ questionNumber: 2, question: 'A car accelerates uniformly from rest and covers 40 m in 4 s. Its acceleration is:', options: { A: '5', B: '10' } }),
      parsed({ questionNumber: 3, question: 'Which organelle is known as the powerhouse of the cell?', options: { A: 'Ribosome', B: 'Mitochondria' } }),
      parsed({ questionNumber: 4, question: 'What is the capital of France?', options: { A: 'Paris', B: 'Rome' } }),
    ],
    { sourcePdf: 'Mixed.pdf' },
  )
  const analysis = buildAnalysis(questions)

  assert.equal(analysis.totalQuestions, 4)
  assert.equal(analysis.classified, 3)
  assert.equal(analysis.unclassified, 1)

  const subjectNames = analysis.subjects.map((s) => s.name)
  assert.ok(subjectNames.includes('Mathematics'))
  assert.ok(subjectNames.includes('Physics'))
  assert.ok(subjectNames.includes('Biology'))
  assert.ok(subjectNames.includes(UNCLASSIFIED))
  assert.equal(analysis.subjects.reduce((sum, s) => sum + s.count, 0), 4)

  const math = analysis.tree.find((s) => s.name === 'Mathematics')
  assert.equal(math.count, 1)
  assert.equal(math.chapters[0].name, 'Matrices')
  assert.equal(math.chapters[0].topics[0].name, 'Adjoint')
  assert.ok(Array.isArray(math.chapters[0].topics[0].subTopics))

  assert.ok(Array.isArray(analysis.difficulty) && analysis.difficulty.length > 0)
  assert.ok(Array.isArray(analysis.cetRelevance) && analysis.cetRelevance.length > 0)
  assert.ok(Array.isArray(analysis.questionTypes) && analysis.questionTypes.length > 0)
  assert.ok(analysis.chaptersBySubject.Mathematics[0].name === 'Matrices')
})

test('getCetTaxonomy exposes the dropdown structure without keywords', () => {
  const taxonomy = getCetTaxonomy()
  const subjects = taxonomy.map((s) => s.name)
  assert.deepEqual(subjects, ['Mathematics', 'Physics', 'Chemistry', 'Biology'])

  const math = taxonomy.find((s) => s.name === 'Mathematics')
  const matrices = math.chapters.find((c) => c.name === 'Matrices')
  assert.ok(matrices, 'Matrices chapter missing')
  assert.ok(matrices.topics.some((t) => t.name === 'Adjoint'))
  assert.ok(matrices.topics.every((t) => Array.isArray(t.subTopics)))
})

test('Physics taxonomy contains the requested Class 12 chapter names', () => {
  const taxonomy = getCetTaxonomy()
  const physics = taxonomy.find((subject) => subject.name === 'Physics')
  const requestedChapters = [
    'Rotational Dynamics',
    'Mechanical Properties of Fluids',
    'Kinetic Theory of Gases and Radiation',
    'Thermodynamics',
    'Oscillations',
    'Superposition of Waves',
    'Wave Optics',
    'Electrostatics',
    'Current Electricity',
    'Magnetic Fields due to Electric Current',
    'Magnetic Materials',
    'Electromagnetic Induction',
    'AC Circuits',
    'Dual Nature of Radiation and Matter',
    'Structure of Atoms and Nuclei',
    'Semiconductor Devices',
  ]

  assert.ok(physics)
  const physicsChapterNames = physics.chapters.map((chapter) => chapter.name)
  for (const chapter of requestedChapters) {
    assert.ok(physicsChapterNames.includes(chapter), `${chapter} missing from Physics`)
    assert.equal(
      taxonomy.filter((subject) => subject.name !== 'Physics')
        .some((subject) => subject.chapters.some((entry) => entry.name === chapter)),
      false,
      `${chapter} should only appear under Physics`,
    )
  }
})

test('canonicalSubject maps printed aliases to syllabus subjects', () => {
  assert.equal(canonicalSubject('Math'), 'Mathematics')
  assert.equal(canonicalSubject('MATHS'), 'Mathematics')
  assert.equal(canonicalSubject('BOTANY'), 'Biology')
  assert.equal(canonicalSubject('Zoology'), 'Biology')
  assert.equal(canonicalSubject('History'), null)
  assert.equal(canonicalSubject(''), null)
})

test('normalizeForClassification converts math symbols into words', () => {
  const out = normalizeForClassification('∫ f(x) dx = Σ xi + √9, θ = π/2')
  assert.ok(out.includes('integral'))
  assert.ok(out.includes('sigma'))
  assert.ok(out.includes('sqrt'))
  assert.ok(out.includes('theta'))
  assert.ok(out.includes('pi'))
  assert.equal(out, out.toLowerCase())
})
