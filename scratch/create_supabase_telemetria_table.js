require('dotenv').config({ path: './.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_B2B_URL, process.env.SUPABASE_B2B_SERVICE_KEY);

async function main() {
  console.log('🛠️ Creando tabla public.telemetria_accesos en Supabase B2B...');

  // Crear función RPC para ejecutar DDL si es necesario
  const rpcRes = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS public.telemetria_accesos (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        cliente_nombre TEXT,
        dispositivo TEXT,
        latencia_ms INTEGER DEFAULT 2,
        tipo_acceso TEXT DEFAULT 'Apertura PWA',
        ip_origen TEXT
      );
      ALTER TABLE public.telemetria_accesos DISABLE ROW LEVEL SECURITY;
      GRANT ALL ON TABLE public.telemetria_accesos TO anon, authenticated, service_role;
    `
  });

  if (rpcRes.error) {
    console.log('⚠️ exec_sql RPC error:', rpcRes.error.message);
    
    // Probar si la tabla ya permite inserts con el service key
    const insertRes = await supabase.from('telemetria_accesos').insert([{
      cliente_nombre: 'Samsung S22 Ultra (Martin)',
      dispositivo: 'Chrome Mobile (Android 14)',
      latencia_ms: 2,
      tipo_acceso: 'Apertura Instantánea PWA'
    }]).select();

    if (insertRes.error) {
      console.error('❌ Insert directo falló:', insertRes.error.message);
    } else {
      console.log('✅ INSERT DIRECTO EXITOSO EN SUPABASE:\n', insertRes.data);
    }
  } else {
    console.log('✅ Tabla creada en Supabase exitosamente:', rpcRes.data);
  }
}

main().catch(console.error);
