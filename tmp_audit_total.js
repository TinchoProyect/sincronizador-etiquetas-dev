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
      SELECT pd.cantidad, pd.precio1, pd.valor1, pd.camp2
      FROM presupuestos_detalles pd
      WHERE pd.id_presupuesto = 8232276
    `);
    
    let sum = 0;
    for (const row of res.rows) {
      // Logic from Lomasoft controller: SUM(pd.cantidad * COALESCE(pd.precio1, pd.valor1, 0))
      const price = Number(row.precio1) || Number(row.valor1) || 0;
      sum += Number(row.cantidad) * price;
    }
    
    console.log("Total calculado para 8232276:", sum);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
run();
