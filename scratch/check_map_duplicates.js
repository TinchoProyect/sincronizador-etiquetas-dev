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
        console.log('--- REVISANDO DUPLICADOS EN presupuestos_detalles_map ---');
        const res = await client.query(`
            SELECT id_detalle_presupuesto, COUNT(*), json_agg(local_detalle_id) as local_ids
            FROM presupuestos_detalles_map
            GROUP BY id_detalle_presupuesto
            HAVING COUNT(*) > 1
            LIMIT 10;
        `);
        console.log('Filas duplicadas encontradas:', res.rows.length);
        console.table(res.rows);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
