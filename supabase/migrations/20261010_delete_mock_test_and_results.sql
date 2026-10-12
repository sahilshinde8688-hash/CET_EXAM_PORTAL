CREATE OR REPLACE FUNCTION public.delete_mock_test_and_results(
  p_mock_test_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM id
  FROM public.mock_tests
  WHERE id = p_mock_test_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  DELETE FROM public.test_results
  WHERE mock_test_id = p_mock_test_id
    OR mock_test_attempt_id IN (
      SELECT id
      FROM public.mock_test_attempts
      WHERE mock_test_id = p_mock_test_id
    )
    OR id IN (
      SELECT result_id
      FROM public.mock_test_attempts
      WHERE mock_test_id = p_mock_test_id
        AND result_id IS NOT NULL
    );

  DELETE FROM public.mock_test_attempts
  WHERE mock_test_id = p_mock_test_id;

  DELETE FROM public.mock_test_assignments
  WHERE mock_test_id = p_mock_test_id;

  DELETE FROM public.mock_tests
  WHERE id = p_mock_test_id;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_mock_test_and_results(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_mock_test_and_results(UUID)
  TO service_role;
