const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const { Client } = require('pg');

async function createTelemetriaTable() {
  const client = new Client({
    user: 'postgres.zysyxtbcvgswancxtpib',
    host: 'aws-1-sa-east-1.pooler.supabase.com',
    database: 'postgres',
    password: 'wvvx9vZyO5eoZ3Nh',
    port: 6543,
    ssl: { rejectUnauthorized: false }
  });

  console.log('🔌 Conectando a Supabase PostgreSQL Pooler para crear tabla telemetria_accesos...');
  await client.connect();

  const sql = `
    CREATE TABLE IF NOT EXISTS public.telemetria_accesos (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      cliente_nombre TEXT,
      dispositivo TEXT,
      latencia_ms INT DEFAULT 2,
      tipo_acceso TEXT,
      ip_origen TEXT
    );

    ALTER TABLE public.telemetria_accesos ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Permitir insercion publica anonima telemetria" ON public.telemetria_accesos;
    CREATE POLICY "Permitir insercion publica anonima telemetria" 
      ON public.telemetria_accesos 
      FOR INSERT 
      WITH CHECK (true);

    DROP POLICY IF EXISTS "Permitir lectura publica anonima telemetria" ON public.telemetria_accesos;
    CREATE POLICY "Permitir lectura publica anonima telemetria" 
      ON public.telemetria_accesos 
      FOR SELECT 
      USING (true);

    NOTIFY pgrst, 'reload schema';
  `;

  try {
    await client.query(sql);
    console.log('✅ Tabla public.telemetria_accesos y políticas RLS creadas exitosamente en Supabase Cloud!');
  } catch (err) {
    console.error('❌ Error creando tabla en Supabase:', err.message);
  } finally {
    await client.end();
  }
}

createTelemetriaTable();
