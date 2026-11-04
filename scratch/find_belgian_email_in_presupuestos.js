const { pool } = require('../src/logistica/config/database');

async function main() {
  try {
    console.log('🔍 Buscando si Belgian (0740) tiene correos en la tabla presupuestos o facturas...');
    const res = await pool.query(`
      SELECT DISTINCT email_destinatario, cliente_nombre, id_cliente
      FROM public.presupuestos
      WHERE id_cliente = '0740' OR id_cliente = '740' OR cliente_nombre ILIKE '%belgian%'
    `);
    console.log('📋 Encontrado en presupuestos:', res.rows);

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
