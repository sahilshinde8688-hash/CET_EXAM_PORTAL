CREATE TABLE IF NOT EXISTS public.cet_question_id_counters (
  subject_code TEXT NOT NULL,
  topic_code TEXT NOT NULL,
  topic_key TEXT NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0 CHECK (last_number BETWEEN 0 AND 999999),
  PRIMARY KEY (subject_code, topic_code),
  UNIQUE (subject_code, topic_key)
);

ALTER TABLE public.cet_question_id_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cet_question_id_counters FROM anon, authenticated;
GRANT ALL ON public.cet_question_id_counters TO service_role;

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS question_code TEXT;

CREATE OR REPLACE FUNCTION public.cet_question_subject_code(p_subject TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  normalized TEXT := regexp_replace(lower(trim(coalesce(p_subject, ''))), '[^a-z0-9]+', ' ', 'g');
  initials TEXT;
BEGIN
  IF normalized IN ('math', 'maths', 'mathematics') THEN RETURN 'MAT'; END IF;
  IF normalized IN ('physics') THEN RETURN 'PHY'; END IF;
  IF normalized IN ('chemistry') THEN RETURN 'CHE'; END IF;
  IF normalized IN ('biology', 'bio', 'botany', 'zoology') THEN RETURN 'BIO'; END IF;
  IF normalized = '' THEN RETURN 'UNK'; END IF;

  SELECT string_agg(left(word, 1), '' ORDER BY ordinal)
  INTO initials
  FROM unnest(string_to_array(normalized, ' ')) WITH ORDINALITY AS words(word, ordinal)
  WHERE word <> '';

  IF length(initials) >= 2 THEN RETURN left(upper(initials), 8); END IF;
  RETURN upper(left(replace(normalized, ' ', ''), 3));
END;
$$;

CREATE OR REPLACE FUNCTION public.cet_question_topic_code(p_topic TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  normalized TEXT := regexp_replace(lower(trim(coalesce(p_topic, ''))), '[^a-z0-9]+', ' ', 'g');
  compact TEXT := regexp_replace(lower(trim(coalesce(p_topic, ''))), '[^a-z0-9]+', '', 'g');
  initials TEXT;
BEGIN
  CASE compact
    WHEN 'matrices' THEN RETURN 'MAT';
    WHEN 'matrix' THEN RETURN 'MAT';
    WHEN 'determinants' THEN RETURN 'DET';
    WHEN 'trigonometry' THEN RETURN 'TRI';
    WHEN 'lawsofmotion' THEN RETURN 'LOM';
    WHEN 'currentelectricity' THEN RETURN 'CE';
    WHEN 'chemicalbonding' THEN RETURN 'CB';
    WHEN 'genetics' THEN RETURN 'GEN';
    ELSE NULL;
  END CASE;

  IF normalized = '' THEN RETURN 'GEN'; END IF;
  SELECT string_agg(left(word, 1), '' ORDER BY ordinal)
  INTO initials
  FROM unnest(string_to_array(normalized, ' ')) WITH ORDINALITY AS words(word, ordinal)
  WHERE word <> '';

  IF length(initials) >= 2 THEN RETURN left(upper(initials), 10); END IF;
  RETURN upper(left(compact, 3));
END;
$$;

CREATE OR REPLACE FUNCTION public.next_cet_question_code(p_subject TEXT, p_topic TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subject_code TEXT := public.cet_question_subject_code(p_subject);
  v_topic_compact TEXT := regexp_replace(lower(trim(coalesce(p_topic, 'General'))), '[^a-z0-9]+', '', 'g');
  v_topic_key TEXT;
  v_base_topic_code TEXT := public.cet_question_topic_code(p_topic);
  v_topic_code TEXT;
  v_suffix INTEGER := 0;
  v_allocated_number INTEGER;
BEGIN
  v_topic_key := CASE v_topic_compact
    WHEN 'matrix' THEN 'matrices'
    WHEN 'matrices' THEN 'matrices'
    WHEN 'determinant' THEN 'determinants'
    WHEN 'determinants' THEN 'determinants'
    ELSE regexp_replace(lower(trim(coalesce(p_topic, 'General'))), '[^a-z0-9]+', ' ', 'g')
  END;

  SELECT counter.topic_code
  INTO v_topic_code
  FROM public.cet_question_id_counters AS counter
  WHERE counter.subject_code = v_subject_code
    AND counter.topic_key = v_topic_key;

  IF v_topic_code IS NULL THEN
    LOOP
      v_topic_code := CASE
        WHEN v_suffix = 0 THEN v_base_topic_code
        ELSE left(v_base_topic_code, 10 - length(v_suffix::TEXT)) || v_suffix::TEXT
      END;

      INSERT INTO public.cet_question_id_counters (subject_code, topic_code, topic_key)
      VALUES (v_subject_code, v_topic_code, v_topic_key)
      ON CONFLICT DO NOTHING;

      IF FOUND THEN EXIT; END IF;

      SELECT counter.topic_code
      INTO v_topic_code
      FROM public.cet_question_id_counters AS counter
      WHERE counter.subject_code = v_subject_code
        AND counter.topic_key = v_topic_key;

      IF v_topic_code IS NOT NULL THEN EXIT; END IF;
      v_suffix := v_suffix + 1;
      IF v_suffix > 999999 THEN
        RAISE EXCEPTION 'Could not allocate a unique topic code for subject %, topic %', p_subject, p_topic;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.cet_question_id_counters AS counter
  SET last_number = counter.last_number + 1
  WHERE counter.subject_code = v_subject_code
    AND counter.topic_code = v_topic_code
  RETURNING counter.last_number INTO v_allocated_number;

  IF v_allocated_number > 999999 THEN
    RAISE EXCEPTION 'Question number limit reached for subject %, topic %', p_subject, p_topic;
  END IF;

  RETURN format('CET-%s-%s-%s', v_subject_code, v_topic_code, lpad(v_allocated_number::TEXT, 6, '0'));
END;
$$;

REVOKE ALL ON FUNCTION public.next_cet_question_code(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_cet_question_code(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.assign_cet_question_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.question_code ~ '^CET-[A-Z0-9]{2,8}-[A-Z0-9]{2,10}-[0-9]{6}$' THEN
    NEW.question_code := OLD.question_code;
  ELSE
    NEW.question_code := public.next_cet_question_code(NEW.subject, coalesce(nullif(NEW.topic, ''), NEW.chapter, 'General'));
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_cet_question_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_cet_question_code() TO service_role;

DROP TRIGGER IF EXISTS questions_assign_cet_question_code ON public.questions;
CREATE TRIGGER questions_assign_cet_question_code
  BEFORE INSERT OR UPDATE ON public.questions
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_cet_question_code();

WITH existing_codes AS (
  SELECT
    split_part(question_code, '-', 2) AS subject_code,
    split_part(question_code, '-', 3) AS topic_code,
    CASE regexp_replace(lower(trim(coalesce(nullif(topic, ''), nullif(chapter, ''), 'General'))), '[^a-z0-9]+', '', 'g')
      WHEN 'matrix' THEN 'matrices'
      WHEN 'matrices' THEN 'matrices'
      WHEN 'determinant' THEN 'determinants'
      WHEN 'determinants' THEN 'determinants'
      ELSE regexp_replace(lower(trim(coalesce(nullif(topic, ''), nullif(chapter, ''), 'General'))), '[^a-z0-9]+', ' ', 'g')
    END AS topic_key,
    split_part(question_code, '-', 4)::INTEGER AS question_number
  FROM public.questions
  WHERE question_code ~ '^CET-[A-Z0-9]{2,8}-[A-Z0-9]{2,10}-[0-9]{6}$'
),
counter_seeds AS (
  SELECT
    subject_code,
    topic_code,
    min(topic_key) AS topic_key,
    max(question_number) AS last_number
  FROM existing_codes
  GROUP BY subject_code, topic_code
)
INSERT INTO public.cet_question_id_counters (subject_code, topic_code, topic_key, last_number)
SELECT subject_code, topic_code, topic_key, last_number
FROM counter_seeds
ON CONFLICT DO NOTHING;

UPDATE public.cet_question_id_counters AS counter
SET last_number = greatest(counter.last_number, existing.last_number)
FROM (
  SELECT
    split_part(question_code, '-', 2) AS subject_code,
    split_part(question_code, '-', 3) AS topic_code,
    max(split_part(question_code, '-', 4)::INTEGER) AS last_number
  FROM public.questions
  WHERE question_code ~ '^CET-[A-Z0-9]{2,8}-[A-Z0-9]{2,10}-[0-9]{6}$'
  GROUP BY split_part(question_code, '-', 2), split_part(question_code, '-', 3)
) AS existing
WHERE counter.subject_code = existing.subject_code
  AND counter.topic_code = existing.topic_code;

DO $$
DECLARE
  question_row RECORD;
BEGIN
  FOR question_row IN
    SELECT id
    FROM public.questions
    WHERE question_code IS NULL
       OR question_code !~ '^CET-[A-Z0-9]{2,8}-[A-Z0-9]{2,10}-[0-9]{6}$'
    ORDER BY created_at NULLS FIRST, id
  LOOP
    UPDATE public.questions
    SET question_code = NULL
    WHERE id = question_row.id;
  END LOOP;
END;
$$;

ALTER TABLE public.questions
  ALTER COLUMN question_code SET NOT NULL;

ALTER TABLE public.questions
  DROP CONSTRAINT IF EXISTS questions_question_code_format_check;
ALTER TABLE public.questions
  ADD CONSTRAINT questions_question_code_format_check
  CHECK (question_code ~ '^CET-[A-Z0-9]{2,8}-[A-Z0-9]{2,10}-[0-9]{6}$');

CREATE UNIQUE INDEX IF NOT EXISTS questions_question_code_unique
  ON public.questions (question_code);

NOTIFY pgrst, 'reload schema';
