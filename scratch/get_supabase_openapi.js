const requireEnv = require('dotenv').config();

async function main() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) {
    console.error('No SUPABASE_SERVICE_KEY in .env');
    return;
  }
  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

  const url = 'https://wofttcnpipozwupmpuul.supabase.co/rest/v1/';
  const res = await fetch(url, { headers });
  if (res.ok) {
    const data = await res.json();
    console.log('--- SUPABASE PATHS (TABLES) ---');
    const paths = Object.keys(data.paths || {});
    console.log(paths);
  } else {
    console.error('Error fetching PostgREST schema:', await res.text());
  }
}

main();
