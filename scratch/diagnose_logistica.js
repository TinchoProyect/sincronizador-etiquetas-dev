require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
});

async function run() {
    try {
        console.log("=== Checking addresses for client internal ID 681 ===");
        const res = await pool.query("SELECT * FROM public.clientes_domicilios WHERE id_cliente = 681");
        console.log("Addresses found:", res.rows);
    } catch(e) {
        console.error("Error:", e);
    } finally {
        pool.end();
    }
}
run();
