-- 20261006_question_cet_classification.sql
--
-- MHT-CET classification for PDF-imported questions.
--
-- subject / chapter / topic / sub_topic already exist on the questions table.
-- This migration adds the CET mapping (question type, CET difficulty, CET
-- relevance), classification provenance/confidence and PDF source tracking.
--
-- Every column is optional ('' or NULL = not classified), so the existing
-- question bank, the Excel importer, the mock-test flow and all current APIs
-- keep working unchanged. The legacy 3-level `difficulty` column is untouched;
-- `cet_difficulty` is the CET 4-level scale and stays separate on purpose.

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS question_type TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cet_difficulty TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cet_relevance TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS classification_confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS classification_source TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_pdf TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_page INTEGER,
  ADD COLUMN IF NOT EXISTS source_question_number INTEGER;

-- Value guards (idempotent: skipped when the constraint already exists)
DO $$
BEGIN
  ALTER TABLE public.questions ADD CONSTRAINT questions_question_type_check
    CHECK (question_type IN ('', 'Conceptual', 'Formula Based', 'Numerical', 'Application Based', 'Multi-Concept', 'Graph Based', 'Diagram Based'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.questions ADD CONSTRAINT questions_cet_difficulty_check
    CHECK (cet_difficulty IN ('', 'Easy', 'Moderate', 'Hard', 'Very Hard'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.questions ADD CONSTRAINT questions_cet_relevance_check
    CHECK (cet_relevance IN ('', 'Highly Relevant', 'Relevant', 'Partially Relevant', 'Not Relevant'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.questions ADD CONSTRAINT questions_classification_source_check
    CHECK (classification_source IN ('', 'pdf', 'rules', 'ai', 'manual'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.questions ADD CONSTRAINT questions_classification_confidence_check
    CHECK (classification_confidence IS NULL OR (classification_confidence >= 0 AND classification_confidence <= 1));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Composite index for subject -> chapter -> topic filtering / PPT exports
CREATE INDEX IF NOT EXISTS questions_classification_idx
  ON public.questions (subject, chapter, topic);
