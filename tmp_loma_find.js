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
      SELECT p.id, p.id_cliente, p.estado, p.activo, p.fecha, p.comprobante_lomasoft, p.id_factura_lomasoft
      FROM presupuestos p
      WHERE p.comprobante_lomasoft = 'B-0001-10003287' 
         OR p.id_factura_lomasoft = 'B-0001-10003287'
    `);
    
    console.log("MATCHES:", JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
run();
