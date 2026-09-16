-- Allow the portal to create and manage mock tests.
ALTER TABLE public.mock_tests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for mock_tests" ON public.mock_tests;
CREATE POLICY "Allow all for mock_tests"
  ON public.mock_tests
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
