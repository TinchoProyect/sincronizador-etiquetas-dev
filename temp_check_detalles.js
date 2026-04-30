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
    const res = await pool.query(`SELECT * FROM ordenes_tratamiento_detalles WHERE id_orden_tratamiento = 17`);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();
