const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function main() {
    try {
        const res = await pool.query(`
            SELECT a.numero, a.nombre, a.codigo_barras, src.kilos_unidad, src.stock_consolidado
            FROM public.articulos a
            LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = a.numero
            WHERE a.nombre ILIKE '%aceite%' OR a.nombre ILIKE '%coco%'
        `);
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

main();
