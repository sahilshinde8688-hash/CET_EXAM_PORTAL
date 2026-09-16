-- Publish registration changes so the admin review screen updates immediately.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;