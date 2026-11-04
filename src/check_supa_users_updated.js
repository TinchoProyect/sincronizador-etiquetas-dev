require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_B2B_URL;
const SUPABASE_KEY = process.env.SUPABASE_B2B_SERVICE_KEY;

async function checkUsers() {
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`
  };

  try {
    const resUsers = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { headers });
    if (resUsers.ok) {
      const usersData = await resUsers.json();
      console.log('\n--- Supabase Auth Users (Full Details) ---');
      usersData.users.forEach(u => {
        console.log({
          id: u.id,
          email: u.email,
          created_at: u.created_at,
          updated_at: u.updated_at,
          last_sign_in_at: u.last_sign_in_at,
          user_metadata: u.user_metadata
        });
      });
    } else {
      console.error('Error querying auth users:', resUsers.statusText);
    }
  } catch (err) {
    console.error(err);
  }
}

checkUsers();
