const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: parseInt(process.env.DB_PORT || '5432'),
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('🏁 [MIGRATION-2.6] Iniciando alteración de tablas...');
    
    // 1. Alterar presupuestos_detalles
    console.log('➡️ Añadiendo cantidad_original a public.presupuestos_detalles...');
    await client.query('ALTER TABLE public.presupuestos_detalles ADD COLUMN IF NOT EXISTS cantidad_original NUMERIC;');
    
    // 2. Alterar entregas_eventos
    console.log('➡️ Añadiendo tipo_evento a public.entregas_eventos...');
    await client.query("ALTER TABLE public.entregas_eventos ADD COLUMN IF NOT EXISTS tipo_evento VARCHAR(50) DEFAULT 'ENTREGA';");
    
    console.log('➡️ Añadiendo motivo_incidencia a public.entregas_eventos...');
    await client.query('ALTER TABLE public.entregas_eventos ADD COLUMN IF NOT EXISTS motivo_incidencia TEXT;');
    
    console.log('✅ [MIGRATION-2.6] Tablas alteradas exitosamente.');
  } catch (err) {
    console.error('❌ [MIGRATION-2.6] Error en la migración:', err);
  } finally {
    client.release();
    pool.end();
  }
}

run();
