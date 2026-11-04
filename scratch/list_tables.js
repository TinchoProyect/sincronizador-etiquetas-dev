const { pool } = require('../src/logistica/config/database');

async function main() {
  try {
    const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name LIKE '%cliente%';
    `);
    console.log('📋 Tablas relacionadas con clientes:', res.rows.map(r => r.table_name));

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
