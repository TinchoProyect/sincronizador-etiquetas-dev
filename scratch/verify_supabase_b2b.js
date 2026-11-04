const requireEnv = require('dotenv').config();

async function checkEndpoint(name, url, headers) {
  try {
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = await res.json();
      console.log(`✅ [OK] ${name}: Table exists. Sample length: ${data.length}`);
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

  console.log('📡 Verifying Supabase project connection...');
  console.log(`URL: ${url}`);

  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`
  };

  const tables = [
    'clientes_b2b_perfiles',
    'clientes_b2b_perfiles_listas',
    'clientes_b2b_cuentas_corrientes',
    'clientes_b2b_pedidos_cabecera',
    'clientes_b2b_pedidos_items',
    'clientes_b2b_catalogo_precios'
  ];

  let allOk = true;
  for (const table of tables) {
    const tableUrl = `${url}/rest/v1/${table}?limit=1`;
    const ok = await checkEndpoint(table, tableUrl, headers);
    if (!ok) allOk = false;
  }

  if (allOk) {
    console.log('\n🎉 ALL TABLES VERIFIED SUCCESSFULLY! Schema is correctly deployed.');
  } else {
    console.log('\n⚠️ Some tables failed verification. Check the errors above.');
  }
}

main();
