const requireEnv = require('dotenv').config();

async function getCount(name, url, headers) {
  try {
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = await res.json();
      console.log(`📊 [COUNT] ${name}: ${data.length} rows`);
      return true;
    } else {
      console.error(`❌ [FAIL] ${name}: HTTP ${res.status} - ${await res.text()}`);
      return false;
    }
  } catch (err) {
    console.error(`❌ [ERROR] ${name}:`, err.message);
    return false;
  }
}

async function main() {
  const url = process.env.SUPABASE_B2B_URL;
  const key = process.env.SUPABASE_B2B_SERVICE_KEY;

  if (!url || !key) {
    console.error('Error: SUPABASE_B2B_URL or SUPABASE_B2B_SERVICE_KEY is missing in .env');
    return;
  }

  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`
  };

  const tables = [
    'clientes_b2b_perfiles',
    'clientes_b2b_perfiles_listas',
    'clientes_b2b_cuentas_corrientes',
    'clientes_b2b_catalogo_precios',
    'clientes_b2b_pedidos_cabecera',
    'clientes_b2b_pedidos_items'
  ];

  console.log('📡 Fetching total row counts from Supabase...');
  for (const table of tables) {
    const tableUrl = `${url}/rest/v1/${table}`;
    await getCount(table, tableUrl, headers);
  }
}

main();
