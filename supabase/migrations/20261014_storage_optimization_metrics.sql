CREATE TABLE IF NOT EXISTS public.storage_usage_snapshots (
  snapshot_date DATE PRIMARY KEY,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  database_bytes BIGINT NOT NULL CHECK (database_bytes >= 0),
  storage_bytes BIGINT NOT NULL CHECK (storage_bytes >= 0),
  object_count BIGINT NOT NULL CHECK (object_count >= 0)
);

ALTER TABLE public.storage_usage_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.storage_usage_snapshots
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.storage_usage_snapshots
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_storage_optimization_metrics()
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, storage
AS $$
  WITH objects AS (
    SELECT
      bucket_id,
      name,
      metadata,
      CASE
        WHEN metadata->>'size' ~ '^[0-9]+$' THEN (metadata->>'size')::BIGINT
        ELSE NULL
      END AS size_bytes,
      NULLIF(lower(btrim(metadata->>'sha256')), '') AS sha256
    FROM storage.objects
  ),
  duplicate_checksums AS (
    SELECT sha256, COUNT(*) AS copies
    FROM objects
    WHERE sha256 IS NOT NULL
    GROUP BY sha256
    HAVING COUNT(*) > 1
  )
  SELECT jsonb_build_object(
    'databaseBytes', pg_database_size(current_database()),
    'tables', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'tableName', measured.table_name,
            'bytes', measured.bytes,
            'approximateRows', measured.approximate_rows
          )
          ORDER BY measured.bytes DESC
        ),
        '[]'::JSONB
      )
      FROM (
        SELECT
          n.nspname || '.' || c.relname AS table_name,
          pg_total_relation_size(c.oid) AS bytes,
          GREATEST(c.reltuples::BIGINT, 0) AS approximate_rows
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND c.relpersistence = 'p'
      ) AS measured
    ),
    'storageBytes', (
      SELECT COALESCE(SUM(size_bytes), 0)::BIGINT
      FROM objects
    ),
    'storageObjectCount', (
      SELECT COUNT(*)::BIGINT
      FROM objects
    ),
    'sizeTrackedObjects', (
      SELECT COUNT(*)::BIGINT
      FROM objects
      WHERE size_bytes IS NOT NULL
    ),
    'sha256TrackedObjects', (
      SELECT COUNT(*)::BIGINT
      FROM objects
      WHERE sha256 IS NOT NULL
    ),
    'duplicateObjects', (
      SELECT COALESCE(SUM(copies - 1), 0)::BIGINT
      FROM duplicate_checksums
    ),
    'buckets', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'bucketId', grouped.bucket_id,
            'bytes', grouped.bytes,
            'objectCount', grouped.object_count
          )
          ORDER BY grouped.bytes DESC
        ),
        '[]'::JSONB
      )
      FROM (
        SELECT
          bucket_id,
          COALESCE(SUM(size_bytes), 0)::BIGINT AS bytes,
          COUNT(*)::BIGINT AS object_count
        FROM objects
        GROUP BY bucket_id
      ) AS grouped
    ),
    'largestFiles', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'bucketId', largest.bucket_id,
            'path', largest.name,
            'bytes', largest.size_bytes
          )
          ORDER BY largest.size_bytes DESC
        ),
        '[]'::JSONB
      )
      FROM (
        SELECT bucket_id, name, size_bytes
        FROM objects
        WHERE size_bytes IS NOT NULL
        ORDER BY size_bytes DESC
        LIMIT 10
      ) AS largest
    ),
    'measuredAt', NOW()
  );
$$;

REVOKE ALL ON FUNCTION public.get_storage_optimization_metrics() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_storage_optimization_metrics() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_storage_optimization_metrics() TO service_role;
