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
      SELECT p.id, p.id_cliente, p.estado, p.activo, p.fecha, p.comprobante_lomasoft, 
             (SELECT SUM(pd.cantidad * COALESCE(pd.precio1, pd.valor1, 0)) 
              FROM presupuestos_detalles pd WHERE pd.id_presupuesto = p.id) as calc_total
      FROM presupuestos p
      WHERE p.comprobante_lomasoft IS NOT NULL
        AND p.comprobante_lomasoft != ''
    `);
    
    // Sort by descending date
    const rows = res.rows.sort((a,b) => new Date(b.fecha) - new Date(a.fecha));
    
    // Find those near 210502
    const filtered = rows.filter(r => Math.abs(Number(r.calc_total) - 210502.97) < 100 || r.id_cliente == '216' || r.id_cliente == 216);
    
    fs.writeFileSync('tmp_audit_all.json', JSON.stringify(filtered, null, 2));
    console.log('Saved ' + filtered.length + ' matches to tmp_audit_all.json');
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
run();
