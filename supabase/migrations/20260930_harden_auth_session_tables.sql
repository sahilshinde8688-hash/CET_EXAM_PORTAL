-- Auth sessions are managed exclusively by the trusted API using the service role.
-- Browser clients must not be able to read or mutate session and refresh-token records.
DROP POLICY IF EXISTS "Allow all for sessions" ON public.sessions;
DROP POLICY IF EXISTS "Allow all for refresh_tokens" ON public.refresh_tokens;
DROP POLICY IF EXISTS "Allow all for login_history" ON public.login_history;

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.sessions, public.refresh_tokens, public.login_history
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sessions, public.refresh_tokens, public.login_history
  TO service_role;