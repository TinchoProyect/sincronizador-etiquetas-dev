const { Pool } = require('pg');
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: process.env.DB_PORT || 5432
});

async function checkTable() {
  try {
    const r1 = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%presupuesto%';");
    console.log('📋 TABLAS PRESUPUESTO EN EN BD LOCAL:', r1.rows.map(r => r.table_name));

    const r2 = await pool.query("SELECT id, id_presupuesto, articulo, cantidad FROM public.presupuestos_detalle ORDER BY id DESC LIMIT 5;");
    console.log('📦 ÚLTIMOS ÍTEMS EN presupuestos_detalle:', r2.rows);

    const r3 = await pool.query("SELECT id, id_presupuesto_ext, total FROM public.presupuestos ORDER BY id DESC LIMIT 5;");
    console.log('📄 ÚLTIMOS ENCABEZADOS EN presupuestos:', r3.rows);
  } catch (e) {
    console.error('❌ Error:', e.message);
  }
  process.exit(0);
}

checkTable();
