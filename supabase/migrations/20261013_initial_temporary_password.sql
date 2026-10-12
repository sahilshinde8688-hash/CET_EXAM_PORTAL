ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS initial_password_ciphertext TEXT;

COMMENT ON COLUMN public.users.initial_password_ciphertext IS
  'AES-GCM encrypted initial password, readable only by the backend for admin display and initial email delivery; cleared after the first successful login.';

CREATE OR REPLACE FUNCTION public.consume_initial_temporary_password(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  password_consumed BOOLEAN;
BEGIN
  UPDATE public.users
  SET initial_password_ciphertext = NULL,
      updated_at = NOW()
  WHERE id = p_user_id
    AND status = 'approved'
    AND must_reset_password = TRUE
    AND initial_password_ciphertext IS NOT NULL
  RETURNING TRUE INTO password_consumed;

  IF COALESCE(password_consumed, FALSE) = FALSE THEN
    RETURN FALSE;
  END IF;

  UPDATE public.email_notifications
  SET payload = payload - 'initialPasswordCiphertext',
      status = CASE WHEN status IN ('pending', 'failed') THEN 'cancelled' ELSE status END,
      safe_error = CASE
        WHEN status IN ('pending', 'failed') THEN 'Initial password was consumed at first login.'
        ELSE safe_error
      END,
      locked_until = NULL,
      updated_at = NOW()
  WHERE student_id = p_user_id
    AND notification_type = 'student_welcome'
    AND payload ? 'initialPasswordCiphertext';

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_initial_temporary_password(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_initial_temporary_password(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_account_setup(
  p_token_hash TEXT,
  p_password_hash TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  setup_user_id UUID;
BEGIN
  UPDATE public.account_setup_tokens
  SET used_at = NOW(),
      token_ciphertext = NULL
  WHERE token_hash = p_token_hash
    AND used_at IS NULL
    AND expires_at > NOW()
  RETURNING user_id INTO setup_user_id;

  IF setup_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.users
  SET password = p_password_hash,
      mhcet_password = NULL,
      must_reset_password = FALSE,
      initial_password_ciphertext = NULL,
      updated_at = NOW()
  WHERE id = setup_user_id
    AND status = 'approved';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account is not available for setup';
  END IF;

  UPDATE public.email_notifications
  SET payload = payload - 'initialPasswordCiphertext',
      status = CASE WHEN status IN ('pending', 'failed') THEN 'cancelled' ELSE status END,
      safe_error = CASE
        WHEN status IN ('pending', 'failed') THEN 'Initial password was replaced during account setup.'
        ELSE safe_error
      END,
      locked_until = NULL,
      updated_at = NOW()
  WHERE student_id = setup_user_id
    AND notification_type = 'student_welcome'
    AND payload ? 'initialPasswordCiphertext';

  RETURN setup_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_account_setup(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_account_setup(TEXT, TEXT) TO service_role;
