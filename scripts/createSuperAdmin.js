// Seed script to create a Super Admin user for development/testing
// ------------------------------------------------------------
// This script uses the Supabase client library to insert a user
// with admin privileges. It is intended for local development only
// and should never be run in production.
// ------------------------------------------------------------

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // service role key needed for admin writes

if (!supabaseUrl || !supabaseKey) {
  console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Desired credentials (dev only)
const email = 'sahil@example.com';
const password = 'sahil'; // NOTE: In a real system passwords are hashed by Supabase automatically

async function createSuperAdmin() {
  // Check if a user already exists
  const { data: existing, error: fetchErr } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .single();

  if (fetchErr && fetchErr.code !== 'PGRST116') {
    console.error('Error checking existing user:', fetchErr);
    process.exit(1);
  }

  if (existing) {
    console.log(`Super admin user already exists with id ${existing.id}`);
    return;
  }

  // Create the user via Supabase Auth (will hash password automatically)
  const { user, error: authErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    // Mark as admin and Super Admin via metadata
    user_metadata: { role: 'admin', admin_role: 'super' },
  });

  if (authErr) {
    console.error('Error creating user:', authErr);
    process.exit(1);
  }

  console.log('Super admin user created:', user.id);
}

createSuperAdmin()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
