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
        console.log('--- COLUMNS OF public.articulos ---');
        const resCols = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
              AND table_name = 'articulos'
            ORDER BY column_name;
        `);
        console.table(resCols.rows);

        console.log('--- SAMPLE RECORDS FROM public.articulos ---');
        const resSample = await pool.query(`
            SELECT nombre, codigo_barras, numero, stock_ventas
            FROM public.articulos
            WHERE nombre ILIKE '%avena%' OR nombre ILIKE '%sesamo%'
            LIMIT 10;
        `);
        console.table(resSample.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
