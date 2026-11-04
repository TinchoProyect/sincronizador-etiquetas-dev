const { Pool } = require('pg');
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: process.env.DB_PORT || 5432
});

async function checkRecentData() {
  console.log('🔍 REVISANDO ACCESOS Y ENTREGAS RECIENTES EN POSTGRESQL LOCAL...');
  
  try {
    const r1 = await pool.query(`SELECT * FROM public.telemetria_accesos ORDER BY id DESC LIMIT 5;`);
    console.log('1. telemetria_accesos:', r1.rows);
  } catch (e) { console.log('1. telemetria_accesos error:', e.message); }

  try {
    const r2 = await pool.query(`SELECT * FROM public.entregas_eventos ORDER BY id DESC LIMIT 5;`);
    console.log('2. entregas_eventos:', r2.rows);
  } catch (e) { console.log('2. entregas_eventos error:', e.message); }

  try {
    const r3 = await pool.query(`SELECT id, cliente_nombre, estado, updated_at FROM public.presupuestos ORDER BY updated_at DESC LIMIT 5;`);
    console.log('3. presupuestos recientes:', r3.rows);
  } catch (e) { console.log('3. presupuestos error:', e.message); }

  try {
    const r4 = await pool.query(`SELECT * FROM public.presupuestos_estados_historial ORDER BY id DESC LIMIT 5;`);
    console.log('4. presupuestos_estados_historial:', r4.rows);
  } catch (e) { console.log('4. presupuestos_estados_historial error:', e.message); }

  try {
    const r5 = await pool.query(`SELECT * FROM public.rutas_auditorias ORDER BY id DESC LIMIT 5;`);
    console.log('5. rutas_auditorias:', r5.rows);
  } catch (e) { console.log('5. rutas_auditorias error:', e.message); }

  process.exit(0);
}

checkRecentData();
