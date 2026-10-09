-- Store low-frequency host metrics for Super Admin performance charts.
CREATE TABLE IF NOT EXISTS public.system_metrics (
  id BIGSERIAL PRIMARY KEY,
  cpu_usage NUMERIC,
  memory_usage NUMERIC,
  disk_usage NUMERIC,
  load_average NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_metrics_created_at
  ON public.system_metrics(created_at DESC);

ALTER TABLE public.system_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access to api_usage_logs" ON public.api_usage_logs;
DROP POLICY IF EXISTS "Admins full access to security_alerts" ON public.security_alerts;
DROP POLICY IF EXISTS "Admins full access to backup_logs" ON public.backup_logs;
REVOKE ALL PRIVILEGES ON TABLE public.api_usage_logs, public.security_alerts, public.backup_logs, public.system_metrics
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.api_usage_logs, public.security_alerts, public.backup_logs, public.system_metrics
  TO service_role;
REVOKE ALL ON SEQUENCE public.system_metrics_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.system_metrics_id_seq TO service_role;
REVOKE ALL ON SEQUENCE public.api_usage_logs_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.api_usage_logs_id_seq TO service_role;

CREATE INDEX IF NOT EXISTS idx_users_created_at ON public.users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mock_tests_created_at ON public.mock_tests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_questions_created_at ON public.questions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_results_attempted_at ON public.test_results(attempted_at DESC);

CREATE OR REPLACE FUNCTION public.get_super_admin_analytics(
  metric_name TEXT,
  from_time TIMESTAMPTZ,
  bucket_unit TEXT,
  timezone_name TEXT
)
RETURNS TABLE(bucket_start TIMESTAMPTZ, total BIGINT)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF metric_name NOT IN ('attempts', 'registrations', 'questions', 'exams')
     OR bucket_unit NOT IN ('day', 'week', 'month') THEN
    RAISE EXCEPTION 'Unsupported analytics metric or time bucket';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = timezone_name) THEN
    RAISE EXCEPTION 'Unsupported analytics timezone';
  END IF;

  RETURN QUERY
  WITH source_rows AS (
    SELECT attempted_at AS event_time
    FROM public.test_results
    WHERE metric_name = 'attempts' AND attempted_at >= from_time
    UNION ALL
    SELECT created_at
    FROM public.users
    WHERE metric_name = 'registrations' AND role = 'student' AND created_at >= from_time
    UNION ALL
    SELECT created_at
    FROM public.questions
    WHERE metric_name = 'questions' AND created_at >= from_time
    UNION ALL
    SELECT created_at
    FROM public.mock_tests
    WHERE metric_name = 'exams' AND created_at >= from_time
  )
  SELECT date_trunc(bucket_unit, source_rows.event_time, timezone_name), count(*)::BIGINT
  FROM source_rows
  GROUP BY 1
  ORDER BY 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_super_admin_analytics(TEXT, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_super_admin_analytics(TEXT, TIMESTAMPTZ, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_super_admin_analytics(TEXT, TIMESTAMPTZ, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.get_super_admin_performance(
  from_time TIMESTAMPTZ,
  bucket_unit TEXT,
  timezone_name TEXT
)
RETURNS TABLE(
  bucket_start TIMESTAMPTZ,
  cpu_usage NUMERIC,
  memory_usage NUMERIC,
  disk_usage NUMERIC,
  load_average NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF bucket_unit NOT IN ('minute', 'hour', 'day') THEN
    RAISE EXCEPTION 'Unsupported performance time bucket';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = timezone_name) THEN
    RAISE EXCEPTION 'Unsupported performance timezone';
  END IF;

  RETURN QUERY
  SELECT
    date_trunc(bucket_unit, metrics.created_at, timezone_name) AS bucket_start,
    avg(metrics.cpu_usage) AS cpu_usage,
    avg(metrics.memory_usage) AS memory_usage,
    avg(metrics.disk_usage) AS disk_usage,
    avg(metrics.load_average) AS load_average
  FROM public.system_metrics AS metrics
  WHERE metrics.created_at >= from_time
  GROUP BY 1
  ORDER BY 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_super_admin_performance(TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_super_admin_performance(TIMESTAMPTZ, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_super_admin_performance(TIMESTAMPTZ, TEXT, TEXT) TO service_role;
