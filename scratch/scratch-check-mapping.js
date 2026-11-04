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
        console.log('--- BUSCANDO ARTÍCULOS EN LA TABLA articulos POR CÓDIGO ---');
        const res = await pool.query(`
            SELECT numero, nombre, codigo_barras 
            FROM articulos 
            WHERE codigo_barras IN ('6131804000119', '5349211857', '1568852582', '1133559964', '53468556')
               OR numero IN ('6131804000119', '5349211857', '1568852582', '1133559964', '53468556');
        `);
        console.table(res.rows);

        console.log('--- BUSCANDO ARTÍCULOS EN LA TABLA stock_real_consolidado POR CÓDIGO ---');
        const resCons = await pool.query(`
            SELECT articulo_numero, descripcion, codigo_barras, stock_consolidado
            FROM stock_real_consolidado 
            WHERE codigo_barras IN ('6131804000119', '5349211857', '1568852582', '1133559964', '53468556')
               OR articulo_numero IN ('6131804000119', '5349211857', '1568852582', '1133559964', '53468556');
        `);
        console.table(resCons.rows);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
