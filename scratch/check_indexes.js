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
    console.log('🔍 Verificando índices en clientes_b2b_perfiles y perfiles_listas...');
    
    const resIndexes = await client.query(`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename LIKE 'clientes_b2b_%';
    `);

    console.log(`📋 Encontrados ${resIndexes.rows.length} índices:`);
    resIndexes.rows.forEach(r => {
      console.log(`  - Tabla: ${r.tablename} | Índice: ${r.indexname} -> ${r.indexdef}`);
    });

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await client.end();
  }
}

main();
