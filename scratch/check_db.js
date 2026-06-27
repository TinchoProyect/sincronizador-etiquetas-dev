const { pool } = require('../src/logistica/config/database');

async function main() {
    try {
        console.log('--- Bunker Clientes ---');
        const resBunker = await pool.query(`
            SELECT id, codigo_bunker_cliente, cliente_nombre, lomas_soft_id, cuit_cuil 
            FROM public.bunker_clientes 
            WHERE lomas_soft_id = '0740' OR cliente_nombre ILIKE '%belgian%'
        `);
        console.log(resBunker.rows);

        console.log('--- Clientes Legacy ---');
        const resLegacy = await pool.query(`
            SELECT cliente_id, nombre, apellido, cuit, dni 
            FROM clientes 
            WHERE cliente_id = 740 OR apellido ILIKE '%belgian%'
        `);
        console.log(resLegacy.rows);

        console.log('--- Invoices for Belgian ---');
        const resFacturas = await pool.query(`
            SELECT id, cliente_id, razon_social, pto_vta, nro 
            FROM factura_facturas 
            WHERE cliente_id = 740 OR razon_social ILIKE '%belgian%'
            LIMIT 5
        `);
        console.log(resFacturas.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

main();
