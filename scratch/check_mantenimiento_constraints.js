require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function test() {
    try {
        console.log("--- AUDITING CONSTRAINTS FOR 'mantenimiento_movimientos' ---");
        const resMov = await pool.query(
            `SELECT conname, contype, pg_get_constraintdef(c.oid) as def
             FROM pg_constraint c
             JOIN pg_namespace n ON n.oid = c.connamespace
             WHERE n.nspname = 'public' AND c.conrelid = 'public.mantenimiento_movimientos'::regclass`
        );
        console.log(resMov.rows);
    } catch(e) { 
        console.error(e); 
    }
    process.exit(0);
}
test();
