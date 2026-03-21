const fs = require('fs');
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
      SELECT p.id, p.id_cliente, p.estado, p.activo, p.fecha, p.comprobante_lomasoft, p.id_factura_lomasoft,
             (SELECT SUM(pd.cantidad * COALESCE(pd.precio1, pd.valor1, 0)) 
              FROM presupuestos_detalles pd WHERE pd.id_presupuesto = p.id) as calc_total
      FROM presupuestos p
      WHERE (p.id_factura_lomasoft IS NOT NULL AND p.id_factura_lomasoft != '0-0')
         OR (p.comprobante_lomasoft IS NOT NULL AND p.comprobante_lomasoft != '')
    `);
    
    fs.writeFileSync('tmp_audit_lomasoft_ids.json', JSON.stringify(res.rows, null, 2));
    console.log('Saved ' + res.rows.length + ' matches');
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
run();
