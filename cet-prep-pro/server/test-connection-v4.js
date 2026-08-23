require('dotenv').config({ path: './.env' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  }
)

async function testConnection() {
  try {
    console.log('Attempting to connect to Supabase...')
    const { data, error } = await supabase.from('profiles').select('id').limit(1)

    if (error) {
      console.log('⚠️ Supabase responded, but the query returned an error:', error.message)
      process.exit(0)
    }

    console.log('✅ Supabase connection is configured successfully')
    console.log('Rows returned:', data?.length ?? 0)
    process.exit(0)
  } catch (error) {
    console.error('❌ Supabase connection failed:', error.message)
    process.exit(1)
  }
}

testConnection()