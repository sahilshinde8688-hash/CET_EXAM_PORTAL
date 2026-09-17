CREATE POLICY "Allow all for sessions"
  ON public.sessions
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all for refresh_tokens"
  ON public.refresh_tokens
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all for login_history"
  ON public.login_history
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
