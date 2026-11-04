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
        console.log('--- TRIGGERS ON public.presupuestos ---');
        const res = await pool.query(`
            SELECT 
                trigger_name, 
                event_manipulation, 
                action_statement, 
                action_timing
            FROM information_schema.triggers
            WHERE event_object_table = 'presupuestos'
              AND event_object_schema = 'public';
        `);
        console.log('Triggers found:', res.rows.length);
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
