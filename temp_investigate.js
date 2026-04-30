require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ 
  user: process.env.DB_USER, 
  password: String(process.env.DB_PASSWORD), 
  host: process.env.DB_HOST, 
  port: process.env.DB_PORT, 
  database: process.env.DB_NAME 
});

async function run() {
  try {
    const res1 = await pool.query(`SELECT * FROM mantenimiento_movimientos WHERE observaciones ILIKE '%RT-17%' OR id_presupuesto_origen IN (8232835, 8232882, 8232863)`);
    console.log('--- MOVIMIENTOS ---');
    console.log(JSON.stringify(res1.rows, null, 2));

    const res2 = await pool.query(`SELECT * FROM logistica_rutas_hojas WHERE observaciones ILIKE '%RT-17%' OR ruta_id = 174 OR id = 174`);
    console.log('--- LOGISTICA ---');
    console.log(JSON.stringify(res2.rows, null, 2));

    const res3 = await pool.query(`SELECT * FROM presupuestos WHERE id IN (8232835, 8232882, 8232863) ORDER BY id DESC LIMIT 5`);
    console.log('--- PRESUPUESTOS ---');
    console.log(JSON.stringify(res3.rows, null, 2));

    const res4 = await pool.query(`SELECT * FROM presupuestos_detalles WHERE id_presupuesto IN (8232835, 8232882, 8232863)`);
    console.log('--- PRESUPUESTOS_DETALLES ---');
    console.log(JSON.stringify(res4.rows, null, 2));

  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();
