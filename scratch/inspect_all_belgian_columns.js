const { pool } = require('../src/logistica/config/database');

async function main() {
  try {
    const res = await pool.query(`
      SELECT * FROM public.bunker_clientes WHERE id = 44;
    `);
    console.log('📋 Belgian (ID 44) Completo:', JSON.stringify(res.rows[0], null, 2));

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
