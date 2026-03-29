const { Pool } = require('pg');
require('dotenv').config({ path: __dirname + '/src/.env' });

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || '1234',
  port: process.env.DB_PORT || 5432,
});

async function run() {
    try {
        const res = await pool.query(`
            SELECT pg_get_functiondef(p.oid)
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public' AND p.proname = 'liberar_stock_mantenimiento';
        `);
        console.log("FUNCTION DEF:\n", res.rows[0].pg_get_functiondef);
    } catch (e) { console.error(e); } finally { pool.end(); }
}

run();
