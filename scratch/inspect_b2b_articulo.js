const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432
});

async function main() {
    try {
        console.log("=== DISTINCT STATUS COMBINATIONS ===");
        const res = await pool.query(`
            SELECT DISTINCT estado, estado_logistico
            FROM public.presupuestos
            ORDER BY estado, estado_logistico
        `);
        console.log(res.rows);
    } catch (err) {
        console.error("Error:", err);
    } finally {
        await pool.end();
    }
}

main();
