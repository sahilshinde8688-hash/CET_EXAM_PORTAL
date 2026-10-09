-- ============================================================================
-- Super Admin Control Panel Migration
-- Features: 1-Click Admin Lock, Force Logout, API Usage Logs, Security Alerts, Backup Logs
-- ============================================================================

-- 1. Extend Users table for 1-Click Lock & Audit & Cluster Management
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS locked_reason TEXT,
ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS cluster_id VARCHAR(50) DEFAULT 'default';

-- 2. API Usage Logs
CREATE TABLE IF NOT EXISTS public.api_usage_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    cluster_id VARCHAR(50) DEFAULT 'default',
    endpoint VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    status_code INT NOT NULL,
    response_time_ms INT DEFAULT 0,
    ip_address VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_created_at ON public.api_usage_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_user_id ON public.api_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_endpoint ON public.api_usage_logs(endpoint);
CREATE INDEX IF NOT EXISTS idx_api_usage_status ON public.api_usage_logs(status_code);

-- 3. Security Alerts System
CREATE TABLE IF NOT EXISTS public.security_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_type VARCHAR(50) NOT NULL, -- 'BRUTE_FORCE', 'ADMIN_LOCKED', 'API_SPIKE', 'UNAUTHORIZED_ACCESS', 'SERVER_LOAD', 'BACKUP_FAILED'
    severity VARCHAR(20) NOT NULL DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
    description TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'investigating', 'resolved'
    resolved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_alerts_status ON public.security_alerts(status, severity);
CREATE INDEX IF NOT EXISTS idx_security_alerts_created_at ON public.security_alerts(created_at DESC);

-- 4. Data Backup Logs
CREATE TABLE IF NOT EXISTS public.backup_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    backup_type VARCHAR(30) NOT NULL DEFAULT 'full_db', -- 'full_db', 'users_only', 'questions_only'
    file_name VARCHAR(255) NOT NULL,
    file_size_bytes BIGINT DEFAULT 0,
    storage_path TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'completed', -- 'in_progress', 'completed', 'failed'
    error_message TEXT,
    triggered_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_logs_created_at ON public.backup_logs(created_at DESC);

-- 5. Row Level Security Policies
ALTER TABLE public.api_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_logs ENABLE ROW LEVEL SECURITY;

-- Allow service_role and backend access
DROP POLICY IF EXISTS "Admins full access to api_usage_logs" ON public.api_usage_logs;
CREATE POLICY "Admins full access to api_usage_logs" ON public.api_usage_logs
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admins full access to security_alerts" ON public.security_alerts;
CREATE POLICY "Admins full access to security_alerts" ON public.security_alerts
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admins full access to backup_logs" ON public.backup_logs;
CREATE POLICY "Admins full access to backup_logs" ON public.backup_logs
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);
