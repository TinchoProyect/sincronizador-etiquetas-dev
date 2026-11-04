const { pool } = require('../src/logistica/config/database');

async function main() {
  try {
    console.log('🔍 Consultando bunker_clientes para lomas_soft_id = 137 o id = 137...');
    const res = await pool.query(`
      SELECT id, codigo_bunker_cliente, lomas_soft_id, cliente_nombre, razon_social, email_facturas, email_portal
      FROM public.bunker_clientes
      WHERE lomas_soft_id = '137' OR id = 137;
    `);
    console.log('📋 Registro bunker_clientes:', JSON.stringify(res.rows, null, 2));

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
