require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function run() {
    try {
        console.log("--- SEARCH BY BARCODE '3256419852' ---");
        const res = await pool.query(`
            SELECT articulo_numero, codigo_barras, stock_consolidado, stock_mantenimiento, kilos_unidad
            FROM public.stock_real_consolidado
            WHERE codigo_barras = '3256419852';
        `);
        console.table(res.rows);

        console.log("--- SEARCH IN public.articulos ---");
        const resArt = await pool.query(`
            SELECT numero, codigo_barras, descripcion, kilos_unidad
            FROM public.articulos
            WHERE codigo_barras = '3256419852' OR numero = '3256419852';
        `);
        console.table(resArt.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
