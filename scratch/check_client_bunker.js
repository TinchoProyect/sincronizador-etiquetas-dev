const { pool } = require('../src/logistica/config/database');

async function checkClient() {
    try {
        console.log('🔍 Buscando Belgian en bunker_clientes...');
        const res = await pool.query("SELECT id, lomas_soft_id, razon_social, cliente_nombre, email_facturas, whatsapp_facturas, canal_envio_preferido FROM public.bunker_clientes WHERE razon_social ILIKE '%belgian%' OR cliente_nombre ILIKE '%belgian%'");
        console.log('Resultados en bunker_clientes:', res.rows);

        console.log('\n🔍 Buscando facturas recientes del cliente...');
        const resFacturas = await pool.query("SELECT id, cliente_id, razon_social, imp_total, estado FROM factura_facturas WHERE razon_social ILIKE '%belgian%' OR cliente_id = 740 LIMIT 5");
        console.log('Resultados en factura_facturas:', resFacturas.rows);
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await pool.end();
    }
}

checkClient();
