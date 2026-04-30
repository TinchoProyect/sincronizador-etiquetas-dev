require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ 
  user: process.env.DB_USER, 
  password: String(process.env.DB_PASSWORD), 
  host: process.env.DB_HOST, 
  port: process.env.DB_PORT, 
  database: process.env.DB_NAME 
});

async function run() {
  try {
    const res = await pool.query(`UPDATE mantenimiento_movimientos SET cantidad = 5.00 WHERE id = 269 RETURNING *`);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();
