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
        console.log('--- COLUMNS OF public.stock_real_consolidado ---');
        const resCols = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
              AND table_name = 'stock_real_consolidado'
            ORDER BY column_name;
        `);
        console.table(resCols.rows);

        console.log('--- SAMPLE RECORDS FROM public.stock_real_consolidado ---');
        const resSample = await pool.query(`
            SELECT articulo_numero, codigo_barras, stock_consolidado, stock_mantenimiento, kilos_unidad
            FROM public.stock_real_consolidado
            WHERE articulo_numero = 'AATGX5' OR codigo_barras = '3256419852';
        `);
        console.table(resSample.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
