ALTER TABLE public.account_setup_tokens
  ADD COLUMN IF NOT EXISTS token_ciphertext TEXT;

COMMENT ON COLUMN public.account_setup_tokens.token_ciphertext IS
  'AES-GCM encrypted setup token used only to recreate the same welcome email after queue failures.';

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
      updated_at = NOW()
  WHERE id = setup_user_id
    AND status = 'approved';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account is not available for setup';
  END IF;

  RETURN setup_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_account_setup(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_account_setup(TEXT, TEXT) TO service_role;
