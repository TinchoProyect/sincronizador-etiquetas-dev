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
        console.log('--- BUSCANDO ORPHANED MAPS EN public.presupuestos_detalles_map ---');
        const res = await client.query(`
            SELECT count(*) 
            FROM public.presupuestos_detalles_map m
            LEFT JOIN public.presupuestos_detalles d ON d.id = m.local_detalle_id
            WHERE d.id IS NULL;
        `);
        console.log('Cantidad de mapas huérfanos (apuntan a IDs viejos):', res.rows[0].count);
        
        console.log('--- BUSCANDO DETALLES SIN MAPAS EN public.presupuestos_detalles ---');
        const res2 = await client.query(`
            SELECT count(*) 
            FROM public.presupuestos_detalles d
            LEFT JOIN public.presupuestos_detalles_map m ON m.local_detalle_id = d.id
            WHERE m.local_detalle_id IS NULL;
        `);
        console.log('Cantidad de detalles nuevos sin mapa:', res2.rows[0].count);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
