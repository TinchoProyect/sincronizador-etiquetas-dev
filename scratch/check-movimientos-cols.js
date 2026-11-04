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
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'factura_cuenta_corriente_movimientos'
    `);
    console.log('Columns of factura_cuenta_corriente_movimientos:');
    console.log(JSON.stringify(res.rows, null, 2));
    
    // Also check one sample row to see what kind of data is in comprobante_id or metadata
    const resSample = await pool.query(`
      SELECT * FROM public.factura_cuenta_corriente_movimientos LIMIT 1
    `);
    console.log('Sample row:');
    console.log(JSON.stringify(resSample.rows[0], null, 2));
    
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
