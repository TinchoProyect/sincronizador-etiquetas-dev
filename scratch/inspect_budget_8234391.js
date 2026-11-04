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
        console.log("--- BUDGET 8234391 DETAILS ---");
        const res = await pool.query(
            "SELECT * FROM public.presupuestos WHERE id = 8234391"
        );
        console.dir(res.rows[0]);

        console.log("--- BUDGET DETAILS (ITEMS) ---");
        const items = await pool.query(
            "SELECT * FROM public.presupuestos_detalles WHERE id_presupuesto = 8234391"
        );
        console.table(items.rows);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
