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
      SELECT p.id, p.cliente_id, p.total, p.estado, p.activo, p.comprobante_lomasoft 
      FROM presupuestos p
      WHERE p.cliente_id = 216
    `);
    
    // Mostramos los que tienen comprobante de lomasoft o su total es cercano
    const sospechosos = res.rows.filter(r => 
        (r.comprobante_lomasoft && r.comprobante_lomasoft.trim() !== '') || 
        (Math.abs(Number(r.total) - 210502.97) < 10)
    );

    console.log(JSON.stringify(sospechosos, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
run();
