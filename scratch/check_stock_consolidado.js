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
        console.log('Querying stock_real_consolidado for EMB-POIULR...');
        const res = await pool.query(
            `SELECT * FROM public.stock_real_consolidado WHERE articulo_numero = 'EMB-POIULR' OR codigo_barras = 'EMB-POIULR'`
        );
        console.log('Result:', res.rows);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

main();
