require('dotenv').config();

const url = process.env.SUPABASE_B2B_URL;
const key = process.env.SUPABASE_B2B_SERVICE_KEY;

async function main() {
  console.log('📡 Cleaning up test invitation from Supabase...');
  const tableUrl = `${url}/rest/v1/clientes_b2b_invitaciones?token=like.test_%25`;
  
  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`
  };

  try {
    const res = await fetch(tableUrl, {
      method: 'DELETE',
      headers: headers
    });
    if (res.ok) {
      console.log('✅ Cleanup successful.');
    } else {
      console.error('❌ Cleanup failed:', res.status, await res.text());
    }
  } catch (err) {
    console.error('❌ Cleanup error:', err.message);
  }
}

main();
