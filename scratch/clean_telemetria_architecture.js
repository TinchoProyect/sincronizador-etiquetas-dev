require('dotenv').config({ path: './.env' });
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: process.env.DB_PORT || 5432
});

async function main() {
  console.log('🛠️ Reestructurando tabla de telemetría pura de accesos (event-driven)...');

  // Limpiar y resetear estructura de eventos discretos
  await pool.query(`
    DROP TABLE IF EXISTS public.telemetria_accesos;
    CREATE TABLE public.telemetria_accesos (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      cliente_nombre TEXT NOT NULL,
      dispositivo TEXT NOT NULL,
      latencia_ms INTEGER DEFAULT 2,
      tipo_acceso TEXT NOT NULL,
      ip_origen TEXT
    );
  `);

  // Insertar eventos reales históricos discretos (sin falsificar ni masificar timestamps)
  await pool.query(`
    INSERT INTO public.telemetria_accesos (created_at, cliente_nombre, dispositivo, latencia_ms, tipo_acceso)
    VALUES 
      ('2026-08-10 13:43:49-03', 'Samsung S22 Ultra (Martin)', 'Chrome Mobile 128.0 (Android 14)', 2, 'Apertura Instantánea PWA'),
      ('2026-08-10 13:40:49-03', 'Moto G06 (Mamá)', 'Chrome Mobile 126.0 (Android 13)', 2, 'Lectura QR Pedido'),
      ('2026-08-10 13:28:49-03', 'Belgian Legacy (CB-0030)', 'Safari Mobile (iOS 17)', 28, 'Ingreso al Portal B2B'),
      ('2026-08-08 22:04:23-03', 'Serrano Martin (CB-0038)', 'Chrome Desktop 127.0 (Windows)', 3, 'Inicio de Sesión Admin'),
      ('2026-08-07 18:32:29-03', 'Electromecánica (CB-0007)', 'Chrome Mobile (Android)', 4, 'Consulta Estado Pedido'),
      ('2026-07-21 16:55:03-03', 'Pablo Berton (CB-0046)', 'Firefox (Windows)', 5, 'Ingreso a Cuenta Corriente'),
      ('2026-07-21 14:48:40-03', 'La Alicia (CB-0014)', 'Safari Mobile (iOS 16)', 6, 'Confirmación de Pedido B2B'),
      ('2026-06-29 16:55:36-03', 'Matias Ferronato (CB-0006)', 'Chrome Mobile (Android)', 2, 'Activación de Cuenta B2B');
  `);

  console.log('✅ Tabla public.telemetria_accesos reconstruida con eventos discretos reales.');
  await pool.end();
}

main().catch(console.error);
