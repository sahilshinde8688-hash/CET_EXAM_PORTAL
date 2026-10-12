ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS guardian_email TEXT,
  ADD COLUMN IF NOT EXISTS parent_result_email_consent BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.test_results
  ADD COLUMN IF NOT EXISTS submission_key UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_test_results_user_submission_key
  ON public.test_results(user_id, submission_key)
  WHERE submission_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.email_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type TEXT NOT NULL CHECK (
    notification_type IN ('exam_result', 'parent_result', 'student_welcome', 'password_changed', 'admin_test')
  ),
  student_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  test_result_id UUID REFERENCES public.test_results(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status     IN ('pending', 'accepted', 'delivered', 'failed', 'unknown', 'cancelled')
  ),
  idempotency_key TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_message_id TEXT,
  safe_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  last_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ,
  parent_report_token_hash TEXT,
  parent_report_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_notifications_due
  ON public.email_notifications(status, next_attempt_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_email_notifications_created
  ON public.email_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_notifications_result
  ON public.email_notifications(test_result_id);

ALTER TABLE public.email_notifications ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.account_setup_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_setup_tokens_user
  ON public.account_setup_tokens(user_id, expires_at DESC);

ALTER TABLE public.account_setup_tokens ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.complete_account_setup(
  p_token_hash TEXT,
  p_password_hash TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  setup_user_id UUID;
BEGIN
  UPDATE public.account_setup_tokens
  SET used_at = NOW()
  WHERE token_hash = p_token_hash
    AND used_at IS NULL
    AND expires_at > NOW()
  RETURNING user_id INTO setup_user_id;

  IF setup_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.users
  SET password = p_password_hash,
      mhcet_password = NULL,
      must_reset_password = FALSE,
      updated_at = NOW()
  WHERE id = setup_user_id
    AND status = 'approved';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account is not available for setup';
  END IF;

  RETURN setup_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_account_setup(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_account_setup(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.create_mock_test_result_with_limit(
  p_result JSONB,
  p_mock_test_id UUID
)
RETURNS SETOF public.test_results
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  test_row public.mock_tests;
  student_id UUID := (p_result->>'user_id')::UUID;
  request_key UUID := NULLIF(p_result->>'submission_key', '')::UUID;
  prior_attempts INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(student_id::TEXT || ':' || p_mock_test_id::TEXT, 0)
  );

  IF request_key IS NOT NULL THEN
    RETURN QUERY
    SELECT * FROM public.test_results
    WHERE user_id = student_id AND submission_key = request_key;
    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  SELECT * INTO test_row
  FROM public.mock_tests
  WHERE id = p_mock_test_id AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mock test is not available.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT COUNT(*) INTO prior_attempts
  FROM public.test_results
  WHERE user_id = student_id
    AND (
      mock_test_id = p_mock_test_id
      OR (
        mock_test_id IS NULL
        AND LOWER(BTRIM(test_name)) = LOWER(BTRIM(test_row.title))
        AND NOT EXISTS (
          SELECT 1
          FROM public.mock_test_attempts assigned_attempt
          WHERE assigned_attempt.result_id = test_results.id
        )
      )
    );

  IF prior_attempts >= test_row.max_attempts THEN
    RAISE EXCEPTION 'Mock test attempt limit reached.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  INSERT INTO public.test_results (
    user_id, test_name, subject, score, total_marks, percentile, duration,
    correct, incorrect, unanswered, total_questions, subject_wise_scores,
    answers, question_ids, mock_test_id, submission_key
  ) VALUES (
    student_id,
    p_result->>'test_name',
    NULLIF(p_result->>'subject', ''),
    (p_result->>'score')::NUMERIC,
    (p_result->>'total_marks')::NUMERIC,
    NULLIF(p_result->>'percentile', '')::NUMERIC,
    NULLIF(p_result->>'duration', '')::INTEGER,
    COALESCE(NULLIF(p_result->>'correct', '')::INTEGER, 0),
    COALESCE(NULLIF(p_result->>'incorrect', '')::INTEGER, 0),
    COALESCE(NULLIF(p_result->>'unanswered', '')::INTEGER, 0),
    COALESCE(NULLIF(p_result->>'total_questions', '')::INTEGER, 0),
    COALESCE(p_result->'subject_wise_scores', '[]'::JSONB),
    COALESCE(p_result->'answers', '{}'::JSONB),
    COALESCE(
      ARRAY(
        SELECT jsonb_array_elements_text(COALESCE(p_result->'question_ids', '[]'::JSONB))::UUID
      ),
      ARRAY[]::UUID[]
    ),
    p_mock_test_id,
    request_key
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.create_mock_test_result_with_limit(JSONB, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_mock_test_result_with_limit(JSONB, UUID)
  TO service_role;
