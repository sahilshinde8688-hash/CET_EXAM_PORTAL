const bcrypt = require('bcryptjs')
const supabase = require('../config/supabase')

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
    role: row.role,
    status: row.status,
    mhcetId: row.mhcet_id,
    photo: row.photo,
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
    rejectionReason: row.rejection_reason,
    mustResetPassword: row.must_reset_password,
    mhcetPassword: row.mhcet_password,
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
    marks: row.marks ? Number(row.marks) : 2,
    negativeMarks: row.negative_marks ? Number(row.negative_marks) : 0.5,
    difficulty: row.difficulty,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const sanitizeQuestion = (q) => {
  if (!q) return null
  const { solution, ...safeQuestion } = q
  return {
    ...safeQuestion,
    correctIndex: Number(q.correctIndex ?? 0),
    marks: Number(q.marks ?? 2),
    negativeMarks: Number(q.negativeMarks ?? 0.5),
  }
}

const mockTestToCamel = (row) => {
  if (!row) return null
  return {
    _id: row.id,
    id: row.id,
    title: row.title,
    subject: row.subject,
    questions: row.questions,
    duration: row.duration,
    difficulty: row.difficulty,
    status: row.status,
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

  try {
    const { data, error } = await supabase.from('users').select('*').eq('email', cleanEmail).maybeSingle()
    if (!error && data) return userToCamel(data)
  } catch {}

  if (approvedMemoryStore.has(cleanEmail)) return approvedMemoryStore.get(cleanEmail)
  if (pendingMemoryStore.has(cleanEmail)) return pendingMemoryStore.get(cleanEmail)

  return null
}

const findUserByMhcetId = async (mhcetId) => {
  if (!mhcetId) return null
  const cleanId = mhcetId.toUpperCase().trim()

  try {
    const { data, error } = await supabase.from('users').select('*').eq('mhcet_id', cleanId).maybeSingle()
    if (!error && data) return userToCamel(data)
  } catch {}

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
  try {
    let query = supabase.from('users').select('*').order('created_at', { ascending: false })
    if (filters.status) query = query.eq('status', filters.status)
    if (filters.role) query = query.eq('role', filters.role)
    if (filters.branch) query = query.eq('branch', filters.branch)
    if (filters.batch) query = query.eq('batch', filters.batch)

    const { data } = await query
    if (data) dbUsers = data.map(userToCamel)
  } catch {}

  const map = new Map()

  dbUsers.forEach((u) => {
    if (u && u.email) map.set(u.email.toLowerCase(), u)
  })

  approvedMemoryStore.forEach((u) => {
    if (!filters.status || u.status === filters.status) {
      if (!filters.role || u.role === filters.role) {
        if (!map.has(u.email.toLowerCase())) {
          map.set(u.email.toLowerCase(), u)
        }
      }
    }
  })

  pendingMemoryStore.forEach((u) => {
    if (!filters.status || u.status === filters.status) {
      if (!filters.role || u.role === filters.role) {
        if (!map.has(u.email.toLowerCase())) {
          map.set(u.email.toLowerCase(), u)
        }
      }
    }
  })

  return Array.from(map.values())
}

// ---------------- ADMIN BOOTSTRAP ----------------
const bootstrapAdminAccount = async (adminEmail, adminPassword) => {
  if (!adminEmail || !adminPassword) return

  const cleanEmail = adminEmail.toLowerCase().trim()
  try {
    const existing = await findUserByEmail(cleanEmail)
    const hashedPassword = await bcrypt.hash(adminPassword, 12)

    if (!existing) {
      console.log(`[BOOTSTRAP] Initializing admin account for ${cleanEmail}...`)
      await createUser({
        name: 'System Administrator',
        email: cleanEmail,
        password: hashedPassword,
        branch: 'Byculla',
        batch: 2024,
        role: 'admin',
        status: 'approved',
      })
      console.log(`[BOOTSTRAP] ✅ Admin account created successfully.`)
    } else if (existing.role !== 'admin' || !existing.password) {
      console.log(`[BOOTSTRAP] Updating existing account to admin privileges for ${cleanEmail}...`)
      await updateUser(existing.id, {
        role: 'admin',
        status: 'approved',
        password: hashedPassword,
      })
      console.log(`[BOOTSTRAP] ✅ Admin account updated successfully.`)
    }
  } catch (err) {
    console.error(`[BOOTSTRAP] ❌ Failed to bootstrap admin account:`, err.message)
  }
}

// ---------------- SESSION OPERATIONS ----------------
const createSession = async (sessionData) => {
  const payload = {
    session_id: sessionData.sessionId,
    user_id: sessionData.userId,
    device_name: sessionData.deviceName || 'Unknown Device',
    browser: sessionData.browser || 'Unknown Browser',
    operating_system: sessionData.operatingSystem || 'Unknown OS',
    ip_address: sessionData.ipAddress || 'Unknown IP',
    country: sessionData.country || '',
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

const createMockTest = async (testData) => {
  const payload = {
    title: testData.title,
    subject: testData.subject,
    questions: Number(testData.questions),
    duration: Number(testData.duration),
    difficulty: testData.difficulty,
    status: testData.status || 'draft',
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
  if (updates.questions !== undefined) payload.questions = Number(updates.questions)
  if (updates.duration !== undefined) payload.duration = Number(updates.duration)
  if (updates.difficulty !== undefined) payload.difficulty = updates.difficulty
  if (updates.status !== undefined) payload.status = updates.status
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

// ---------------- TEST RESULT OPERATIONS & SERVER SCORING ----------------
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
  }
  const { data, error } = await supabase.from('test_results').insert(payload).select().single()
  if (error) throw error
  return testResultToCamel(data)
}

/**
 * Authoritative server-side test scoring
 * Calculates official score and breakdown from verified questions and submitted answers
 */
const calculateAndCreateTestResult = async ({ userId, testName, answers = {}, duration = 0 }) => {
  // Fetch active questions with answer keys internally
  const allQuestions = await getQuestions({ isActive: true }, { isAdmin: true })

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
        score = Math.max(0, score - negativeMarks)
        subjData.marks = Math.max(0, subjData.marks - negativeMarks)
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

const getTestResultById = async (id) => {
  const { data, error } = await supabase.from('test_results').select('*').eq('id', id).single()
  if (error || !data) return null
  return testResultToCamel(data)
}

module.exports = {
  // User
  findUserById,
  findUserByEmail,
  findUserByMhcetId,
  createUser,
  updateUser,
  deleteUser,
  getAllUsers,
  bootstrapAdminAccount,

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
  sanitizeQuestion,

  // Mock Test
  getMockTests,
  getMockTestById,
  createMockTest,
  updateMockTest,
  deleteMockTest,

  // Test Result
  createTestResult,
  calculateAndCreateTestResult,
  getTestResultsByUserId,
  getTestResultById,
}
