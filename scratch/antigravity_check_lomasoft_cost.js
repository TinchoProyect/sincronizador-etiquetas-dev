require('dotenv').config();
const { pool } = require('../src/logistica/config/database');

async function test() {
    try {
        console.log("🔍 [LOMASOFT-COST-TEST] Buscando artículos de bunker...");
        const res = await pool.query(
            `SELECT b.articulo_id, p.descripcion, b.costo_base, p.costo as costo_lomasoft, p.iva
             FROM public.bunker_articulos b
             LEFT JOIN public.precios_articulos p ON b.articulo_id = p.articulo
             LIMIT 15`
        );
        console.log("Resultados:", res.rows);
    } catch(e) {
        console.error(e);
    }
    process.exit(0);
}
test();
