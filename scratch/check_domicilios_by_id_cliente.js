const { pool } = require('../src/logistica/config/database');

async function main() {
  try {
    console.log('🔍 Consultando clientes_domicilios para id_cliente = 44...');
    const resDom = await pool.query(`
      SELECT * FROM public.clientes_domicilios WHERE id_cliente = 44 OR alias ILIKE '%belgian%' OR direccion ILIKE '%belgian%';
    `);
    console.log('📍 Registros en clientes_domicilios:', JSON.stringify(resDom.rows, null, 2));

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
