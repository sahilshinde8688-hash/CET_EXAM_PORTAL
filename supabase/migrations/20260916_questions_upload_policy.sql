-- Allow bulk question imports and admin question management through the portal.
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for questions" ON public.questions;
CREATE POLICY "Allow all for questions"
  ON public.questions
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
