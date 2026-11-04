require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 5432,
});

async function run() {
  try {
    const res = await pool.query(`
      SELECT token, cliente_id, expires_at, usado, created_at 
      FROM public.portal_invitaciones 
      WHERE cliente_id = 'CB-0002'
      ORDER BY created_at DESC
      LIMIT 5;
    `);
    console.log("Last invitations:");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error("Error:", err);
  } finally {
    pool.end();
  }
}

run();
