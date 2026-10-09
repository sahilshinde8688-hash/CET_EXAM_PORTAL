const bcrypt = require('bcryptjs')
const supabase = require('../config/supabase')
const { getEffectiveAdminRole } = require('../utils/adminRoles')
const {
  DEFAULT_SESSION_INACTIVITY_TIMEOUT_SECONDS,
  SESSION_INACTIVITY_TIMEOUT_SECONDS,
} = require('../config/auth')

let sessionTimeoutCache = null
const SESSION_TIMEOUT_CACHE_MS = 30 * 1000

const getSessionInactivityTimeoutSeconds = async () => {
  if (sessionTimeoutCache && sessionTimeoutCache.expiresAt > Date.now()) {
    return sessionTimeoutCache.value
  }

  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'session_timeout')
    .maybeSingle()
  if (error) throw error

  const timeoutMinutes = Number(data?.value)
  const timeoutSeconds = Number.isSafeInteger(timeoutMinutes) && timeoutMinutes >= 1 && timeoutMinutes <= 1440
    ? timeoutMinutes * 60
    : (SESSION_INACTIVITY_TIMEOUT_SECONDS || DEFAULT_SESSION_INACTIVITY_TIMEOUT_SECONDS)
  sessionTimeoutCache = { value: timeoutSeconds, expiresAt: Date.now() + SESSION_TIMEOUT_CACHE_MS }
  return timeoutSeconds
}

const invalidateSessionTimeoutCache = () => {
  sessionTimeoutCache = null
}

// Map SQL camelCase conversion helpers
const userToCamel = (row) => {
  if (!row) return null
  return {
    _id: row.id,
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    password: row.password, // internal only, stripped before client responses
    branch: row.branch,
    batch: row.batch,
    examType: row.exam_type || null,
    role: row.role,
    adminRole: getEffectiveAdminRole({ role: row.role, email: row.email, adminRole: row.admin_role }),
    status: row.status,
    mhcetId: row.mhcet_id,
    photo: row.photo,
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
    rejectionReason: row.rejection_reason,
    mustResetPassword: row.must_reset_password,
    mhcetPassword: row.mhcet_password,
    isLocked: Boolean(row.is_locked),
    lockedReason: row.locked_reason || null,
    lockedAt: row.locked_at || null,
    lockedBy: row.locked_by || null,
    clusterId: row.cluster_id || 'default',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const questionToCamel = (row) => {
  if (!row) return null
  return {
    _id: row.id,
    id: row.id,
    subject: row.subject,
    chapter: row.chapter,
    topic: row.topic,
    subTopic: row.sub_topic,
    text: row.text,
    imageUrl: row.image_url,
    options: row.options || [],
    correctIndex: row.correct_index,
    solution: row.solution,
    marks: row.marks !== null && row.marks !== undefined ? Number(row.marks) : 2,
    negativeMarks: row.negative_marks !== null && row.negative_marks !== undefined ? Number(row.negative_marks) : 0,
    difficulty: row.difficulty,
    // MHT-CET classification (PDF import pipeline; '' = not classified)
    questionType: row.question_type || '',
    cetDifficulty: row.cet_difficulty || '',
    cetRelevance: row.cet_relevance || '',
    classificationConfidence:
      row.classification_confidence !== null && row.classification_confidence !== undefined
        ? Number(row.classification_confidence)
        : null,
    classificationSource: row.classification_source || '',
    sourcePdf: row.source_pdf || '',
    sourcePage: row.source_page || null,
    sourceQuestionNumber: row.source_question_number || null,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const sanitizeQuestion = (q) => {
  if (!q) return null
  const { solution, correctIndex, ...safeQuestion } = q
  return {
    ...safeQuestion,
    marks: Number(q.marks ?? 2),
    negativeMarks: Number(q.negativeMarks ?? 0),
  }
}

const mockTestToCamel = (row) => {
  if (!row) return null
  return {
    _id: row.id,
    id: row.id,
    title: row.title,
    subject: row.subject,
    examType: row.exam_type || null,
    questions: row.questions,
    duration: row.duration,
    difficulty: row.difficulty,
    status: row.status,
    maxAttempts: row.max_attempts || 1,
    attempts: row.attempts,
    avgScore: row.avg_score ? Number(row.avg_score) : 0,
    scheduledDate: row.scheduled_date,
    createdBy: row.created_by,
    questionIds: row.question_ids || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const testResultToCamel = (row) => {
  if (!row) return null
  return {
    _id: row.id,
    id: row.id,
    userId: row.user_id,
    mockTestId: row.mock_test_id || null,
    testName: row.test_name,
    subject: row.subject,
    score: row.score ? Number(row.score) : 0,
    totalMarks: row.total_marks ? Number(row.total_marks) : 0,
    percentile: row.percentile ? Number(row.percentile) : null,
    duration: row.duration,
    attemptedAt: row.attempted_at,
    correct: row.correct,
    incorrect: row.incorrect,
    unanswered: row.unanswered,
    totalQuestions: row.total_questions,
    subjectWiseScores: row.subject_wise_scores || [],
    answers: row.answers || {},
    questionIds: row.question_ids || [],
    mockTestAttemptId: row.mock_test_attempt_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ---------------- USER OPERATIONS ----------------
const pendingMemoryStore = new Map()
const approvedMemoryStore = new Map()

const findUserById = async (id) => {
  if (!id) return null

  try {
    const { data, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle()
    if (!error && data) return userToCamel(data)
  } catch {}

  for (const u of approvedMemoryStore.values()) {
    if (u.id === id || u._id === id || u.email === id) return u
  }
  for (const u of pendingMemoryStore.values()) {
    if (u.id === id || u._id === id || u.email === id) return u
  }

  return null
}

const findUserByEmail = async (email) => {
  if (!email) return null
  const cleanEmail = email.toLowerCase().trim()

  const { data, error } = await supabase.from('users').select('*').eq('email', cleanEmail).maybeSingle()
  if (error) throw error
  if (data) return userToCamel(data)

  if (approvedMemoryStore.has(cleanEmail)) return approvedMemoryStore.get(cleanEmail)
  if (pendingMemoryStore.has(cleanEmail)) return pendingMemoryStore.get(cleanEmail)

  return null
}

const findUserByMhcetId = async (mhcetId) => {
  if (!mhcetId) return null
  const cleanId = mhcetId.toUpperCase().trim()

  const { data, error } = await supabase.from('users').select('*').eq('mhcet_id', cleanId).maybeSingle()
  if (error) throw error
  if (data) return userToCamel(data)

  for (const user of approvedMemoryStore.values()) {
    if (user.mhcetId && user.mhcetId.toUpperCase() === cleanId) {
      return user
    }
  }

  return null
}

const createUser = async (userData) => {
  const cleanEmail = userData.email?.toLowerCase().trim()
  const insertPayload = {
    ...(userData.id ? { id: userData.id } : {}),
    name: userData.name,
    email: cleanEmail,
    phone: userData.phone || null,
    password: userData.password || null, // expects pre-hashed password if present
    branch: userData.branch,
    batch: Number(userData.batch),
    role: userData.role || 'student',
    status: userData.status || 'pending',
    mhcet_id: userData.mhcetId || null,
    mhcet_password: userData.mhcetPassword || null,
    photo: userData.photo || null,
    must_reset_password: userData.mustResetPassword || false,
  }

  try {
    const { data, error } = await supabase.from('users').insert(insertPayload).select().single()
    if (error) throw error
    if (data) {
      const created = userToCamel(data)
      if (created.status === 'approved') approvedMemoryStore.set(cleanEmail, created)
      else pendingMemoryStore.set(cleanEmail, created)
      return created
    }
    throw new Error('Supabase did not return the created user')
  } catch (err) {
    throw err
  }
}

const updateUser = async (id, updates) => {
  // 1. Locate existing user data
  let existingUser = await findUserById(id)

  const cleanEmail = (updates.email || existingUser?.email || '').toLowerCase().trim()

  const updatedUserObj = {
    ...existingUser,
    ...updates,
    id: existingUser?.id || id,
    _id: existingUser?.id || id,
    email: cleanEmail,
    name: updates.name !== undefined ? updates.name : existingUser?.name || '',
    phone: updates.phone !== undefined ? updates.phone : existingUser?.phone || null,
    branch: updates.branch !== undefined ? updates.branch : existingUser?.branch || 'Byculla',
    batch: updates.batch !== undefined ? Number(updates.batch) : existingUser?.batch || 2024,
    examType: updates.examType !== undefined ? updates.examType : existingUser?.examType || null,
    role: updates.role !== undefined ? updates.role : existingUser?.role || 'student',
    status: updates.status !== undefined ? updates.status : existingUser?.status || 'approved',
    mhcetId: updates.mhcetId !== undefined ? updates.mhcetId : existingUser?.mhcetId || null,
    mhcetPassword: updates.mhcetPassword !== undefined ? updates.mhcetPassword : existingUser?.mhcetPassword || null,
    photo: updates.photo !== undefined ? updates.photo : existingUser?.photo || null,
    mustResetPassword:
      updates.mustResetPassword !== undefined ? updates.mustResetPassword : existingUser?.mustResetPassword ?? false,
    approvedAt: updates.approvedAt !== undefined ? updates.approvedAt : existingUser?.approvedAt || null,
  }

  // Remove from pending memory store if approving
  if (pendingMemoryStore.has(cleanEmail)) {
    pendingMemoryStore.delete(cleanEmail)
  }
  for (const [k, v] of pendingMemoryStore.entries()) {
    if (v.id === id || v._id === id) pendingMemoryStore.delete(k)
  }

  if (updatedUserObj.status === 'approved') {
    approvedMemoryStore.set(cleanEmail, updatedUserObj)
    if (updatedUserObj.mhcetId) {
      approvedMemoryStore.set(updatedUserObj.mhcetId.toUpperCase(), updatedUserObj)
    }
  }

  // Persist into Supabase DB 'users' table
  try {
    const updatePayload = {
      name: updatedUserObj.name,
      email: cleanEmail,
      phone: updatedUserObj.phone || null,
      branch: updatedUserObj.branch,
      batch: Number(updatedUserObj.batch),
      exam_type: updatedUserObj.examType || null,
      role: updatedUserObj.role,
      status: updatedUserObj.status,
      mhcet_id: updatedUserObj.mhcetId || null,
      mhcet_password: updatedUserObj.mhcetPassword || null,
      photo: updatedUserObj.photo || null,
      approved_at: updatedUserObj.approvedAt || null,
      must_reset_password: Boolean(updatedUserObj.mustResetPassword),
      updated_at: new Date().toISOString(),
    }
    if (updates.password) {
      updatePayload.password = updates.password // Must be hashed before calling updateUser
    }

    const { data: updatedDbData, error: updateErr } = await supabase
      .from('users')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .maybeSingle()

    if (!updateErr && updatedDbData) {
      const camel = userToCamel(updatedDbData)
      approvedMemoryStore.set(cleanEmail, camel)
      return camel
    } else if (updateErr) {
      throw updateErr
    }

    return updatedUserObj
  } catch (err) {
    console.warn('Supabase DB sync exception in updateUser:', err.message)
    throw err
  }
}

const deleteUser = async (id) => {
  let userEmail = null
  for (const [k, v] of pendingMemoryStore.entries()) {
    if (v.id === id || v._id === id || v.email === id) {
      userEmail = v.email
      pendingMemoryStore.delete(k)
    }
  }
  for (const [k, v] of approvedMemoryStore.entries()) {
    if (v.id === id || v._id === id || v.email === id) {
      userEmail = v.email
      approvedMemoryStore.delete(k)
    }
  }

  try {
    const { data } = await supabase.from('users').delete().eq('id', id).select().maybeSingle()
    if (data) return userToCamel(data)
  } catch {}

  return { id, message: 'User deleted' }
}

const getAllUsers = async (filters = {}) => {
  let dbUsers = []
  let query = supabase.from('users').select('*').order('created_at', { ascending: false })
  if (filters.status) query = query.ilike('status', String(filters.status))
  if (filters.role) query = query.ilike('role', String(filters.role))
  if (filters.branch) query = query.eq('branch', filters.branch)
  if (filters.batch) query = query.eq('batch', filters.batch)

  const { data, error } = await query
  if (error) throw error
  if (data) dbUsers = data.map(userToCamel)

  const map = new Map()

  dbUsers.forEach((u) => {
    if (u && u.email) map.set(u.email.toLowerCase(), u)
  })

  approvedMemoryStore.forEach((u) => {
    if (!filters.status || String(u.status || '').toLowerCase() === String(filters.status).toLowerCase()) {
      if (!filters.role || String(u.role || '').toLowerCase() === String(filters.role).toLowerCase()) {
        if (!map.has(u.email.toLowerCase())) {
          map.set(u.email.toLowerCase(), u)
        }
      }
    }
  })

  pendingMemoryStore.forEach((u) => {
    if (!filters.status || String(u.status || '').toLowerCase() === String(filters.status).toLowerCase()) {
      if (!filters.role || String(u.role || '').toLowerCase() === String(filters.role).toLowerCase()) {
        if (!map.has(u.email.toLowerCase())) {
          map.set(u.email.toLowerCase(), u)
        }
      }
    }
  })

  return Array.from(map.values())
}

const getApprovedStudentsForAssignment = async () => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .ilike('role', 'student')
    .ilike('status', 'approved')
  if (error) throw error
  return (data || []).map(userToCamel)
}


// ---------------- SESSION OPERATIONS ----------------
const createSession = async (sessionData) => {
  if (!sessionData?.userId) return null
  const userExists = await findUserById(sessionData.userId)
  if (!userExists) return null

  const payload = {
    session_id: sessionData.sessionId,
    user_id: sessionData.userId,
    device_name: sessionData.deviceName || 'Unknown Device',
    browser: sessionData.browser || 'Unknown Browser',
    operating_system: sessionData.operatingSystem || 'Unknown OS',
    ip_address: sessionData.ipAddress || 'Unknown IP',
    country: sessionData.country || '',
    last_activity: sessionData.lastActivity || new Date().toISOString(),
    expires_at: sessionData.expiresAt,
    is_current: sessionData.isCurrent !== undefined ? sessionData.isCurrent : true,
  }
  const { data, error } = await supabase.from('sessions').insert(payload).select().single()
  if (error) throw error
  return data
}

const findSessionById = async (sessionId) => {
  const { data, error } = await supabase.from('sessions').select('*').eq('session_id', sessionId).single()
  if (error || !data) return null
  return data
}

const updateSession = async (sessionId, updates) => {
  const { data, error } = await supabase.from('sessions').update(updates).eq('session_id', sessionId).select().single()
  if (error) throw error
  return data
}

const deleteSession = async (sessionId) => {
  const { data, error } = await supabase.from('sessions').delete().eq('session_id', sessionId)
  if (error) throw error
  return data
}

const deleteUserSessions = async (userId) => {
  const { data, error } = await supabase.from('sessions').delete().eq('user_id', userId)
  if (error) throw error
  return data
}

const getUserSessions = async (userId) => {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId)
    .order('login_at', { ascending: false })
  if (error) throw error
  return data || []
}

// ---------------- REFRESH TOKEN OPERATIONS ----------------
const createRefreshToken = async (tokenData) => {
  if (!tokenData?.userId) return null
  const userExists = await findUserById(tokenData.userId)
  if (!userExists) return null

  const payload = {
    user_id: tokenData.userId,
    session_id: tokenData.sessionId,
    token_hash: tokenData.tokenHash,
    device_name: tokenData.deviceName || 'Unknown Device',
    browser: tokenData.browser || 'Unknown Browser',
    operating_system: tokenData.operatingSystem || 'Unknown OS',
    ip_address: tokenData.ipAddress || 'Unknown IP',
    country: tokenData.country || '',
    expires_at: tokenData.expiresAt,
  }
  const { data, error } = await supabase.from('refresh_tokens').insert(payload).select().single()
  if (error) throw error
  return data
}

const findRefreshTokenByHash = async (tokenHash) => {
  const { data, error } = await supabase.from('refresh_tokens').select('*').eq('token_hash', tokenHash).single()
  if (error || !data) return null
  return data
}

const updateRefreshToken = async (id, updates) => {
  const { data, error } = await supabase.from('refresh_tokens').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}

const revokeUserRefreshTokens = async (userId) => {
  const { data, error } = await supabase
    .from('refresh_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
  if (error) throw error
  return data
}

// ---------------- LOGIN HISTORY OPERATIONS ----------------
const createLoginHistory = async (historyData) => {
  if (historyData?.userId) {
    const userExists = await findUserById(historyData.userId)
    if (!userExists) return null
  }

  const payload = {
    user_id: historyData.userId,
    session_id: historyData.sessionId || '',
    event: historyData.event,
    ip_address: historyData.ipAddress || '',
    user_agent: historyData.userAgent || '',
    browser: historyData.browser || '',
    operating_system: historyData.operatingSystem || '',
    device_name: historyData.deviceName || '',
    country: historyData.country || '',
    metadata: historyData.metadata || {},
  }
  const { data, error } = await supabase.from('login_history').insert(payload).select().single()
  if (error) console.error('Failed to log login history:', error.message)
  return data
}

// ---------------- QUESTION OPERATIONS ----------------
const getQuestions = async (filters = {}, { isAdmin = false } = {}) => {
  let query = supabase.from('questions').select('*').order('created_at', { ascending: false })
  if (filters.subject) query = query.eq('subject', filters.subject)
  if (filters.topic) query = query.eq('topic', filters.topic)
  if (filters.difficulty) query = query.eq('difficulty', filters.difficulty)
  if (filters.isActive !== undefined) query = query.eq('is_active', filters.isActive)
  if (Array.isArray(filters.ids) && filters.ids.length) query = query.in('id', filters.ids)

  const { data, error } = await query
  if (error) throw error
  const rawList = (data || []).map(questionToCamel)
  if (isAdmin) {
    return rawList
  }
  return rawList.map(sanitizeQuestion)
}

const getQuestionById = async (id, { isAdmin = false } = {}) => {
  const { data, error } = await supabase.from('questions').select('*').eq('id', id).single()
  if (error || !data) return null
  const q = questionToCamel(data)
  return isAdmin ? q : sanitizeQuestion(q)
}

const createQuestion = async (qData) => {
  const payload = {
    subject: qData.subject,
    chapter: qData.chapter || '',
    topic: qData.topic || qData.chapter || 'General',
    sub_topic: qData.subTopic || '',
    text: qData.text,
    image_url: qData.imageUrl || '',
    options: qData.options || [],
    correct_index: Number(qData.correctIndex),
    solution: qData.solution || '',
    marks: qData.marks !== undefined ? Number(qData.marks) : 2,
    negative_marks: qData.negativeMarks !== undefined ? Number(qData.negativeMarks) : 0.5,
    difficulty: qData.difficulty || 'Medium',
    question_type: qData.questionType || '',
    cet_difficulty: qData.cetDifficulty || '',
    cet_relevance: qData.cetRelevance || '',
    classification_confidence: qData.classificationConfidence ?? null,
    classification_source: qData.classificationSource || '',
    source_pdf: qData.sourcePdf || '',
    source_page: qData.sourcePage ?? null,
    source_question_number: qData.sourceQuestionNumber ?? null,
    is_active: qData.isActive !== undefined ? qData.isActive : true,
  }
  const { data, error } = await supabase.from('questions').insert(payload).select().single()
  if (error) throw error
  return questionToCamel(data)
}

const updateQuestion = async (id, updates) => {
  const payload = {}
  if (updates.subject !== undefined) payload.subject = updates.subject
  if (updates.chapter !== undefined) payload.chapter = updates.chapter
  if (updates.topic !== undefined) payload.topic = updates.topic
  if (updates.subTopic !== undefined) payload.sub_topic = updates.subTopic
  if (updates.text !== undefined) payload.text = updates.text
  if (updates.imageUrl !== undefined) payload.image_url = updates.imageUrl
  if (updates.options !== undefined) payload.options = updates.options
  if (updates.correctIndex !== undefined) payload.correct_index = Number(updates.correctIndex)
  if (updates.solution !== undefined) payload.solution = updates.solution
  if (updates.marks !== undefined) payload.marks = Number(updates.marks)
  if (updates.negativeMarks !== undefined) payload.negative_marks = Number(updates.negativeMarks)
  if (updates.difficulty !== undefined) payload.difficulty = updates.difficulty
  if (updates.questionType !== undefined) payload.question_type = updates.questionType
  if (updates.cetDifficulty !== undefined) payload.cet_difficulty = updates.cetDifficulty
  if (updates.cetRelevance !== undefined) payload.cet_relevance = updates.cetRelevance
  if (updates.classificationConfidence !== undefined) payload.classification_confidence = updates.classificationConfidence
  if (updates.classificationSource !== undefined) payload.classification_source = updates.classificationSource
  if (updates.sourcePdf !== undefined) payload.source_pdf = updates.sourcePdf
  if (updates.sourcePage !== undefined) payload.source_page = updates.sourcePage
  if (updates.sourceQuestionNumber !== undefined) payload.source_question_number = updates.sourceQuestionNumber
  if (updates.isActive !== undefined) payload.is_active = updates.isActive
  payload.updated_at = new Date().toISOString()

  const { data, error } = await supabase.from('questions').update(payload).eq('id', id).select().single()
  if (error) throw error
  return questionToCamel(data)
}

const deleteQuestion = async (id) => {
  const { data, error } = await supabase.from('questions').delete().eq('id', id).select().single()
  if (error) throw error
  return questionToCamel(data)
}

/**
 * Lightweight id+text list used by import duplicate detection.
 * Only fetches the columns needed for fingerprinting.
 */
const getQuestionFingerprints = async () => {
  const { data, error } = await supabase
    .from('questions')
    .select('id, text')
    .order('created_at', { ascending: false })
    .limit(20000)
  if (error) throw error
  return (data || []).map((row) => ({ id: row.id, text: row.text || '' }))
}

// ---------------- MOCK TEST OPERATIONS ----------------
const getMockTests = async (filters = {}) => {
  let query = supabase.from('mock_tests').select('*').order('created_at', { ascending: false })
  if (filters.subject) query = query.eq('subject', filters.subject)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.difficulty) query = query.eq('difficulty', filters.difficulty)

  const { data, error } = await query
  if (error) throw error
  return (data || []).map(mockTestToCamel)
}

const getMockTestById = async (id) => {
  const { data, error } = await supabase.from('mock_tests').select('*').eq('id', id).single()
  if (error || !data) return null
  return mockTestToCamel(data)
}

const getActiveMockTestByTitle = async (title) => {
  const { data, error } = await supabase
    .from('mock_tests')
    .select('*')
    .eq('title', title)
    .eq('status', 'active')
    .limit(2)
  if (error) throw error
  if (data?.length > 1) {
    const ambiguous = new Error('A mock test ID is required for tests with duplicate active titles.')
    ambiguous.code = 'MOCK_TEST_ID_REQUIRED'
    throw ambiguous
  }
  return data?.length ? mockTestToCamel(data[0]) : null
}

const createMockTest = async (testData) => {
  const payload = {
    title: testData.title,
    subject: testData.subject,
    exam_type: testData.examType || null,
    questions: Number(testData.questions),
    duration: Number(testData.duration),
    difficulty: testData.difficulty,
    status: testData.status || 'draft',
    max_attempts: Number(testData.maxAttempts) || 1,
    attempts: testData.attempts || 0,
    avg_score: testData.avgScore || 0,
    scheduled_date: testData.scheduledDate || null,
    created_by: testData.createdBy || null,
    question_ids: testData.questionIds || [],
  }
  const { data, error } = await supabase.from('mock_tests').insert(payload).select().single()
  if (error) throw error
  return mockTestToCamel(data)
}

const updateMockTest = async (id, updates) => {
  const payload = {}
  if (updates.title !== undefined) payload.title = updates.title
  if (updates.subject !== undefined) payload.subject = updates.subject
  if (updates.examType !== undefined) payload.exam_type = updates.examType || null
  if (updates.questions !== undefined) payload.questions = Number(updates.questions)
  if (updates.duration !== undefined) payload.duration = Number(updates.duration)
  if (updates.difficulty !== undefined) payload.difficulty = updates.difficulty
  if (updates.status !== undefined) payload.status = updates.status
  if (updates.maxAttempts !== undefined) payload.max_attempts = Number(updates.maxAttempts)
  if (updates.attempts !== undefined) payload.attempts = Number(updates.attempts)
  if (updates.avgScore !== undefined) payload.avg_score = Number(updates.avgScore)
  if (updates.scheduledDate !== undefined) payload.scheduled_date = updates.scheduledDate
  if (updates.createdBy !== undefined) payload.created_by = updates.createdBy
  if (updates.questionIds !== undefined) payload.question_ids = updates.questionIds
  payload.updated_at = new Date().toISOString()

  const { data, error } = await supabase.from('mock_tests').update(payload).eq('id', id).select().single()
  if (error) throw error
  return mockTestToCamel(data)
}

const deleteMockTest = async (id) => {
  const { data, error } = await supabase.from('mock_tests').delete().eq('id', id).select().single()
  if (error) throw error
  return mockTestToCamel(data)
}

// ---------------- MOCK TEST ASSIGNMENTS & ATTEMPTS ----------------
const assignmentToCamel = (row) => {
  if (!row) return row
  const startTime = Date.parse(row.starts_at)
  const endTime = Date.parse(row.ends_at)
  const schedulingStatus = row.scheduling_status || (row.status !== 'active'
    ? 'cancelled'
    : row.visibility === 'draft'
      ? 'draft'
      : endTime <= Date.now()
        ? 'expired'
        : startTime <= Date.now()
          ? 'active'
          : 'scheduled')

  return {
    _id: row.id,
    mockTestId: row.mock_test_id,
    mockTestName: row.mock_test_name,
    assignedTo: row.assigned_to,
    studentIds: row.student_ids || [],
    batchId: row.batch_id,
    branch: row.branch,
    examType: row.exam_type,
    startDateTime: row.starts_at,
    endDateTime: row.ends_at,
    timeZone: row.time_zone || 'Asia/Kolkata',
    schedulingStatus,
    activatedAt: row.activated_at || null,
    expiredAt: row.expired_at || null,
    duration: row.duration,
    attemptLimit: row.attempt_limit,
    visibility: row.visibility,
    resultVisibility: row.result_visibility,
    randomizeQuestions: row.randomize_questions,
    randomizeOptions: row.randomize_options,
    allowBackNavigation: row.allow_back_navigation,
    allowResume: row.allow_resume,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const attemptToCamel = (row) => row && ({
  _id: row.id,
  assignmentId: row.assignment_id,
  mockTestId: row.mock_test_id,
  studentId: row.student_id,
  startedAt: row.started_at,
  submittedAt: row.submitted_at,
  status: row.status,
  attemptNumber: row.attempt_number,
  score: row.score === null ? null : Number(row.score),
  totalMarks: Number(row.total_marks),
  answers: row.answers || {},
  timeSpent: row.time_spent || 0,
  questionIds: row.question_ids || [],
  optionOrders: row.option_orders || {},
  resultId: row.result_id,
})

const createMockTestAssignment = async (data) => {
  const payload = {
    mock_test_id: data.mockTestId,
    mock_test_name: data.mockTestName,
    assigned_to: data.assignedTo,
    student_ids: data.studentIds,
    batch_id: data.batchId || null,
    branch: data.branch || null,
    exam_type: data.examType || null,
    starts_at: data.startDateTime,
    ends_at: data.endDateTime,
    duration: Number(data.duration),
    attempt_limit: data.attemptLimit,
    visibility: data.visibility,
    result_visibility: data.resultVisibility,
    randomize_questions: Boolean(data.randomizeQuestions),
    randomize_options: Boolean(data.randomizeOptions),
    allow_back_navigation: Boolean(data.allowBackNavigation),
    allow_resume: Boolean(data.allowResume),
    created_by: data.createdBy,
  }
  const { data: response, error } = await supabase.rpc('create_mock_test_assignment', {
    p_assignment: payload,
    p_allow_duplicate: data.allowDuplicateAssignment === true,
  })
  if (error) throw error
  const row = Array.isArray(response) ? response[0] : response
  if (!row) return null
  if (data.timeZone) {
    const { data: updated, error: updateError } = await supabase
      .from('mock_test_assignments')
      .update({ time_zone: data.timeZone })
      .eq('id', row.id)
      .select()
      .single()
    if (updateError) throw updateError
    return assignmentToCamel(updated)
  }
  return assignmentToCamel(row)
}

const getMockTestAssignments = async () => {
  const { data, error } = await supabase.from('mock_test_assignments').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map(assignmentToCamel)
}

const getMockTestAssignmentsToProcess = async () => {
  const { data, error } = await supabase
    .from('mock_test_assignments')
    .select('*')
    .eq('status', 'active')
    .neq('visibility', 'draft')
    .in('scheduling_status', ['scheduled', 'active', 'expired'])
    .order('starts_at', { ascending: true })
  if (error) throw error
  return (data || []).map(assignmentToCamel)
}

const activateDueScheduledMockTests = async (now = new Date()) => {
  const { data, error } = await supabase
    .from('mock_tests')
    .update({ status: 'active', updated_at: now.toISOString() })
    .eq('status', 'scheduled')
    .lte('scheduled_date', now.toISOString())
    .select('id, title, scheduled_date')
  if (error) throw error
  return data || []
}

const activateScheduledMockTest = async (id, now = new Date()) => {
  const { data, error } = await supabase
    .from('mock_tests')
    .update({ status: 'active', updated_at: now.toISOString() })
    .eq('id', id)
    .eq('status', 'scheduled')
    .lte('scheduled_date', now.toISOString())
    .select('id, title, scheduled_date')
    .maybeSingle()
  if (error) throw error
  return data || null
}

const transitionMockTestAssignment = async (id, expectedStatus, updates, expectedWindow) => {
  const payload = { updated_at: new Date().toISOString() }
  const mapping = {
    visibility: 'visibility',
    schedulingStatus: 'scheduling_status',
    activatedAt: 'activated_at',
    expiredAt: 'expired_at',
  }
  for (const [key, column] of Object.entries(mapping)) {
    if (updates[key] !== undefined) payload[column] = updates[key]
  }
  let query = supabase
    .from('mock_test_assignments')
    .update(payload)
    .eq('id', id)
    .eq('scheduling_status', expectedStatus)
    .eq('status', 'active')
  if (expectedWindow) {
    query = query
      .eq('starts_at', expectedWindow.startDateTime)
      .eq('ends_at', expectedWindow.endDateTime)
  }
  const { data, error } = await query
    .select()
    .maybeSingle()
  if (error) throw error
  return assignmentToCamel(data)
}

const getExpiredMockTestAttemptsNeedingEvaluation = async () => {
  const { data, error } = await supabase
    .from('mock_test_attempts')
    .select('*')
    .eq('status', 'expired')
    .is('result_id', null)
    .order('submitted_at', { ascending: true })
    .limit(100)
  if (error) throw error
  return (data || []).map(attemptToCamel)
}

const getMockTestAssignmentById = async (id) => {
  const { data, error } = await supabase.from('mock_test_assignments').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return assignmentToCamel(data)
}

const updateMockTestAssignment = async (id, updates, expectedSchedule) => {
  const payload = { updated_at: new Date().toISOString() }
  const mapping = {
    studentIds: 'student_ids',
    assignedTo: 'assigned_to',
    batchId: 'batch_id',
    branch: 'branch',
    examType: 'exam_type',
    startDateTime: 'starts_at',
    endDateTime: 'ends_at',
    timeZone: 'time_zone',
    schedulingStatus: 'scheduling_status',
    activatedAt: 'activated_at',
    expiredAt: 'expired_at',
    attemptLimit: 'attempt_limit',
    visibility: 'visibility',
    resultVisibility: 'result_visibility',
    randomizeQuestions: 'randomize_questions',
    randomizeOptions: 'randomize_options',
    allowBackNavigation: 'allow_back_navigation',
    allowResume: 'allow_resume',
    status: 'status',
  }
  for (const [key, column] of Object.entries(mapping)) {
    if (updates[key] !== undefined) payload[column] = updates[key]
  }
  let query = supabase.from('mock_test_assignments').update(payload).eq('id', id)
  if (expectedSchedule) {
    query = query
      .eq('scheduling_status', expectedSchedule.schedulingStatus)
      .eq('starts_at', expectedSchedule.startDateTime)
      .eq('ends_at', expectedSchedule.endDateTime)
  }
  const { data, error } = await query.select().maybeSingle()
  if (error) throw error
  return assignmentToCamel(data)
}

const getMockTestAttempts = async (assignmentId, studentId) => {
  let query = supabase.from('mock_test_attempts').select('*').eq('assignment_id', assignmentId).order('started_at', { ascending: false })
  if (studentId) query = query.eq('student_id', studentId)
  const { data, error } = await query
  if (error) throw error
  return (data || []).map(attemptToCamel)
}

const deleteMockTestAssignment = async (id) => {
  const { data, error } = await supabase
    .from('mock_test_assignments')
    .delete()
    .eq('id', id)
    .select()
    .maybeSingle()
  if (error) throw error
  return assignmentToCamel(data)
}

const getMockTestAttemptById = async (id) => {
  const { data, error } = await supabase.from('mock_test_attempts').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return attemptToCamel(data)
}

const createMockTestAttempt = async (data) => {
  const { data: row, error } = await supabase.from('mock_test_attempts').insert({
    assignment_id: data.assignmentId,
    mock_test_id: data.mockTestId,
    student_id: data.studentId,
    attempt_number: data.attemptNumber,
    total_marks: data.totalMarks,
    question_ids: data.questionIds,
    option_orders: data.optionOrders || {},
  }).select().single()
  if (error) throw error
  return attemptToCamel(row)
}

const updateMockTestAttempt = async (id, updates) => {
  const payload = { updated_at: new Date().toISOString() }
  if (updates.answers !== undefined) payload.answers = updates.answers
  if (updates.timeSpent !== undefined) payload.time_spent = updates.timeSpent
  if (updates.status !== undefined) payload.status = updates.status
  if (updates.submittedAt !== undefined) payload.submitted_at = updates.submittedAt
  if (updates.score !== undefined) payload.score = updates.score
  if (updates.resultId !== undefined) payload.result_id = updates.resultId
  const { data, error } = await supabase.from('mock_test_attempts').update(payload).eq('id', id).select().single()
  if (error) throw error
  return attemptToCamel(data)
}

const expireMockTestAttempt = async (id, expiredAt, timeSpent) => {
  const { data, error } = await supabase
    .from('mock_test_attempts')
    .update({
      status: 'expired',
      submitted_at: expiredAt,
      time_spent: timeSpent,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'in_progress')
    .select()
    .maybeSingle()
  if (error) throw error
  return attemptToCamel(data)
}

const claimMockTestAttemptSubmission = async (id, studentId, updates) => {
  const { data, error } = await supabase
    .from('mock_test_attempts')
    .update({
      status: 'submitted',
      submitted_at: updates.submittedAt,
      answers: updates.answers,
      time_spent: updates.timeSpent,
      score: updates.score,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('student_id', studentId)
    .eq('status', 'in_progress')
    .select()
    .maybeSingle()
  if (error) throw error
  return attemptToCamel(data)
}

// ---------------- TEST RESULT OPERATIONS & SERVER SCORING ----------------
const syncMockTestAttemptStats = async ({ testName, score, totalMarks }) => {
  if (!testName) return

  const { data: matchingTests, error } = await supabase
    .from('mock_tests')
    .select('id, title, attempts, avg_score')
    .ilike('title', testName)
    .limit(20)

  if (error || !matchingTests || !matchingTests.length) return

  const match = matchingTests.find(test => test.title && test.title.trim().toLowerCase() === testName.trim().toLowerCase()) || matchingTests[0]
  if (!match) return

  const previousAttempts = Number(match.attempts || 0)
  const previousAvgScore = Number(match.avg_score || 0)
  const percentage = totalMarks > 0 ? (Number(score) / Number(totalMarks)) * 100 : 0
  const nextAttempts = previousAttempts + 1
  const nextAvgScore = nextAttempts > 1
    ? ((previousAvgScore * previousAttempts) + percentage) / nextAttempts
    : percentage

  await supabase
    .from('mock_tests')
    .update({
      attempts: nextAttempts,
      avg_score: Number(nextAvgScore.toFixed(2)),
      updated_at: new Date().toISOString(),
    })
    .eq('id', match.id)
}

const createTestResult = async (resultData) => {
  const payload = {
    user_id: resultData.userId,
    test_name: resultData.testName,
    subject: resultData.subject || null,
    score: Number(resultData.score),
    total_marks: Number(resultData.totalMarks),
    percentile: resultData.percentile ? Number(resultData.percentile) : null,
    duration: resultData.duration ? Number(resultData.duration) : null,
    correct: resultData.correct ? Number(resultData.correct) : 0,
    incorrect: resultData.incorrect ? Number(resultData.incorrect) : 0,
    unanswered: resultData.unanswered ? Number(resultData.unanswered) : 0,
    total_questions: resultData.totalQuestions ? Number(resultData.totalQuestions) : 0,
    subject_wise_scores: resultData.subjectWiseScores || [],
    answers: resultData.answers || {},
    question_ids: resultData.questionIds || [],
    ...(resultData.mockTestId ? { mock_test_id: resultData.mockTestId } : {}),
    ...(resultData.mockTestAttemptId ? { mock_test_attempt_id: resultData.mockTestAttemptId } : {}),
  }
  let data
  let error
  let alreadyCreated = false
  if (resultData.mockTestId) {
    const response = await supabase.rpc('create_mock_test_result_with_limit', {
      p_result: payload,
      p_mock_test_id: resultData.mockTestId,
    })
    data = Array.isArray(response.data) ? response.data[0] : response.data
    error = response.error
  } else {
    const response = await supabase.from('test_results').insert(payload).select().single()
    data = response.data
    error = response.error
  }
  if (error?.code === '23505' && resultData.mockTestAttemptId) {
    const { data: existing, error: lookupError } = await supabase
      .from('test_results')
      .select('*')
      .eq('mock_test_attempt_id', resultData.mockTestAttemptId)
      .maybeSingle()
    if (lookupError) throw lookupError
    if (!existing) throw error
    data = existing
    alreadyCreated = true
  } else if (error) {
    throw error
  }

  try {
    if (alreadyCreated) return testResultToCamel(data)
    await syncMockTestAttemptStats({
      testName: resultData.testName,
      score: Number(resultData.score),
      totalMarks: Number(resultData.totalMarks),
    })
  } catch (syncError) {
    console.warn('Failed to sync mock test attempts:', syncError)
  }

  return testResultToCamel(data)
}

/**
 * Authoritative server-side test scoring
 * Calculates official score and breakdown from verified questions and submitted answers
 */
const calculateAndCreateTestResult = async ({ userId, testName, answers = {}, duration = 0, questionIds = [], mockTestId = null }) => {
  let mockTest = null
  if (mockTestId) {
    mockTest = await getMockTestById(mockTestId)
    if (!mockTest || mockTest.status !== 'active') {
      const error = new Error('This mock test is not available.')
      error.code = 'MOCK_TEST_NOT_AVAILABLE'
      throw error
    }
    const requested = Array.isArray(questionIds) ? questionIds.map(String).sort() : []
    const assigned = (mockTest.questionIds || []).map(String).sort()
    if (requested.length !== assigned.length || requested.some((id, index) => id !== assigned[index])) {
      const error = new Error('Submitted questions do not match this mock test.')
      error.code = 'MOCK_TEST_QUESTION_MISMATCH'
      throw error
    }
    questionIds = mockTest.questionIds || []
    testName = mockTest.title
    duration = mockTest.duration
  }

  // Fetch active questions with answer keys internally
  const requestedQuestionIds = Array.isArray(questionIds) && questionIds.length
    ? questionIds.map(String).filter(Boolean)
    : Object.keys(answers).map(String)
  const allQuestions = await getQuestions(
    requestedQuestionIds.length ? { isActive: true, ids: requestedQuestionIds } : { isActive: true },
    { isAdmin: true },
  )

  let correct = 0
  let incorrect = 0
  let score = 0
  let totalMarks = 0
  const subjectMap = new Map()

  for (const q of allQuestions) {
    const qId = String(q.id || q._id)
    const marks = Number(q.marks) || 2
    const negativeMarks = Number(q.negativeMarks) || 0
    const subject = q.subject || 'General'

    totalMarks += marks

    if (!subjectMap.has(subject)) {
      subjectMap.set(subject, { correct: 0, total: 0, marks: 0, maxMarks: 0 })
    }
    const subjData = subjectMap.get(subject)
    subjData.total += 1
    subjData.maxMarks += marks

    if (answers[qId] !== undefined && answers[qId] !== null) {
      const selectedOption = Number(answers[qId])
      if (selectedOption === Number(q.correctIndex)) {
        correct += 1
        score += marks
        subjData.correct += 1
        subjData.marks += marks
      } else {
        incorrect += 1
        const isCetExam = !testName?.toLowerCase().includes('jee') && !testName?.toLowerCase().includes('neet')
        const deduction = isCetExam ? 0 : negativeMarks
        score = Math.max(0, score - deduction)
        subjData.marks = Math.max(0, subjData.marks - deduction)
      }
    }
  }

  const answeredCount = correct + incorrect
  const unanswered = Math.max(0, allQuestions.length - answeredCount)
  const percentile = totalMarks > 0 ? Math.round(((score / totalMarks) * 100) * 10) / 10 : 0

  const subjectWiseScores = Array.from(subjectMap.entries()).map(([subject, data]) => ({
    subject,
    score: data.marks,
    maxScore: data.maxMarks,
    percentage: data.maxMarks > 0 ? Math.round((data.marks / data.maxMarks) * 100) : 0,
  }))

  const payload = {
    userId,
    mockTestId: mockTest?._id || null,
    testName: testName || 'MHT-CET Mock Test',
    subject: 'Mock Test',
    score: Math.max(0, score),
    totalMarks,
    percentile,
    duration: Number(duration) || 0,
    correct,
    incorrect,
    unanswered,
    totalQuestions: allQuestions.length,
    subjectWiseScores,
    answers,
    questionIds: allQuestions.map((question) => String(question._id || question.id)),
  }

  return await createTestResult(payload)
}

const getTestResultsByUserId = async (userId) => {
  const { data, error } = await supabase
    .from('test_results')
    .select('*')
    .eq('user_id', userId)
    .order('attempted_at', { ascending: false })
  if (error) throw error
  return (data || []).map(testResultToCamel)
}

const getAllTestResults = async ({ summaryOnly = false } = {}) => {
  const fields = summaryOnly
    ? 'id,user_id,test_name,subject,score,total_marks,percentile,duration,attempted_at,correct,incorrect,unanswered,total_questions,subject_wise_scores,created_at,updated_at'
    : '*'
  const pageSize = 1000
  const results = []

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('test_results')
      .select(fields)
      .order('attempted_at', { ascending: false })
      .range(from, from + pageSize - 1)
    if (error) throw error
    results.push(...(data || []).map(testResultToCamel))
    if (!data || data.length < pageSize) break
  }

  return results
}

const getAdminDashboardOverview = async () => {
  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString()

  const [students, mockTests, activeMockTests, questions, attemptsToday, yearlyAnalytics] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'student').eq('status', 'approved'),
    supabase.from('mock_tests').select('id', { count: 'exact', head: true }),
    supabase.from('mock_tests').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('questions').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('test_results').select('id', { count: 'exact', head: true }).gte('attempted_at', todayStart.toISOString()),
    supabase.rpc('get_super_admin_analytics', {
      metric_name: 'attempts',
      from_time: yearStart,
      bucket_unit: 'month',
      timezone_name: 'UTC',
    }),
  ])

  const coreResults = [students, mockTests, activeMockTests, questions, attemptsToday]
  const failure = coreResults.find(result => result.error)
  if (failure) throw failure.error

  const yearlyAttemptCounts = Array(12).fill(0)
  if (yearlyAnalytics.error) {
    console.warn('Admin dashboard yearly analytics unavailable:', yearlyAnalytics.error.message)
  } else {
    for (const bucket of yearlyAnalytics.data || []) {
      yearlyAttemptCounts[new Date(bucket.bucket_start).getUTCMonth()] = Number(bucket.total) || 0
    }
  }

  const pageSize = 1000
  const resultRows = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('test_results')
      .select('id,user_id,test_name,score,total_marks,percentile,attempted_at')
      .gte('attempted_at', thirtyDaysAgo)
      .order('attempted_at', { ascending: false })
      .range(from, from + pageSize - 1)
    if (error) throw error
    resultRows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }

  const activityUserIds = [...new Set(resultRows.slice(0, 30).map(result => result.user_id).filter(Boolean))]
  let usersById = new Map()
  if (activityUserIds.length) {
    const { data, error } = await supabase
      .from('users')
      .select('id,name,email,branch')
      .in('id', activityUserIds)
    if (error) throw error
    usersById = new Map((data || []).map(user => [String(user.id), user]))
  }

  const testResults = resultRows.map((row, index) => {
    const result = testResultToCamel(row)
    const user = index < 30 ? usersById.get(String(row.user_id)) : null
    return {
      ...result,
      userId: user ? {
        _id: user.id,
        id: user.id,
        name: user.name,
        email: user.email,
        branch: user.branch,
      } : result.userId,
    }
  })
  const dailyAttemptCounts = Array(30).fill(0)
  for (const result of testResults) {
    const age = Math.floor((now.getTime() - new Date(result.attemptedAt).getTime()) / (24 * 60 * 60 * 1000))
    if (age >= 0 && age < 30) dailyAttemptCounts[29 - age] += 1
  }

  return {
    stats: {
      totalStudents: students.count || 0,
      totalMockTests: mockTests.count || 0,
      activeMockTests: activeMockTests.count || 0,
      questionCount: questions.count || 0,
      attemptsToday: attemptsToday.count || 0,
    },
    dailyAttemptCounts,
    yearlyAttemptCounts,
    testResults,
  }
}

const getTestResultById = async (id) => {
  const { data, error } = await supabase.from('test_results').select('*').eq('id', id).single()
  if (error || !data) return null
  return testResultToCamel(data)
}

module.exports = {
  invalidateSessionTimeoutCache,
  getSessionInactivityTimeoutSeconds,
  // User
  findUserById,
  findUserByEmail,
  findUserByMhcetId,
  createUser,
  updateUser,
  deleteUser,
  getAllUsers,
  getApprovedStudentsForAssignment,

  // Session
  createSession,
  findSessionById,
  updateSession,
  deleteSession,
  deleteUserSessions,
  getUserSessions,

  // Refresh Token
  createRefreshToken,
  findRefreshTokenByHash,
  updateRefreshToken,
  revokeUserRefreshTokens,

  // Login History
  createLoginHistory,

  // Question
  getQuestions,
  getQuestionById,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  getQuestionFingerprints,
  sanitizeQuestion,

  // Mock Test
  getMockTests,
  getMockTestById,
  getActiveMockTestByTitle,
  createMockTest,
  updateMockTest,
  deleteMockTest,
  createMockTestAssignment,
  getMockTestAssignments,
  getMockTestAssignmentsToProcess,
  activateDueScheduledMockTests,
  activateScheduledMockTest,
  getMockTestAssignmentById,
  updateMockTestAssignment,
  transitionMockTestAssignment,
  deleteMockTestAssignment,
  getMockTestAttempts,
  getExpiredMockTestAttemptsNeedingEvaluation,
  getMockTestAttemptById,
  createMockTestAttempt,
  updateMockTestAttempt,
  expireMockTestAttempt,
  claimMockTestAttemptSubmission,

  // Test Result
  createTestResult,
  calculateAndCreateTestResult,
  getTestResultsByUserId,
  getAllTestResults,
  getAdminDashboardOverview,
  getTestResultById,
}
