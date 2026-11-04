const { pool } = require('../src/logistica/config/database');

async function main() {
  try {
    console.log('🔍 Auditando los 47 clientes y sus contactos (WhatsApp y Email)...');
    
    const res = await pool.query(`
      SELECT id, codigo_bunker_cliente, cliente_nombre, lomas_soft_id, whatsapp_facturas, email_facturas, email_portal
      FROM public.bunker_clientes
      ORDER BY codigo_bunker_cliente ASC;
    `);

    console.log(`📋 Total Clientes: ${res.rows.length}\n`);

    res.rows.forEach(c => {
      let numWp = 0;
      let numEmail = 0;

      if (c.whatsapp_facturas && c.whatsapp_facturas.trim().length > 0) {
        if (c.whatsapp_facturas.trim().startsWith('[')) {
          try { numWp = JSON.parse(c.whatsapp_facturas).length; } catch {}
        } else {
          numWp = c.whatsapp_facturas.split(',').length;
        }
      }

      if (c.email_facturas && c.email_facturas.trim().length > 0) {
        if (c.email_facturas.trim().startsWith('[')) {
          try { numEmail = JSON.parse(c.email_facturas).length; } catch {}
        } else {
          numEmail = c.email_facturas.split(',').length;
        }
      }

      const hasPortal = c.email_portal && c.email_portal.trim().length > 0;

      console.log(`[${c.codigo_bunker_cliente}] ${c.cliente_nombre.padEnd(35)} | WP: ${numWp} | Email Facturas: ${numEmail} | Email Portal: ${hasPortal ? c.email_portal : 'Sin Portal'}`);
    });

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
