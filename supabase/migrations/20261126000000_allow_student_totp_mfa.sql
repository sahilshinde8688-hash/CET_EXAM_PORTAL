-- Allow the existing TOTP enrollment and recovery functions to protect student accounts too.
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
    AND role IN ('admin', 'student')
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
    AND u.role IN ('admin', 'student')
    AND u.totp_enabled = TRUE
    AND entry.value = p_code_hash
  LIMIT 1;

  IF code_position IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE public.users
  SET backup_code_hashes = backup_code_hashes - code_position
  WHERE id = p_user_id
    AND role IN ('admin', 'student')
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
    AND role IN ('admin', 'student')
    AND totp_enabled = FALSE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE public.admin_mfa_challenges SET used_at = NOW() WHERE id = challenge.id;
  RETURN TRUE;
END;
$$;
