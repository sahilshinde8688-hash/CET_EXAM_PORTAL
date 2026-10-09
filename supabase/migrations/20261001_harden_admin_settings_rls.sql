DROP POLICY IF EXISTS "Admins manage system settings" ON public.system_settings;
DROP POLICY IF EXISTS "Admins read audit logs" ON public.admin_audit_logs;
DROP POLICY IF EXISTS "Admins write audit logs" ON public.admin_audit_logs;

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.system_settings, public.admin_audit_logs
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.system_settings, public.admin_audit_logs
  TO service_role;