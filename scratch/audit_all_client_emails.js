const { pool } = require('../src/logistica/config/database');

async function main() {
  try {
    console.log('🔍 Auditando la columna email_facturas y email_portal en la tabla bunker_clientes...');
    
    const res = await pool.query(`
      SELECT id, codigo_bunker_cliente, cliente_nombre, email_facturas, email_portal, email_portal_nombre
      FROM public.bunker_clientes
      ORDER BY id ASC;
    `);

    console.log(`📋 Total Clientes: ${res.rows.length}`);
    let conEmailFacturas = 0;
    let conEmailPortal = 0;

    res.rows.forEach(c => {
      const hasFacturas = c.email_facturas && c.email_facturas.trim().length > 0;
      const hasPortal = c.email_portal && c.email_portal.trim().length > 0;
      if (hasFacturas) conEmailFacturas++;
      if (hasPortal) conEmailPortal++;

      if (c.codigo_bunker_cliente === 'CB-0030' || c.cliente_nombre.toLowerCase().includes('belgian')) {
        console.log('⭐ BELGIAN ENCONTRADO:', JSON.stringify(c, null, 2));
      }
    });

    console.log(`\n📊 Resumen de Correos:`);
    console.log(`   - Clientes con email_facturas: ${conEmailFacturas} / ${res.rows.length}`);
    console.log(`   - Clientes con email_portal: ${conEmailPortal} / ${res.rows.length}`);

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
