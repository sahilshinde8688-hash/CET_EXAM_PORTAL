-- Allow students to save and view their exam results through the portal.
ALTER TABLE public.test_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for test_results" ON public.test_results;
CREATE POLICY "Allow all for test_results"
  ON public.test_results
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);