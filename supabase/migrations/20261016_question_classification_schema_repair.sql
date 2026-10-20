-- Ensure deployments that missed the question-classification migration have
-- the columns expected by the API's question insert and update operations.
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS question_type TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cet_difficulty TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cet_relevance TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS classification_confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS classification_source TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_pdf TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_page INTEGER,
  ADD COLUMN IF NOT EXISTS source_question_number INTEGER;

NOTIFY pgrst, 'reload schema';
