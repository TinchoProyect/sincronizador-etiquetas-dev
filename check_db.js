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
        const sql = `
            SELECT * 
            FROM tipos_listas;
        `;
        const res = await pool.query(sql);
        console.log("Result:", res.rows);
    } catch(e) {
        console.error("Error:", e);
    } finally {
        pool.end();
    }
}
run();
