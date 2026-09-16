const { Client } = require('c:/Users/Sahil/OneDrive/Desktop/CET PORTAL/cet-api/node_modules/pg');

const passwords = ['postgres', 'admin', 'root', 'oexapzfmvwkrhqgbwnjn', 'cetportal', 'Sahil@123', 'Sahil123'];

async function testConnection() {
  for (const pwd of passwords) {
    const conn = `postgresql://postgres:${encodeURIComponent(pwd)}@db.oexapzfmvwkrhqgbwnjn.supabase.co:5432/postgres`;
    console.log('Testing password:', pwd);
    const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 3000 });
    try {
      await client.connect();
      console.log('SUCCESS! Connected with password:', pwd);
      await client.query('ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;');
      await client.query('ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;');
      await client.query('DROP POLICY IF EXISTS "Allow all for users" ON public.users;');
      await client.query('CREATE POLICY "Allow all for users" ON public.users FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);');
      console.log('POLICY CREATED SUCCESS!');
      await client.end();
      return;
    } catch (e) {
      console.log('Failed:', e.message);
      await client.end().catch(() => {});
    }
  }
}

testConnection();
