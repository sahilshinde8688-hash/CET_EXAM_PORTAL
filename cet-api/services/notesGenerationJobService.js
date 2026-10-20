const { createHash, randomUUID } = require('crypto')
const path = require('path')
const supabase = require('../config/supabase')
const { extractDocument, generateFromNotes, NotesGenerationError } = require('./notesQuestionGeneration')
const db = require('./dbService')
const { flagDuplicates } = require('../utils/duplicateDetection')

const DOCUMENT_BUCKET = 'mcq-source-documents'
const ACTIVE_STATUSES = new Set([
  'QUEUED', 'EXTRACTING', 'VALIDATING_SYLLABUS', 'ORGANIZING_TOPICS',
  'GENERATING', 'VALIDATING_QUESTIONS', 'SAVING',
])
const MAX_SOURCE_TEXT = 180000

const throwIfError = (error, message) => {
  if (error) {
    const wrapped = new Error(message)
    wrapped.cause = error
    wrapped.code = error.code
    throw wrapped
  }
}

const contentHash = (buffer) => createHash('sha256').update(buffer).digest('hex')

const getDocumentByHash = async (ownerId, kind, hash) => {
  const { data, error } = await supabase
    .from('mcq_source_documents')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('document_kind', kind)
    .eq('content_sha256', hash)
    .maybeSingle()
  throwIfError(error, 'Could not check for an existing uploaded document.')
  return data
}

const storeDocument = async (ownerId, kind, file) => {
  const fileName = path.basename(String(file.originalname || 'document')).slice(0, 200)
  const extension = path.extname(fileName).toLowerCase()
  const fileType = extension === '.pdf' ? 'pdf' : extension === '.pptx' ? 'pptx' : null
  if (!fileType) throw new NotesGenerationError('Only PDF and PPTX documents are supported.', 400)
  if (!Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw new NotesGenerationError('The uploaded document is empty or unreadable.', 400)
  }

  const hash = contentHash(file.buffer)
  const existing = await getDocumentByHash(ownerId, kind, hash)
  if (existing) return existing

  const id = randomUUID()
  const storagePath = `${ownerId}/${id}/${encodeURIComponent(fileName)}`
  const mimeType = fileType === 'pdf'
    ? 'application/pdf'
    : 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, file.buffer, { contentType: mimeType, upsert: false })
  throwIfError(uploadError, 'Could not store the uploaded document securely.')

  const { data, error } = await supabase
    .from('mcq_source_documents')
    .insert({
      id,
      owner_id: ownerId,
      document_kind: kind,
      file_name: fileName,
      file_type: fileType,
      storage_bucket: DOCUMENT_BUCKET,
      storage_path: storagePath,
      content_sha256: hash,
    })
    .select('*')
    .single()

  if (error) {
    const { error: cleanupError } = await supabase.storage.from(DOCUMENT_BUCKET).remove([storagePath])
    if (cleanupError) console.error(`[mcq-generation] Could not clean up unreferenced upload ${storagePath}:`, cleanupError.message)
    if (error.code === '23505') {
      const raced = await getDocumentByHash(ownerId, kind, hash)
      if (raced) return raced
    }
    throwIfError(error, 'Could not save uploaded document details.')
  }
  return data
}

const createGenerationJob = async ({ ownerId, sourceFile, syllabusFile, config, idempotencyKey }) => {
  const sourceDocument = await storeDocument(ownerId, 'source', sourceFile)
  let syllabusDocument
  try {
    syllabusDocument = await storeDocument(ownerId, 'syllabus', syllabusFile)
  } catch (error) {
    throw error
  }

  const { data, error } = await supabase
    .from('mcq_generation_jobs')
    .insert({
      owner_id: ownerId,
      source_document_id: sourceDocument.id,
      syllabus_document_id: syllabusDocument.id,
      config,
      requested_count: config.count,
      idempotency_key: idempotencyKey || null,
    })
    .select('id,status,created_at')
    .single()
  if (error?.code === '23505') {
    if (idempotencyKey) {
      const { data: existing, error: lookupError } = await supabase
        .from('mcq_generation_jobs')
        .select('id,status,created_at')
        .eq('owner_id', ownerId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle()
      throwIfError(lookupError, 'Could not check the existing generation request.')
      if (existing) return existing
    }
    const conflict = new Error('A generation job is already active for this administrator. Wait for it to finish before starting another.')
    conflict.statusCode = 429
    throw conflict
  }
  throwIfError(error, 'Could not queue the MCQ generation job.')
  return data
}

const getOwnedJob = async (jobId, ownerId) => {
  const { data, error } = await supabase
    .from('mcq_generation_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('owner_id', ownerId)
    .maybeSingle()
  throwIfError(error, 'Could not load the generation job.')
  return data
}

const updateJob = async (jobId, updates, activeOnly = false) => {
  let query = supabase
    .from('mcq_generation_jobs')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', jobId)
  if (activeOnly) query = query.in('status', [...ACTIVE_STATUSES])
  const { data, error } = await query.select('*').maybeSingle()
  throwIfError(error, 'Could not save generation progress.')
  if (!data && activeOnly) throw new NotesGenerationError('Generation was cancelled by an administrator.', 409)
  return data
}

const downloadDocument = async (document) => {
  const { data, error } = await supabase.storage
    .from(document.storage_bucket)
    .download(document.storage_path)
  throwIfError(error, `Could not retrieve the uploaded ${document.document_kind} document.`)
  return Buffer.from(await data.arrayBuffer())
}

const extractAndCacheDocument = async (document, buffer) => {
  if (document.processing_status === 'EXTRACTED'
    && Array.isArray(document.extracted_pages)
    && document.extracted_pages.length) {
    return { pages: document.extracted_pages, sourceType: document.source_type }
  }
  try {
    const extracted = await extractDocument(buffer, document.file_name)
    const characterCount = extracted.pages.reduce((sum, page) => sum + page.text.length, 0)
    if (characterCount > MAX_SOURCE_TEXT) {
      throw new NotesGenerationError(`The ${document.document_kind} document contains too much readable text. Split it into smaller files and retry.`, 413)
    }
    const { error } = await supabase
      .from('mcq_source_documents')
      .update({
        extracted_pages: extracted.pages,
        source_type: extracted.sourceType,
        processing_status: 'EXTRACTED',
        extraction_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', document.id)
    throwIfError(error, `Could not cache extracted ${document.document_kind} document text.`)
    return extracted
  } catch (error) {
    const { error: updateError } = await supabase
      .from('mcq_source_documents')
      .update({
        processing_status: 'FAILED',
        extraction_error: error.message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq('id', document.id)
    if (updateError) {
      console.error(`[mcq-generation] Could not record extraction failure for document ${document.id}:`, updateError.message)
    }
    throw error
  }
}

const statusForStage = (stage) => {
  const value = String(stage || '').toLowerCase()
  if (value.includes('syllabus')) return 'VALIDATING_SYLLABUS'
  if (value.includes('topic') || value.includes('understanding')) return 'ORGANIZING_TOPICS'
  if (value.includes('validat')) return 'VALIDATING_QUESTIONS'
  if (value.includes('generat')) return 'GENERATING'
  return 'EXTRACTING'
}

const processNextGenerationJob = async () => {
  const { data: claimedRows, error: claimError } = await supabase.rpc('claim_mcq_generation_job', {
    p_lease_timeout_seconds: 180,
  })
  throwIfError(claimError, 'Could not claim an MCQ generation job.')
  const job = Array.isArray(claimedRows) ? claimedRows[0] : claimedRows
  if (!job) return false

  let heartbeatBusy = false
  const heartbeat = setInterval(async () => {
    if (heartbeatBusy) return
    heartbeatBusy = true
    try {
      const { error } = await supabase.from('mcq_generation_jobs')
        .update({ worker_heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', job.id)
        .in('status', [...ACTIVE_STATUSES])
      throwIfError(error, 'Could not refresh the worker lease.')
    } catch (error) {
      console.error(`[mcq-generation] Could not refresh worker lease for job ${job.id}:`, error.message)
    } finally {
      heartbeatBusy = false
    }
  }, 30_000)
  heartbeat.unref?.()

  try {
    const [{ data: source, error: sourceError }, { data: syllabus, error: syllabusError }] = await Promise.all([
      supabase.from('mcq_source_documents').select('*').eq('id', job.source_document_id).single(),
      supabase.from('mcq_source_documents').select('*').eq('id', job.syllabus_document_id).single(),
    ])
    throwIfError(sourceError || syllabusError, 'Could not load uploaded generation documents.')
    const [sourceBuffer, syllabusBuffer] = await Promise.all([
      downloadDocument(source),
      downloadDocument(syllabus),
    ])

    const sourceExtraction = await extractAndCacheDocument(source, sourceBuffer)
    sourceBuffer.fill(0)
    const syllabusExtraction = await extractAndCacheDocument(syllabus, syllabusBuffer)
    syllabusBuffer.fill(0)
    const checkpoint = job.checkpoint && typeof job.checkpoint === 'object' ? job.checkpoint : {}
    const config = job.config

    const throwIfCancellationRequested = async () => {
      const { data: current, error } = await supabase
        .from('mcq_generation_jobs')
        .select('status,cancel_requested_at')
        .eq('id', job.id)
        .single()
      throwIfError(error, 'Could not check generation cancellation state.')
      if (current.status === 'CANCELLED' || current.cancel_requested_at) {
        throw new NotesGenerationError('Generation was cancelled by an administrator.', 409)
      }
    }

    const result = await generateFromNotes({
      fileName: source.file_name,
      rawConfig: config,
      pages: sourceExtraction.pages,
      sourceType: sourceExtraction.sourceType,
      syllabusPages: syllabusExtraction.pages,
      syllabusSourceType: syllabusExtraction.sourceType,
      resume: checkpoint,
      onProgress: async (stage, progress) => {
        await throwIfCancellationRequested()
        await updateJob(job.id, {
          status: statusForStage(stage),
          stage,
          progress: Math.max(0, Math.min(99, Number(progress) || 0)),
          worker_heartbeat_at: new Date().toISOString(),
        }, true)
      },
      onCheckpoint: async (checkpointUpdate) => {
        await throwIfCancellationRequested()
        const { data: current, error } = await supabase
          .from('mcq_generation_jobs')
          .select('status,checkpoint')
          .eq('id', job.id)
          .single()
        throwIfError(error, 'Could not save the generation checkpoint.')
        if (current.status === 'CANCELLED') throw new NotesGenerationError('Generation was cancelled by an administrator.', 409)
        const nextCheckpoint = { ...(current.checkpoint || {}), ...checkpointUpdate }
        await updateJob(job.id, {
          checkpoint: nextCheckpoint,
          generated_count: Array.isArray(nextCheckpoint.questions) ? nextCheckpoint.questions.length : 0,
          validated_count: Array.isArray(nextCheckpoint.questions)
            ? nextCheckpoint.questions.filter((question) => !question.validationIssues?.length).length
            : 0,
          completed_batches: Number(nextCheckpoint.generationCheckpoint?.completedBatches) || 0,
          worker_heartbeat_at: new Date().toISOString(),
        }, true)
      },
    })

    await throwIfCancellationRequested()
    const existingQuestions = await db.getQuestionFingerprints({ subject: config.subject })
    const duplicateChecks = flagDuplicates(
      result.questions.map((question) => ({ question: question.text })),
      existingQuestions,
    )
    result.questions = result.questions.map((question, index) => {
      const duplicate = duplicateChecks[index]
      if (!duplicate.duplicate) return question
      return {
        ...question,
        selected: false,
        approved: false,
        validationIssues: [
          ...question.validationIssues,
          `This question may duplicate an existing Question Bank item (${duplicate.duplicateType}).`,
        ],
      }
    })
    const publicQuestions = result.questions
    const successful = publicQuestions.filter((question) =>
      question.syllabusStatus === 'confirmed' && !question.validationIssues.length,
    ).length
    const status = publicQuestions.length < result.requestedCount || successful < result.requestedCount
      ? 'PARTIALLY_COMPLETED'
      : 'COMPLETED'
    const completion = {
      status,
      stage: status === 'COMPLETED' ? 'Ready for review' : 'Completed with a question shortage; review results',
      progress: 100,
      generated_count: publicQuestions.length,
      validated_count: successful,
      result,
      completed_at: new Date().toISOString(),
      worker_heartbeat_at: null,
      error_category: null,
      error_message: null,
    }
    const { data: completed, error: completionError } = await supabase
      .from('mcq_generation_jobs')
      .update({ ...completion, updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .in('status', [...ACTIVE_STATUSES])
      .is('cancel_requested_at', null)
      .select('id')
      .maybeSingle()
    throwIfError(completionError, 'Could not save completed generation results.')
    if (!completed) throw new NotesGenerationError('Generation was cancelled by an administrator.', 409)
  } catch (error) {
    if (!(error instanceof NotesGenerationError)) {
      console.error(`[mcq-generation] Job ${job.id} failed:`, error.message)
    }
    if (error.statusCode === 409) {
      await updateJob(job.id, {
        status: 'CANCELLED',
        stage: 'Cancelled',
        worker_heartbeat_at: null,
        completed_at: new Date().toISOString(),
      })
    } else {
      const { data: current } = await supabase.from('mcq_generation_jobs').select('status').eq('id', job.id).maybeSingle()
      if (current?.status !== 'CANCELLED') {
        await updateJob(job.id, {
          status: 'FAILED',
          stage: 'Failed',
          error_category: error.statusCode ? `request_${error.statusCode}` : 'generation_failed',
          error_message: error instanceof NotesGenerationError
            ? error.message
            : 'Question generation failed unexpectedly. Please retry.',
          worker_heartbeat_at: null,
          completed_at: new Date().toISOString(),
        })
      }
    }
  } finally {
    clearInterval(heartbeat)
  }
  return true
}

const publicResult = (result) => {
  if (!result) return result
  const {
    _sourcePages,
    _topicsFull,
    _syllabusOutline,
    _topicMap,
    _config,
    ...safeResult
  } = result
  return safeResult
}

const updateOwnedJobResult = async (jobId, ownerId, result) => {
  const { data, error } = await supabase
    .from('mcq_generation_jobs')
    .update({ result, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('owner_id', ownerId)
    .in('status', ['COMPLETED', 'PARTIALLY_COMPLETED'])
    .select('id')
    .maybeSingle()
  throwIfError(error, 'Could not save reviewed question changes.')
  if (!data) return false
  return true
}

const cancelOwnedJob = async (jobId, ownerId) => {
  const job = await getOwnedJob(jobId, ownerId)
  if (!job) return null
  if (!ACTIVE_STATUSES.has(job.status)) return { status: job.status, alreadyFinished: true }

  const updates = job.status === 'QUEUED'
    ? {
        status: 'CANCELLED',
        stage: 'Cancelled',
        completed_at: new Date().toISOString(),
      }
    : {
        cancel_requested_at: new Date().toISOString(),
        stage: 'Cancellation requested',
      }
  const { data, error } = await supabase
    .from('mcq_generation_jobs')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('owner_id', ownerId)
    .in('status', [...ACTIVE_STATUSES])
    .select('status')
    .maybeSingle()
  throwIfError(error, 'Could not request generation cancellation.')
  if (data) return { status: data.status, alreadyFinished: false }
  const current = await getOwnedJob(jobId, ownerId)
  return current ? { status: current.status, alreadyFinished: true } : null
}

module.exports = {
  cancelOwnedJob,
  createGenerationJob,
  getOwnedJob,
  processNextGenerationJob,
  publicResult,
  updateOwnedJobResult,
}
