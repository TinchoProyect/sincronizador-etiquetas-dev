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
        console.log('--- BUSCANDO EN LOGS DE SINCRONIZACIÓN (presupuestos_sync_log) ---');
        const res = await client.query(`
            SELECT id, fecha_sync, exitoso, registros_procesados, registros_nuevos, registros_actualizados, detalles 
            FROM presupuestos_sync_log 
            WHERE detalles IS NOT NULL
            ORDER BY id DESC 
            LIMIT 5;
        `);
        console.log('Filas encontradas:', res.rows.length);
        
        for (const row of res.rows) {
            console.log(`\nLog ID: ${row.id} | Fecha: ${row.fecha_sync} | Exitoso: ${row.exitoso}`);
            const detailsStr = typeof row.detalles === 'object' ? JSON.stringify(row.detalles) : String(row.detalles);
            console.log('Muestra detalles:', detailsStr.substring(0, 500) + '...');
        }
    } catch (e) {
        console.error('Error:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
