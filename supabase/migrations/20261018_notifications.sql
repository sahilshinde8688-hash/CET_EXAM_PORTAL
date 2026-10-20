CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('exam_update', 'test_assignment', 'result', 'reminder', 'system_alert')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1000),
  target_page TEXT NOT NULL DEFAULT 'dashboard'
    CHECK (target_page IN ('dashboard', 'mocktests', 'results', 'analytics', 'settings')),
  target_type TEXT CHECK (target_type IN ('assignment', 'result')),
  target_id UUID,
  dedupe_key TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, dedupe_key)
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE OR REPLACE FUNCTION public.notify_assigned_students()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'active' OR NEW.visibility = 'draft' THEN
    RETURN NEW;
  END IF;
  IF COALESCE((
    SELECT value #>> '{}' FROM public.system_settings WHERE key = 'in_app_notifications'
  ), 'true') = 'false' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = NEW.status AND OLD.visibility = NEW.visibility THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.notifications (
    user_id, category, title, message, target_page, target_type, target_id, dedupe_key
  )
  SELECT
    recipient.user_id,
    'test_assignment',
    'New test assigned',
    NEW.mock_test_name || ' has been assigned to you.',
    'mocktests',
    'assignment',
    NEW.id,
    'assignment:' || NEW.id::TEXT || ':created'
  FROM unnest(NEW.student_ids) AS recipient(user_id)
  ON CONFLICT (user_id, dedupe_key) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mock_test_assignment_notification_insert ON public.mock_test_assignments;
CREATE TRIGGER mock_test_assignment_notification_insert
  AFTER INSERT ON public.mock_test_assignments
  FOR EACH ROW EXECUTE FUNCTION public.notify_assigned_students();

DROP TRIGGER IF EXISTS mock_test_assignment_notification_publish ON public.mock_test_assignments;
CREATE TRIGGER mock_test_assignment_notification_publish
  AFTER UPDATE OF status, visibility ON public.mock_test_assignments
  FOR EACH ROW EXECUTE FUNCTION public.notify_assigned_students();

REVOKE ALL ON FUNCTION public.notify_assigned_students() FROM PUBLIC, anon, authenticated;

INSERT INTO public.notifications (
  user_id, category, title, message, target_page, target_type, target_id, dedupe_key
)
SELECT
  recipient.user_id,
  'test_assignment',
  'New test assigned',
  assignment.mock_test_name || ' has been assigned to you.',
  'mocktests',
  'assignment',
  assignment.id,
  'assignment:' || assignment.id::TEXT || ':created'
FROM public.mock_test_assignments assignment
CROSS JOIN LATERAL unnest(assignment.student_ids) AS recipient(user_id)
WHERE assignment.status = 'active'
  AND assignment.visibility <> 'draft'
  AND assignment.ends_at > NOW()
  AND COALESCE((
    SELECT value #>> '{}' FROM public.system_settings WHERE key = 'in_app_notifications'
  ), 'true') <> 'false'
ON CONFLICT (user_id, dedupe_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.notify_published_test_result()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result_visibility TEXT;
  assignment_end TIMESTAMPTZ;
BEGIN
  IF COALESCE((
    SELECT value #>> '{}' FROM public.system_settings WHERE key = 'in_app_notifications'
  ), 'true') = 'false'
    OR COALESCE((
      SELECT value #>> '{}' FROM public.system_settings WHERE key = 'result_notifications'
    ), 'true') = 'false' THEN
    RETURN NEW;
  END IF;

  IF NEW.mock_test_attempt_id IS NOT NULL THEN
    SELECT assignment.result_visibility, assignment.ends_at
      INTO result_visibility, assignment_end
    FROM public.mock_test_attempts attempt
    JOIN public.mock_test_assignments assignment ON assignment.id = attempt.assignment_id
    WHERE attempt.id = NEW.mock_test_attempt_id;

    IF result_visibility IS NULL
      OR result_visibility IN ('hidden', 'admin_only')
      OR (result_visibility = 'after_close' AND NOW() < assignment_end) THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.notifications (
    user_id, category, title, message, target_page, target_type, target_id, dedupe_key
  ) VALUES (
    NEW.user_id,
    'result',
    'Your test result is ready',
    'Your result for ' || NEW.test_name || ' is available to review.',
    'results',
    'result',
    NEW.id,
    'result:' || NEW.id::TEXT || ':published'
  )
  ON CONFLICT (user_id, dedupe_key) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS test_result_notification_insert ON public.test_results;
CREATE TRIGGER test_result_notification_insert
  AFTER INSERT ON public.test_results
  FOR EACH ROW EXECUTE FUNCTION public.notify_published_test_result();

REVOKE ALL ON FUNCTION public.notify_published_test_result() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_results_when_visible()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.result_visibility NOT IN ('immediate', 'after_close')
    OR (NEW.result_visibility = 'after_close' AND NOW() < NEW.ends_at)
    OR COALESCE((
      SELECT value #>> '{}' FROM public.system_settings WHERE key = 'in_app_notifications'
    ), 'true') = 'false'
    OR COALESCE((
      SELECT value #>> '{}' FROM public.system_settings WHERE key = 'result_notifications'
    ), 'true') = 'false' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    user_id, category, title, message, target_page, target_type, target_id, dedupe_key
  )
  SELECT
    result.user_id,
    'result',
    'Your test result is ready',
    'Your result for ' || result.test_name || ' is available to review.',
    'results',
    'result',
    result.id,
    'result:' || result.id::TEXT || ':published'
  FROM public.mock_test_attempts attempt
  JOIN public.test_results result ON result.mock_test_attempt_id = attempt.id
  WHERE attempt.assignment_id = NEW.id
  ON CONFLICT (user_id, dedupe_key) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mock_test_assignment_result_visibility ON public.mock_test_assignments;
CREATE TRIGGER mock_test_assignment_result_visibility
  AFTER UPDATE OF result_visibility, ends_at, scheduling_status ON public.mock_test_assignments
  FOR EACH ROW EXECUTE FUNCTION public.notify_results_when_visible();

REVOKE ALL ON FUNCTION public.notify_results_when_visible() FROM PUBLIC, anon, authenticated;

INSERT INTO public.notifications (
  user_id, category, title, message, target_page, target_type, target_id, dedupe_key
)
SELECT
  result.user_id,
  'result',
  'Your test result is ready',
  'Your result for ' || result.test_name || ' is available to review.',
  'results',
  'result',
  result.id,
  'result:' || result.id::TEXT || ':published'
FROM public.mock_test_attempts attempt
JOIN public.mock_test_assignments assignment ON assignment.id = attempt.assignment_id
JOIN public.test_results result ON result.mock_test_attempt_id = attempt.id
WHERE (
    assignment.result_visibility = 'immediate'
    OR (assignment.result_visibility = 'after_close' AND NOW() >= assignment.ends_at)
  )
  AND COALESCE((
    SELECT value #>> '{}' FROM public.system_settings WHERE key = 'in_app_notifications'
  ), 'true') <> 'false'
  AND COALESCE((
    SELECT value #>> '{}' FROM public.system_settings WHERE key = 'result_notifications'
  ), 'true') <> 'false'
ON CONFLICT (user_id, dedupe_key) DO NOTHING;
