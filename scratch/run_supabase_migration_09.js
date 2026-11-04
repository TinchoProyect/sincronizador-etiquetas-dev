const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function main() {
  const client = new Client({
    user: 'postgres.zysyxtbcvgswancxtpib',
    host: 'aws-1-sa-east-1.pooler.supabase.com',
    database: 'postgres',
    password: 'wvvx9vZyO5eoZ3Nh',
    port: 6543,
    ssl: {
      rejectUnauthorized: false
    }
  });

  await client.connect();
  try {
    console.log('📡 Conectado a la base de datos remota de Supabase a través del pooler aws-1...');
    
    const sqlPath = path.join(__dirname, '..', 'supabase_migration', '09_add_busqueda_metadata.sql');
    console.log(`📖 Leyendo script SQL de: ${sqlPath}`);
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('🔨 Ejecutando migración 09 en la base de datos remota...');
    await client.query(sql);
    console.log('✅ Migración 09 ejecutada con éxito en la base de datos remota.');
    
  } catch (err) {
    console.error('❌ Error ejecutando migración remota:', err.message);
  } finally {
    await client.end();
  }
}

main();
