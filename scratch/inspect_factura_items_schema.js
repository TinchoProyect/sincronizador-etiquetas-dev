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
        console.log("--- COLUMNS OF public.factura_factura_items ---");
        const res = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'factura_factura_items'
            ORDER BY ordinal_position
        `);
        console.table(res.rows);

        console.log("--- SAMPLE RECORD ---");
        const sample = await pool.query("SELECT * FROM public.factura_factura_items LIMIT 1");
        console.dir(sample.rows[0]);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
