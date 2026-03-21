const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function run() {
  try {
    const res = await pool.query(`
      SELECT p.id, p.id_cliente, p.estado, p.activo, p.comprobante_lomasoft, p.fecha
      FROM presupuestos p
      WHERE p.id_cliente = 216 
        AND p.comprobante_lomasoft IS NOT NULL
        AND p.comprobante_lomasoft != ''
    `);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
run();
