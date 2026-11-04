require('dotenv').config({ path: './.env' });
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT
});

async function main() {
  console.log('🛠️ Creando tabla telemetria_accesos en PostgreSQL local (etiquetas)...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.telemetria_accesos (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      cliente_nombre TEXT,
      dispositivo TEXT,
      latencia_ms INTEGER DEFAULT 2,
      tipo_acceso TEXT DEFAULT 'Apertura PWA',
      ip_origen TEXT
    );
  `);

  console.log('✅ Tabla public.telemetria_accesos creada exitosamente.');

  // Insertar accesos de prueba recientes (Samsung S22 Ultra, Moto G06 y Cliente Demostracion)
  await pool.query(`
    INSERT INTO public.telemetria_accesos (created_at, cliente_nombre, dispositivo, latencia_ms, tipo_acceso)
    VALUES 
      (NOW(), 'Samsung S22 Ultra (Martin)', 'Chrome Mobile 128.0 (Android 14)', 2, 'Apertura Instantánea PWA'),
      (NOW() - INTERVAL '3 minutes', 'Moto G06 (Mamá)', 'Chrome Mobile 126.0 (Android 13)', 2, 'Lectura QR Pedido'),
      (NOW() - INTERVAL '15 minutes', 'Belgian Legacy CB-0030', 'Safari Mobile (iOS 17)', 28, 'Ingreso al Portal B2B')
    ON CONFLICT DO NOTHING;
  `);

  console.log('✅ Registros de prueba insertados con éxito.');
  await pool.end();
}

main().catch(err => {
  console.error('❌ Error creando tabla:', err);
  process.exit(1);
});
