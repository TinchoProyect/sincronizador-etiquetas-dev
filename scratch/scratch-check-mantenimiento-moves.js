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
        console.log('--- MOVEMENTS IN public.mantenimiento_movimientos ---');
        const res = await pool.query(`
            SELECT id, articulo_numero, cantidad, tipo_movimiento, fecha_movimiento, estado, observaciones, id_presupuesto_origen
            FROM public.mantenimiento_movimientos
            WHERE articulo_numero = '3256419852' OR articulo_numero = 'AATGX5'
            ORDER BY id DESC;
        `);
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
