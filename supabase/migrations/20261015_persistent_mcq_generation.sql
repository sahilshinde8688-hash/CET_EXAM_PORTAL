CREATE TABLE IF NOT EXISTS public.mcq_source_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  document_kind TEXT NOT NULL CHECK (document_kind IN ('source', 'syllabus')),
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('pdf', 'pptx')),
  storage_bucket TEXT NOT NULL DEFAULT 'mcq-source-documents',
  storage_path TEXT NOT NULL UNIQUE,
  content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  extracted_pages JSONB,
  source_type TEXT CHECK (source_type IN ('page', 'slide')),
  processing_status TEXT NOT NULL DEFAULT 'UPLOADED'
    CHECK (processing_status IN ('UPLOADED', 'EXTRACTED', 'FAILED')),
  extraction_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, document_kind, content_sha256)
);

CREATE INDEX IF NOT EXISTS idx_mcq_source_documents_owner
  ON public.mcq_source_documents (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mcq_generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source_document_id UUID NOT NULL REFERENCES public.mcq_source_documents(id) ON DELETE RESTRICT,
  syllabus_document_id UUID NOT NULL REFERENCES public.mcq_source_documents(id) ON DELETE RESTRICT,
  config JSONB NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN (
      'QUEUED', 'EXTRACTING', 'VALIDATING_SYLLABUS', 'ORGANIZING_TOPICS',
      'GENERATING', 'VALIDATING_QUESTIONS', 'SAVING', 'COMPLETED',
      'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED'
    )),
  stage TEXT NOT NULL DEFAULT 'Queued',
  progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  current_chapter TEXT,
  current_topic TEXT,
  requested_count INTEGER NOT NULL CHECK (requested_count BETWEEN 1 AND 100),
  generated_count INTEGER NOT NULL DEFAULT 0 CHECK (generated_count >= 0),
  validated_count INTEGER NOT NULL DEFAULT 0 CHECK (validated_count >= 0),
  completed_batches INTEGER NOT NULL DEFAULT 0 CHECK (completed_batches >= 0),
  failed_batches INTEGER NOT NULL DEFAULT 0 CHECK (failed_batches >= 0),
  attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  retry_count SMALLINT NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  checkpoint JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error_category TEXT,
  error_message TEXT,
  worker_heartbeat_at TIMESTAMPTZ,
  cancel_requested_at TIMESTAMPTZ,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (owner_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_mcq_generation_jobs_status_created
  ON public.mcq_generation_jobs (status, created_at)
  WHERE status IN (
    'QUEUED', 'EXTRACTING', 'VALIDATING_SYLLABUS', 'ORGANIZING_TOPICS',
    'GENERATING', 'VALIDATING_QUESTIONS', 'SAVING'
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_mcq_generation_jobs_one_active_per_owner
  ON public.mcq_generation_jobs (owner_id)
  WHERE status IN (
    'QUEUED', 'EXTRACTING', 'VALIDATING_SYLLABUS', 'ORGANIZING_TOPICS',
    'GENERATING', 'VALIDATING_QUESTIONS', 'SAVING'
  );

ALTER TABLE public.mcq_source_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcq_generation_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcq_source_documents, public.mcq_generation_jobs FROM anon, authenticated;
GRANT ALL ON public.mcq_source_documents, public.mcq_generation_jobs TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'mcq-source-documents',
  'mcq-source-documents',
  FALSE,
  26214400,
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.claim_mcq_generation_job(p_lease_timeout_seconds INTEGER DEFAULT 180)
RETURNS SETOF public.mcq_generation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed_job public.mcq_generation_jobs;
BEGIN
  UPDATE public.mcq_generation_jobs
  SET status = 'CANCELLED',
      stage = 'Cancelled',
      completed_at = NOW(),
      updated_at = NOW(),
      worker_heartbeat_at = NULL
  WHERE status IN (
    'EXTRACTING', 'VALIDATING_SYLLABUS', 'ORGANIZING_TOPICS',
    'GENERATING', 'VALIDATING_QUESTIONS', 'SAVING'
  )
    AND cancel_requested_at IS NOT NULL;

  UPDATE public.mcq_generation_jobs
  SET status = 'FAILED',
      stage = 'Failed after repeated worker interruption',
      error_category = 'worker_lease_expired',
      error_message = 'The background worker could not resume this job after several attempts. Please retry.',
      completed_at = NOW(),
      updated_at = NOW(),
      worker_heartbeat_at = NULL
  WHERE status IN (
    'EXTRACTING', 'VALIDATING_SYLLABUS', 'ORGANIZING_TOPICS',
    'GENERATING', 'VALIDATING_QUESTIONS', 'SAVING'
  )
    AND worker_heartbeat_at < NOW() - make_interval(secs => GREATEST(30, LEAST(p_lease_timeout_seconds, 900)))
    AND attempt_count >= 5;

  SELECT *
  INTO claimed_job
  FROM public.mcq_generation_jobs
  WHERE status = 'QUEUED'
     OR (
       status IN (
         'EXTRACTING', 'VALIDATING_SYLLABUS', 'ORGANIZING_TOPICS',
         'GENERATING', 'VALIDATING_QUESTIONS', 'SAVING'
       )
       AND worker_heartbeat_at < NOW() - make_interval(secs => GREATEST(30, LEAST(p_lease_timeout_seconds, 900)))
       AND attempt_count < 5
     )
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.mcq_generation_jobs
  SET status = CASE WHEN status = 'QUEUED' THEN 'EXTRACTING' ELSE status END,
      attempt_count = attempt_count + 1,
      retry_count = retry_count + CASE WHEN worker_heartbeat_at IS NULL THEN 0 ELSE 1 END,
      worker_heartbeat_at = NOW(),
      updated_at = NOW()
  WHERE id = claimed_job.id
  RETURNING * INTO claimed_job;

  RETURN NEXT claimed_job;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_mcq_generation_job(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_mcq_generation_job(INTEGER) TO service_role;

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS normalized_question_hash TEXT,
  ADD COLUMN IF NOT EXISTS generation_job_id UUID
    REFERENCES public.mcq_generation_jobs(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_normalized_hash_unique
  ON public.questions (normalized_question_hash)
  WHERE normalized_question_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_questions_generation_job
  ON public.questions (generation_job_id)
  WHERE generation_job_id IS NOT NULL;
