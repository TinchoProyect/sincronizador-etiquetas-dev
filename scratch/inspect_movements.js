require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function run() {
    try {
        console.log("--- QUERYING mantenimiento_movimientos 326 & 327 ---");
        const res = await pool.query(
            "SELECT * FROM public.mantenimiento_movimientos WHERE id IN (326, 327) ORDER BY id ASC"
        );
        console.dir(res.rows, { depth: null });
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
