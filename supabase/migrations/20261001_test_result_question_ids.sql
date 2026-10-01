ALTER TABLE public.test_results
  ADD COLUMN IF NOT EXISTS question_ids UUID[] NOT NULL DEFAULT '{}';

UPDATE public.test_results AS result
SET question_ids = ARRAY(
  SELECT answer_entry.question_id::UUID
  FROM jsonb_object_keys(COALESCE(result.answers, '{}'::JSONB)) AS answer_entry(question_id)
  WHERE answer_entry.question_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
)
WHERE cardinality(result.question_ids) = 0
  AND jsonb_typeof(COALESCE(result.answers, '{}'::JSONB)) = 'object';