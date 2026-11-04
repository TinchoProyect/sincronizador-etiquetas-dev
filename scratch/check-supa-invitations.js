const requireEnv = require('dotenv').config();

async function main() {
  const url = process.env.SUPABASE_B2B_URL;
  const key = process.env.SUPABASE_B2B_SERVICE_KEY;

  if (!url || !key) {
    console.error('Error: SUPABASE_B2B_URL or SUPABASE_B2B_SERVICE_KEY is missing in .env');
    return;
  }

  console.log('📡 Fetching invitations from Supabase...');
  const tableUrl = `${url}/rest/v1/clientes_b2b_invitaciones?select=*`;
  
  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`
  };

  try {
    const res = await fetch(tableUrl, { headers });
    if (res.ok) {
      const data = await res.json();
      console.log(`✅ Table read successful. Found ${data.length} invitations:`);
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.error(`❌ HTTP Error ${res.status}:`, await res.text());
    }
  } catch (err) {
    console.error('❌ Fetch failed:', err.message);
  }
}

main();
