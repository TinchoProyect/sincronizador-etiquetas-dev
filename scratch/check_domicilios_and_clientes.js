const { pool } = require('../src/logistica/config/database');

async function main() {
  try {
    console.log('🔍 Consultando clientes_domicilios y clientes para Belgian...');
    
    // 1. clientes_domicilios
    const resDom = await pool.query(`
      SELECT * FROM public.clientes_domicilios WHERE cliente_id = 44 OR email ILIKE '%belgian%' OR contacto_nombre ILIKE '%belgian%';
    `);
    console.log('📍 clientes_domicilios:', JSON.stringify(resDom.rows, null, 2));

    // 2. clientes (si existe)
    const resCli = await pool.query(`
      SELECT * FROM public.clientes WHERE id = 44 OR nombre ILIKE '%belgian%' LIMIT 5;
    `);
    console.log('👤 clientes:', JSON.stringify(resCli.rows, null, 2));

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
