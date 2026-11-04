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
        console.log('--- SEARCHING FOR 3256419852 IN public.stock_real_consolidado ---');
        const res = await pool.query(`
            SELECT articulo_numero, codigo_barras, stock_consolidado, stock_mantenimiento, kilos_unidad
            FROM public.stock_real_consolidado
            WHERE articulo_numero = '3256419852';
        `);
        console.log('Results (articulo_numero = 3256419852):');
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
