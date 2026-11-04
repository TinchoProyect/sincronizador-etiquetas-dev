const { pool } = require('../src/logistica/config/database');

async function main() {
  try {
    console.log('🔍 Buscando cualquier referencia a Belgian en todas las tablas de PostgreSQL...');
    
    // Buscar en clientes_domicilios_entrega
    const resDom = await pool.query(`
      SELECT * FROM public.clientes_domicilios_entrega WHERE cliente_id = 44 OR destinatario_nombre ILIKE '%belgian%';
    `);
    console.log('📍 clientes_domicilios_entrega:', resDom.rows);

    // Buscar en presupuestos / facturas
    const resFact = await pool.query(`
      SELECT id, id_cliente, email_destinatario FROM public.presupuestos WHERE id_cliente = '44' OR email_destinatario ILIKE '%belgian%' LIMIT 5;
    `);
    console.log('📄 presupuestos / facturas:', resFact.rows);

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
