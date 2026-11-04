const { pool } = require('../src/logistica/config/database');

async function main() {
  try {
    console.log('🔍 Consultando estructura de clientes_domicilios...');
    const resCols = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'clientes_domicilios';
    `);
    console.log('📋 Columnas clientes_domicilios:', resCols.rows.map(r => r.column_name));

    const resDom = await pool.query(`
      SELECT * FROM public.clientes_domicilios WHERE bunker_cliente_id = 44 OR email ILIKE '%belgian%';
    `);
    console.log('📍 Registros:', JSON.stringify(resDom.rows, null, 2));

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
