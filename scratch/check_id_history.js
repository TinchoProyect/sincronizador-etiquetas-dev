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
        console.log('--- HISTORIAL COMPLETO DEL PRESUPUESTO 8232972 ---');
        const res = await client.query(`
            SELECT * 
            FROM presupuestos_estados_historial 
            WHERE id_presupuesto = 8232972
            ORDER BY fecha_cambio ASC;
        `);
        console.table(res.rows);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
