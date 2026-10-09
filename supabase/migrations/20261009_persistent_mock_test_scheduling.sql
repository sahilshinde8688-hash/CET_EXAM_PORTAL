ALTER TABLE public.mock_test_assignments
  ADD COLUMN IF NOT EXISTS time_zone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS scheduling_status TEXT NOT NULL DEFAULT 'scheduled',
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;

ALTER TABLE public.mock_test_assignments
  DROP CONSTRAINT IF EXISTS mock_test_assignments_scheduling_status_check;

ALTER TABLE public.mock_test_assignments
  ADD CONSTRAINT mock_test_assignments_scheduling_status_check
    CHECK (scheduling_status IN ('draft', 'scheduled', 'active', 'expired', 'cancelled'));

UPDATE public.mock_test_assignments
SET scheduling_status = CASE
  WHEN status <> 'active' THEN 'cancelled'
  WHEN visibility = 'draft' THEN 'draft'
  WHEN ends_at <= NOW() THEN 'expired'
  WHEN starts_at <= NOW() THEN 'active'
  ELSE 'scheduled'
END,
activated_at = CASE
  WHEN status = 'active' AND visibility <> 'draft' AND starts_at <= NOW() AND ends_at > NOW() THEN starts_at
  ELSE activated_at
END,
expired_at = CASE
  WHEN status = 'active' AND visibility <> 'draft' AND ends_at <= NOW() THEN ends_at
  ELSE expired_at
END;

ALTER TABLE public.mock_test_attempts
  DROP CONSTRAINT IF EXISTS mock_test_attempts_status_check;

ALTER TABLE public.mock_test_attempts
  ADD CONSTRAINT mock_test_attempts_status_check
    CHECK (status IN ('in_progress', 'submitted', 'expired'));

ALTER TABLE public.test_results
  ADD COLUMN IF NOT EXISTS mock_test_attempt_id UUID
    REFERENCES public.mock_test_attempts(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_test_results_mock_test_attempt
  ON public.test_results(mock_test_attempt_id)
  WHERE mock_test_attempt_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mock_test_assignments_schedule
  ON public.mock_test_assignments(scheduling_status, starts_at, ends_at)
  WHERE status = 'active';
