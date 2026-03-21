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
      SELECT p.id, p.id_cliente, p.estado, p.activo, p.fecha, p.comprobante_lomasoft, pd.total
      FROM presupuestos p
      LEFT JOIN presupuestos_detalles pd ON p.id = pd.presupuesto_id
      WHERE CAST(p.id_cliente AS TEXT) = '216'
    `);
    
    // Agrupamos por presupuesto
    const map = new Map();
    for(const r of res.rows) {
      if(!map.has(r.id)) {
        map.set(r.id, {...r, sum_total: 0});
      }
      map.get(r.id).sum_total += Number(r.total || 0);
    }
    
    const all = Array.from(map.values());
    
    // Buscamos los que sumen ~210502.97
    const sospechosos = all.filter(r => Math.abs(r.sum_total - 210502.97) < 1.0);
    
    fs.writeFileSync('tmp_audit_monto.json', JSON.stringify(sospechosos, null, 2));
    console.log('Saved ' + sospechosos.length + ' results to tmp_audit_monto.json');
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
run();
