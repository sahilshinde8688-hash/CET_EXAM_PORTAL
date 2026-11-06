ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS image_alt_text TEXT NOT NULL DEFAULT '';
