const { Client } = require('pg');
require('dotenv').config();

async function main() {
  // Conectar a la base de datos de Supabase B2B usando las credenciales entregadas
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
    
    console.log('🔨 Agregando columna local_movimiento_id a la tabla public.clientes_b2b_cuentas_corrientes...');
    await client.query(`
      ALTER TABLE public.clientes_b2b_cuentas_corrientes 
      ADD COLUMN IF NOT EXISTS local_movimiento_id INTEGER UNIQUE;
    `);
    console.log('✅ Columna agregada y configurada con constraint UNIQUE con éxito.');
    
  } catch (err) {
    console.error('❌ Error ejecutando migración remota:', err.message);
  } finally {
    await client.end();
  }
}

main();
