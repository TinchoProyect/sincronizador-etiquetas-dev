require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_B2B_URL;
const SUPABASE_KEY = process.env.SUPABASE_B2B_SERVICE_KEY;

async function checkUsers() {
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`
  };

  try {
    // 1. Query perfiles
    const resProfiles = await fetch(`${SUPABASE_URL}/rest/v1/clientes_b2b_perfiles`, { headers });
    if (resProfiles.ok) {
      const profiles = await resProfiles.json();
      console.log('--- Supabase Perfiles ---');
      console.log(JSON.stringify(profiles, null, 2));
    } else {
      console.error('Error querying profiles:', resProfiles.statusText);
    }

    // 2. Query Auth Users
    const resUsers = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { headers });
    if (resUsers.ok) {
      const usersData = await resUsers.json();
      console.log('\n--- Supabase Auth Users ---');
      console.log(JSON.stringify(usersData.users.map(u => ({
        id: u.id,
        email: u.email,
        user_metadata: u.user_metadata,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at
      })), null, 2));
    } else {
      console.error('Error querying auth users:', resUsers.statusText);
    }
  } catch (err) {
    console.error(err);
  }
}

checkUsers();
