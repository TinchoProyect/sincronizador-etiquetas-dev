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
        console.log('--- BUSCANDO ENTRADAS EN HISTORIAL SIN PRESUPUESTO ASOCIADO ---');
        const res = await client.query(`
            SELECT DISTINCT h.id_presupuesto, h.fecha_cambio, h.estado_nuevo
            FROM presupuestos_estados_historial h
            LEFT JOIN presupuestos p ON p.id = h.id_presupuesto
            WHERE p.id IS NULL
            ORDER BY h.fecha_cambio DESC
            LIMIT 50;
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
