-- Server-side administrator TOTP MFA, recovery codes, challenges, and lockout state.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS totp_secret_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS totp_last_counter BIGINT,
  ADD COLUMN IF NOT EXISTS backup_code_hashes JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS mfa_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.admin_mfa_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('setup', 'login')),
  totp_secret_encrypted TEXT,
  remember_me BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_mfa_challenges_user_idx
  ON public.admin_mfa_challenges(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_mfa_challenges_expiry_idx
  ON public.admin_mfa_challenges(expires_at);

CREATE TABLE IF NOT EXISTS public.admin_auth_attempts (
  identifier_hash TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.admin_mfa_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_auth_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.admin_mfa_challenges, public.admin_auth_attempts
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_mfa_challenges, public.admin_auth_attempts
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_admin_auth_lock(p_identifier_hash TEXT)
RETURNS TABLE(is_locked BOOLEAN, retry_after_seconds INTEGER)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE(a.locked_until > NOW(), FALSE),
    GREATEST(0, CEIL(EXTRACT(EPOCH FROM (a.locked_until - NOW())))::INTEGER)
  FROM (SELECT p_identifier_hash AS identifier_hash) input
  LEFT JOIN public.admin_auth_attempts a USING (identifier_hash);
$$;

CREATE OR REPLACE FUNCTION public.record_admin_auth_failure(p_identifier_hash TEXT)
RETURNS TABLE(failure_count INTEGER, locked_until TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO public.admin_auth_attempts AS current_attempt (
    identifier_hash, failure_count, window_started_at, locked_until, last_attempt_at
  )
  VALUES (p_identifier_hash, 1, NOW(), NULL, NOW())
  ON CONFLICT (identifier_hash) DO UPDATE SET
    failure_count = CASE
      WHEN current_attempt.window_started_at <= NOW() - INTERVAL '15 minutes' THEN 1
      ELSE current_attempt.failure_count + 1
    END,
    window_started_at = CASE
      WHEN current_attempt.window_started_at <= NOW() - INTERVAL '15 minutes' THEN NOW()
      ELSE current_attempt.window_started_at
    END,
    locked_until = CASE
      WHEN (CASE
        WHEN current_attempt.window_started_at <= NOW() - INTERVAL '15 minutes' THEN 1
        ELSE current_attempt.failure_count + 1
      END) >= 5 THEN NOW() + INTERVAL '15 minutes'
      ELSE NULL
    END,
    last_attempt_at = NOW()
  RETURNING current_attempt.failure_count, current_attempt.locked_until;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_admin_auth_failures(p_identifier_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.admin_auth_attempts WHERE identifier_hash = p_identifier_hash;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_admin_totp_counter(p_user_id UUID, p_counter BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.users
  SET totp_last_counter = p_counter
  WHERE id = p_user_id
    AND role = 'admin'
    AND totp_enabled = TRUE
    AND (totp_last_counter IS NULL OR totp_last_counter < p_counter);
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_admin_backup_code(p_user_id UUID, p_code_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  code_position INTEGER;
BEGIN
  SELECT (entry.ordinality - 1)::INTEGER INTO code_position
  FROM public.users u,
       jsonb_array_elements_text(u.backup_code_hashes) WITH ORDINALITY AS entry(value, ordinality)
  WHERE u.id = p_user_id
    AND u.role = 'admin'
    AND u.totp_enabled = TRUE
    AND entry.value = p_code_hash
  LIMIT 1;

  IF code_position IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE public.users
  SET backup_code_hashes = backup_code_hashes - code_position
  WHERE id = p_user_id
    AND role = 'admin'
    AND totp_enabled = TRUE
    AND backup_code_hashes ? p_code_hash;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_admin_totp_setup(
  p_user_id UUID,
  p_challenge_hash TEXT,
  p_counter BIGINT,
  p_backup_code_hashes JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  challenge public.admin_mfa_challenges%ROWTYPE;
BEGIN
  IF p_backup_code_hashes IS NULL OR jsonb_typeof(p_backup_code_hashes) IS DISTINCT FROM 'array' THEN
    RETURN FALSE;
  END IF;
  IF jsonb_array_length(p_backup_code_hashes) = 0 THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO challenge
  FROM public.admin_mfa_challenges
  WHERE token_hash = p_challenge_hash
    AND user_id = p_user_id
    AND purpose = 'setup'
    AND used_at IS NULL
    AND expires_at > NOW()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE public.users
  SET totp_secret_encrypted = challenge.totp_secret_encrypted,
      totp_enabled = TRUE,
      totp_last_counter = p_counter,
      backup_code_hashes = p_backup_code_hashes
  WHERE id = p_user_id
    AND role = 'admin'
    AND totp_enabled = FALSE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE public.admin_mfa_challenges SET used_at = NOW() WHERE id = challenge.id;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_auth_lock(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_admin_auth_failure(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_admin_auth_failures(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_admin_totp_counter(UUID, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_admin_backup_code(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_admin_totp_setup(UUID, TEXT, BIGINT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_auth_lock(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_admin_auth_failure(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_admin_auth_failures(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_admin_totp_counter(UUID, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_admin_backup_code(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_admin_totp_setup(UUID, TEXT, BIGINT, JSONB) TO service_role;
