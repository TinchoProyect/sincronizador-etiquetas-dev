const { pool } = require('../src/logistica/config/database');

async function main() {
  try {
    const resCols = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'presupuestos' AND column_name LIKE '%email%' OR column_name LIKE '%mail%';
    `);
    console.log('📋 Columnas email en presupuestos:', resCols.rows.map(r => r.column_name));

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
