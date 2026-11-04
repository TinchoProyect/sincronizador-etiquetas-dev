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
        const columnsRes = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'produccion_externa_historial'
            ORDER BY ordinal_position;
        `);
        console.log("=== COLUMNS IN produccion_externa_historial ===");
        console.log(columnsRes.rows.map(c => `${c.column_name} (${c.data_type})`).join(', '));

        const res = await pool.query(`
            SELECT *
            FROM public.produccion_externa_historial
            ORDER BY fecha_registro DESC
            LIMIT 15;
        `);
        console.log("\n=== RECENT ROWS IN produccion_externa_historial ===");
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error("ERROR:", err);
    } finally {
        await pool.end();
    }
}

run();
