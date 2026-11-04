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
        console.log('--- BUSCANDO RT 22 EN mantenimiento_movimientos ---');
        const res = await pool.query(`
            SELECT * 
            FROM mantenimiento_movimientos 
            WHERE observaciones LIKE '%RT 22%' 
               OR observaciones LIKE '%RT-22%'
               OR ticket_numero = 22
               OR id::text = '22';
        `);
        console.log('Resultados en mantenimiento_movimientos:');
        console.log(JSON.stringify(res.rows, null, 2));

        console.log('\n--- BUSCANDO RT 22 EN OTRAS TABLAS ---');
        const res2 = await pool.query(`
            SELECT * 
            FROM stock_ventas_movimientos 
            WHERE observaciones LIKE '%RT 22%' 
               OR observaciones LIKE '%RT-22%';
        `);
        console.log('Resultados en stock_ventas_movimientos:');
        console.log(JSON.stringify(res2.rows, null, 2));

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
