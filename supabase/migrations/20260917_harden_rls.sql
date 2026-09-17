-- ==============================================================================
-- 20260917_harden_rls.sql
-- MIGRATION: Harden Supabase Row Level Security (RLS) & Eliminate Security Risks
-- ==============================================================================

-- 1. DROP ALL OVERLY PERMISSIVE "ALLOW ALL" POLICIES
DROP POLICY IF EXISTS "Allow all for users" ON public.users;
DROP POLICY IF EXISTS "Allow all for sessions" ON public.sessions;
DROP POLICY IF EXISTS "Allow all for refresh_tokens" ON public.refresh_tokens;
DROP POLICY IF EXISTS "Allow all for login_history" ON public.login_history;
DROP POLICY IF EXISTS "Allow all for questions" ON public.questions;
DROP POLICY IF EXISTS "Allow all for mock_tests" ON public.mock_tests;
DROP POLICY IF EXISTS "Allow all for test_results" ON public.test_results;
DROP POLICY IF EXISTS "Allow anonymous registrations" ON public.users;
DROP POLICY IF EXISTS "Allow anonymous test submissions" ON public.test_results;

-- 2. ENSURE ROW LEVEL SECURITY IS ACTIVE ON ALL TABLES
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_results ENABLE ROW LEVEL SECURITY;

-- 3. REMOVE PLAINTEXT PASSWORD COLUMN FROM USERS
-- All passwords are stored exclusively as bcrypt hashes in public.users.password
ALTER TABLE public.users DROP COLUMN IF EXISTS mhcet_password;

-- 4. STRICT ROW LEVEL SECURITY POLICIES

-- SESSIONS, REFRESH TOKENS, LOGIN HISTORY
-- Service role only. No direct access for anon or authenticated client-side connections.
-- (When RLS is enabled with no policies granting access, anon/authenticated are completely blocked)

-- USERS TABLE
-- Authenticated users can view their own record only
CREATE POLICY "Users can view own profile"
  ON public.users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- QUESTIONS TABLE
-- Public / students can view active questions only (read-only)
-- All mutations (INSERT, UPDATE, DELETE) are restricted to backend service role
CREATE POLICY "Active questions are viewable"
  ON public.questions
  FOR SELECT
  TO authenticated, anon
  USING (is_active = true);

-- MOCK TESTS TABLE
-- Read-only view for published mock tests
-- All mutations are restricted to backend service role
CREATE POLICY "Active mock tests are viewable"
  ON public.mock_tests
  FOR SELECT
  TO authenticated, anon
  USING (status IN ('active', 'scheduled'));

-- TEST RESULTS TABLE
-- Authenticated users can only view their own test results
-- Direct client-side insertion is blocked; submissions must route through backend API
CREATE POLICY "Users can view own test results"
  ON public.test_results
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 5. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_mhcet_id ON public.users(mhcet_id);
CREATE INDEX IF NOT EXISTS idx_users_role_status ON public.users(role, status);
CREATE INDEX IF NOT EXISTS idx_questions_active_subject ON public.questions(is_active, subject);
CREATE INDEX IF NOT EXISTS idx_mock_tests_status ON public.mock_tests(status);
