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
      UPDATE presupuestos
      SET comprobante_lomasoft = NULL, id_factura_lomasoft = NULL
      WHERE id = 8232719
      RETURNING id, id_cliente, comprobante_lomasoft, id_factura_lomasoft;
    `);
    console.log("ACTUALIZACIÓN COMPLETADA. Filas afectadas:", res.rowCount);
    console.log(res.rows[0]);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
run();
