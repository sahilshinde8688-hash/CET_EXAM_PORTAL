ALTER TABLE public.mock_tests
  ADD COLUMN IF NOT EXISTS exam_type TEXT;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS exam_type TEXT;

CREATE TABLE IF NOT EXISTS public.mock_test_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mock_test_id UUID NOT NULL REFERENCES public.mock_tests(id) ON DELETE RESTRICT,
  mock_test_name TEXT NOT NULL,
  assigned_to TEXT NOT NULL CHECK (assigned_to IN ('all', 'students', 'batch', 'branch', 'examType')),
  student_ids UUID[] NOT NULL CHECK (cardinality(student_ids) > 0),
  batch_id INTEGER,
  branch TEXT,
  exam_type TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  duration INTEGER NOT NULL CHECK (duration > 0),
  attempt_limit INTEGER CHECK (attempt_limit IS NULL OR attempt_limit > 0),
  visibility TEXT NOT NULL CHECK (visibility IN ('scheduled', 'available', 'draft')),
  result_visibility TEXT NOT NULL CHECK (result_visibility IN ('immediate', 'after_close', 'admin_only', 'hidden')),
  randomize_questions BOOLEAN NOT NULL DEFAULT FALSE,
  randomize_options BOOLEAN NOT NULL DEFAULT FALSE,
  allow_back_navigation BOOLEAN NOT NULL DEFAULT TRUE,
  allow_resume BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'archived')),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (starts_at <= ends_at)
);

CREATE TABLE IF NOT EXISTS public.mock_test_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.mock_test_assignments(id) ON DELETE RESTRICT,
  mock_test_id UUID NOT NULL REFERENCES public.mock_tests(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted')),
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  score NUMERIC,
  total_marks NUMERIC NOT NULL,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  time_spent INTEGER NOT NULL DEFAULT 0 CHECK (time_spent >= 0),
  question_ids UUID[] NOT NULL,
  option_orders JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_id UUID REFERENCES public.test_results(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (assignment_id, student_id, attempt_number)
);

ALTER TABLE public.mock_test_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_test_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mock_test_assignments FROM anon, authenticated;
REVOKE ALL ON public.mock_test_attempts FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_mock_test_assignments_students
  ON public.mock_test_assignments USING GIN (student_ids);
CREATE INDEX IF NOT EXISTS idx_mock_test_assignments_test
  ON public.mock_test_assignments (mock_test_id, status);
CREATE INDEX IF NOT EXISTS idx_mock_test_attempts_student
  ON public.mock_test_attempts (student_id, assignment_id, status);

CREATE OR REPLACE FUNCTION public.create_mock_test_assignment(
  p_assignment JSONB,
  p_allow_duplicate BOOLEAN DEFAULT FALSE
)
RETURNS SETOF public.mock_test_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  assignment_row public.mock_test_assignments;
  source_test_id UUID := (p_assignment->>'mock_test_id')::UUID;
  target_student_ids UUID[] := ARRAY(
    SELECT jsonb_array_elements_text(p_assignment->'student_ids')::UUID
  );
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(source_test_id::TEXT, 0));

  IF NOT p_allow_duplicate AND EXISTS (
    SELECT 1
    FROM public.mock_test_assignments existing
    CROSS JOIN LATERAL unnest(existing.student_ids) AS existing_student(student_id)
    WHERE existing.mock_test_id = source_test_id
      AND existing.status = 'active'
      AND existing_student.student_id = ANY(target_student_ids)
  ) THEN
    RAISE EXCEPTION 'Mock test is already assigned to one or more selected students.'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.mock_test_assignments (
    mock_test_id, mock_test_name, assigned_to, student_ids, batch_id, branch, exam_type,
    starts_at, ends_at, duration, attempt_limit, visibility, result_visibility,
    randomize_questions, randomize_options, allow_back_navigation, allow_resume, created_by
  ) VALUES (
    source_test_id,
    p_assignment->>'mock_test_name',
    p_assignment->>'assigned_to',
    target_student_ids,
    NULLIF(p_assignment->>'batch_id', '')::INTEGER,
    NULLIF(p_assignment->>'branch', ''),
    NULLIF(p_assignment->>'exam_type', ''),
    (p_assignment->>'starts_at')::TIMESTAMPTZ,
    (p_assignment->>'ends_at')::TIMESTAMPTZ,
    (p_assignment->>'duration')::INTEGER,
    NULLIF(p_assignment->>'attempt_limit', '')::INTEGER,
    p_assignment->>'visibility',
    p_assignment->>'result_visibility',
    COALESCE((p_assignment->>'randomize_questions')::BOOLEAN, FALSE),
    COALESCE((p_assignment->>'randomize_options')::BOOLEAN, FALSE),
    COALESCE((p_assignment->>'allow_back_navigation')::BOOLEAN, TRUE),
    COALESCE((p_assignment->>'allow_resume')::BOOLEAN, TRUE),
    NULLIF(p_assignment->>'created_by', '')::UUID
  )
  RETURNING * INTO assignment_row;

  RETURN NEXT assignment_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_mock_test_assignment(JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_mock_test_assignment(JSONB, BOOLEAN) TO service_role;
