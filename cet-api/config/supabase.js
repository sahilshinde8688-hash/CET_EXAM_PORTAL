const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.SUPABASE_URL || 'https://oexapzfmvwkrhqgbwnjn.supabase.co'
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_j5fiz46MlYZ5XIsmCvLMQw_ZLL2GHZ0'

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

module.exports = supabase
