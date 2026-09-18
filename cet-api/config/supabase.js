const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY

if (!supabaseUrl) {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ Missing SUPABASE_URL in environment.')
    process.exit(1)
  } else {
    console.warn('⚠️ Warning: SUPABASE_URL missing. Some features may not work.')
  }
}

if (!supabaseKey) {
  const anonKey = process.env.SUPABASE_ANON_KEY
  console.error(
    anonKey
      ? '❌ Missing SUPABASE_SERVICE_ROLE_KEY. Backend writes to sessions/refresh_tokens/login_history will be blocked by Supabase RLS.'
      : '❌ Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY. Backend writes to protected tables will be blocked by Supabase RLS.'
  )

  if (process.env.NODE_ENV === 'production') {
    process.exit(1)
  }
}

const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseKey || 'placeholder_key', {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

module.exports = supabase
