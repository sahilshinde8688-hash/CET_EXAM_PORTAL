ALTER TABLE public.mock_tests
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 1
    CHECK (max_attempts > 0);

ALTER TABLE public.test_results
  ADD COLUMN IF NOT EXISTS mock_test_id UUID
    REFERENCES public.mock_tests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_test_results_user_mock_test
  ON public.test_results(user_id, mock_test_id);

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
  prior_attempts INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(student_id::TEXT || ':' || p_mock_test_id::TEXT, 0)
  );

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
    answers, question_ids, mock_test_id
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
    p_mock_test_id
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.create_mock_test_result_with_limit(JSONB, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_mock_test_result_with_limit(JSONB, UUID)
  TO service_role;
