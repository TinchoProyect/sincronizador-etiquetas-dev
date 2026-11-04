const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { Client } = require('pg');

async function main() {
  const client = new Client({
    user: 'postgres.zysyxtbcvgswancxtpib',
    host: 'aws-1-sa-east-1.pooler.supabase.com',
    database: 'postgres',
    password: 'wvvx9vZyO5eoZ3Nh',
    port: 6543,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    console.log('🔍 Buscando cliente Belgian (CB-0030) en PostgreSQL local / Supabase...');
    
    // Buscar en postgres local y en supabase
    const resSupa = await client.query(`
      SELECT * FROM public.clientes_b2b_perfiles WHERE cliente_id ILIKE '%0030%' OR nombre_empresa ILIKE '%belgian%';
    `);
    console.log('📋 Supabase clientes_b2b_perfiles:', resSupa.rows);

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await client.end();
  }
}

main();
