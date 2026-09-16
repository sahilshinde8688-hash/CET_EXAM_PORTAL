-- Allow the portal to create and review student registration rows.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for users" ON public.users;
CREATE POLICY "Allow all for users"
  ON public.users
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
