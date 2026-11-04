const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function run() {
    try {
        console.log('📡 Querying local portal_invitaciones...');
        const res = await pool.query('SELECT * FROM public.portal_invitaciones ORDER BY expires_at DESC LIMIT 5');
        console.log(`Found ${res.rows.length} invitations locally:`);
        console.log(JSON.stringify(res.rows, null, 2));
        process.exit(0);
    } catch (e) {
        console.error('SQL Error:', e);
        process.exit(1);
    }
}

run();
