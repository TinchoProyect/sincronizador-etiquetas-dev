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
      SELECT p.id, p.id_cliente, p.estado, p.activo, p.fecha, p.comprobante_lomasoft
      FROM presupuestos p
      WHERE CAST(p.id_cliente AS TEXT) = '216'
    `);
    
    const sospechosos = res.rows.filter(r => r.comprobante_lomasoft !== null && r.comprobante_lomasoft !== '');
    
    fs.writeFileSync('tmp_audit_lomasoft.json', JSON.stringify(sospechosos, null, 2));
    console.log('Saved to tmp_audit_lomasoft.json');
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
run();
