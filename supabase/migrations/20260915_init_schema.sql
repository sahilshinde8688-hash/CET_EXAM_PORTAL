-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password TEXT,
  branch TEXT NOT NULL CHECK (branch IN ('Byculla', 'Worli', 'Prabhadevi')),
  batch INTEGER NOT NULL,
  role TEXT DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  mhcet_id TEXT UNIQUE,
  mhcet_password TEXT,
  photo TEXT,
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  must_reset_password BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. SESSIONS TABLE
CREATE TABLE IF NOT EXISTS public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  device_name TEXT DEFAULT 'Unknown Device',
  browser TEXT DEFAULT 'Unknown Browser',
  operating_system TEXT DEFAULT 'Unknown OS',
  ip_address TEXT DEFAULT 'Unknown IP',
  country TEXT DEFAULT '',
  login_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  is_current BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. REFRESH TOKENS TABLE
CREATE TABLE IF NOT EXISTS public.refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  device_name TEXT DEFAULT 'Unknown Device',
  browser TEXT DEFAULT 'Unknown Browser',
  operating_system TEXT DEFAULT 'Unknown OS',
  ip_address TEXT DEFAULT 'Unknown IP',
  country TEXT DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  replaced_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. LOGIN HISTORY TABLE
CREATE TABLE IF NOT EXISTS public.login_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  session_id TEXT DEFAULT '',
  event TEXT NOT NULL,
  ip_address TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  browser TEXT DEFAULT '',
  operating_system TEXT DEFAULT '',
  device_name TEXT DEFAULT '',
  country TEXT DEFAULT '',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. QUESTIONS TABLE
CREATE TABLE IF NOT EXISTS public.questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL,
  chapter TEXT DEFAULT '',
  topic TEXT NOT NULL,
  sub_topic TEXT DEFAULT '',
  text TEXT NOT NULL,
  image_url TEXT DEFAULT '',
  options TEXT[] NOT NULL,
  correct_index INTEGER NOT NULL,
  solution TEXT DEFAULT '',
  marks NUMERIC DEFAULT 2,
  negative_marks NUMERIC DEFAULT 0.5,
  difficulty TEXT DEFAULT 'Medium' CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. MOCK TESTS TABLE
CREATE TABLE IF NOT EXISTS public.mock_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  questions INTEGER NOT NULL,
  duration INTEGER NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
  status TEXT DEFAULT 'draft' CHECK (status IN ('active', 'scheduled', 'draft')),
  attempts INTEGER DEFAULT 0,
  avg_score NUMERIC DEFAULT 0,
  scheduled_date TEXT,
  created_by TEXT,
  question_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. TEST RESULTS TABLE
CREATE TABLE IF NOT EXISTS public.test_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  test_name TEXT NOT NULL,
  subject TEXT,
  score NUMERIC NOT NULL,
  total_marks NUMERIC NOT NULL,
  percentile NUMERIC,
  duration INTEGER,
  attempted_at TIMESTAMPTZ DEFAULT NOW(),
  correct INTEGER DEFAULT 0,
  incorrect INTEGER DEFAULT 0,
  unanswered INTEGER DEFAULT 0,
  total_questions INTEGER DEFAULT 0,
  subject_wise_scores JSONB DEFAULT '[]'::jsonb,
  answers JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON public.sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON public.refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON public.refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_login_history_user_id ON public.login_history(user_id);
CREATE INDEX IF NOT EXISTS idx_test_results_user_id ON public.test_results(user_id);
CREATE INDEX IF NOT EXISTS idx_test_results_attempted ON public.test_results(user_id, attempted_at DESC);

-- ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_results ENABLE ROW LEVEL SECURITY;

-- Disable RLS or grant full access policy to anon & authenticated for public API access
DROP POLICY IF EXISTS "Allow all for users" ON public.users;
CREATE POLICY "Allow all for users" ON public.users FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for sessions" ON public.sessions;
CREATE POLICY "Allow all for sessions" ON public.sessions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for refresh_tokens" ON public.refresh_tokens;
CREATE POLICY "Allow all for refresh_tokens" ON public.refresh_tokens FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for login_history" ON public.login_history;
CREATE POLICY "Allow all for login_history" ON public.login_history FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for questions" ON public.questions;
CREATE POLICY "Allow all for questions" ON public.questions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for mock_tests" ON public.mock_tests;
CREATE POLICY "Allow all for mock_tests" ON public.mock_tests FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for test_results" ON public.test_results;
CREATE POLICY "Allow all for test_results" ON public.test_results FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
