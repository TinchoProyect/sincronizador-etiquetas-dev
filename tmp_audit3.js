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
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'presupuestos'
    `);
    fs.writeFileSync('tmp_audit_cols.json', JSON.stringify(res.rows.map(r => r.column_name), null, 2));
    console.log('Columns saved to tmp_audit_cols.json');
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
run();
