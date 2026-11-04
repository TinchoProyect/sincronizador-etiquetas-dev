const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function main() {
  const client = new Client({
    user: 'postgres',
    host: 'db.zysyxtbcvgswancxtpib.supabase.co',
    database: 'postgres',
    password: 'wvvx9vZyO5eoZ3Nh',
    port: 5432,
  });

  await client.connect();
  try {
    console.log('📡 Conectado a la base de datos remota de Supabase...');
    
    const sqlPath = path.join(__dirname, '..', 'supabase_migration', '04_add_rubro_subrubro.sql');
    console.log(`📖 Leyendo script SQL de: ${sqlPath}`);
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('🔨 Ejecutando migración en la base de datos remota...');
    await client.query(sql);
    console.log('✅ Migración ejecutada con éxito en la base de datos remota.');
    
  } catch (err) {
    console.error('❌ Error ejecutando migración remota:', err.message);
  } finally {
    await client.end();
  }
}

main();
