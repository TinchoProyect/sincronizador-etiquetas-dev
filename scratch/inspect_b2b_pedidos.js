const requireEnv = require('dotenv').config();

async function main() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) {
    console.error('No SUPABASE_SERVICE_KEY in .env');
    return;
  }
  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

  const urlCab = 'https://wofttcnpipozwupmpuul.supabase.co/rest/v1/pedidos_b2b_cabecera?limit=1';
  const resCab = await fetch(urlCab, { headers });
  if (resCab.ok) {
    const data = await resCab.json();
    console.log('--- pedidos_b2b_cabecera SAMPLE ---');
    console.log(data[0] || 'No data');
  }

  const urlOrd = 'https://wofttcnpipozwupmpuul.supabase.co/rest/v1/ordenes_b2b?limit=1';
  const resOrd = await fetch(urlOrd, { headers });
  if (resOrd.ok) {
    const data = await resOrd.json();
    console.log('--- ordenes_b2b SAMPLE ---');
    console.log(data[0] || 'No data');
  }
}

main();
