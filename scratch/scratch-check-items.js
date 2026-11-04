const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function run() {
    try {
        console.log('--- ÚLTIMAS 5 FACTURAS ---');
        const facturas = await pool.query(`
            SELECT id, tipo_cbte, pto_vta, cbte_nro, imp_total, estado, requiere_afip, created_at
            FROM factura_facturas
            ORDER BY id DESC
            LIMIT 5;
        `);
        console.table(facturas.rows);

        console.log('--- ITEMS DE LAS ÚLTIMAS FACTURAS ---');
        const items = await pool.query(`
            SELECT id, factura_id, descripcion, qty, p_unit, alic_iva_id, imp_neto, imp_iva
            FROM factura_factura_items
            WHERE factura_id IN (SELECT id FROM factura_facturas ORDER BY id DESC LIMIT 5)
            ORDER BY factura_id DESC, orden ASC;
        `);
        console.table(items.rows);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
