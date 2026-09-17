const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ Missing SUPABASE_URL or Supabase API key in environment.')
    process.exit(1)
  } else {
    console.warn('⚠️ Warning: SUPABASE_URL or Supabase key missing. Some features may not work.')
  }
}

const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseKey || 'placeholder_key', {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

module.exports = supabase
