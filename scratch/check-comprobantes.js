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
  try {
    const res = await pool.query(`
      SELECT tipo_comprobante, COUNT(*), COUNT(comprobante_id) as count_with_id, MIN(comprobante_id) as min_id, MAX(comprobante_id) as max_id
      FROM public.factura_cuenta_corriente_movimientos
      GROUP BY tipo_comprobante
    `);
    console.log('Summary of movements by tipo_comprobante:');
    console.log(JSON.stringify(res.rows, null, 2));
    
    // Let's also see a few sample rows of RECIBO
    const resRecibos = await pool.query(`
      SELECT * FROM public.factura_cuenta_corriente_movimientos
      WHERE tipo_comprobante = 'RECIBO' OR tipo_comprobante = 'RECIBO_PAGO'
      LIMIT 5
    `);
    console.log('Sample RECIBO rows:');
    console.log(JSON.stringify(resRecibos.rows, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
