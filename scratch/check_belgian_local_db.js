const { pool } = require('../src/logistica/config/database');

async function main() {
  try {
    console.log('🔍 Consultando cliente Belgian en PostgreSQL local (bunker_clientes)...');
    const res = await pool.query(`
      SELECT id, codigo_bunker_cliente, cliente_nombre, razon_social, whatsapp_facturas, email_facturas
      FROM public.bunker_clientes
      WHERE codigo_bunker_cliente ILIKE '%0030%' OR cliente_nombre ILIKE '%belgian%' OR razon_social ILIKE '%belgian%';
    `);

    console.log('📋 Encontrado en bunker_clientes:', JSON.stringify(res.rows, null, 2));

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
