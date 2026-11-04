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
    const client = await pool.connect();
    try {
        console.log('--- BUSCANDO CONCILIACIONES EN mantenimiento_movimientos ---');
        const res = await client.query(`
            SELECT id, id_presupuesto_origen, observaciones, estado 
            FROM mantenimiento_movimientos 
            WHERE observaciones LIKE '%Lomasoft%' OR estado = 'CONCILIADO'
        `);
        console.log('Filas encontradas:', res.rows.length);
        console.table(res.rows);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
