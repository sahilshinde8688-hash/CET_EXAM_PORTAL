-- System settings and administrative audit history.
-- API keys are intentionally not stored in this table; keep provider secrets in
-- server-side environment variables or a managed secrets vault.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS admin_role TEXT DEFAULT 'Super Admin';

CREATE TABLE IF NOT EXISTS public.system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT 'null'::jsonb,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  admin_name TEXT NOT NULL DEFAULT 'Admin',
  action TEXT NOT NULL,
  module TEXT NOT NULL,
  ip_address TEXT NOT NULL DEFAULT 'Internal',
  status TEXT NOT NULL DEFAULT 'Success',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON public.admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin_id ON public.admin_audit_logs(admin_id);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage system settings" ON public.system_settings;
CREATE POLICY "Admins manage system settings" ON public.system_settings
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admins read audit logs" ON public.admin_audit_logs;
CREATE POLICY "Admins read audit logs" ON public.admin_audit_logs
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins write audit logs" ON public.admin_audit_logs;
CREATE POLICY "Admins write audit logs" ON public.admin_audit_logs
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);
