const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
const tokenRole = (() => {
  try {
    return JSON.parse(Buffer.from(supabaseKey.split('.')[1], 'base64url').toString()).role
  } catch {
    return null
  }
})()
const hasServiceRoleKey = Boolean(supabaseKey && (
  supabaseKey.startsWith('sb_secret_') || tokenRole === 'service_role'
))

if (!supabaseUrl || !hasServiceRoleKey) {
  throw new Error('Backend requires SUPABASE_URL and a server-only SUPABASE_SERVICE_ROLE_KEY. Anon/publishable keys cannot authenticate users.')
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

module.exports = supabase
