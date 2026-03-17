const { Pool } = require('pg');
require('dotenv').config({ path: '../.env.test' });
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: 'etiquetas_pruebas',
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT
});
pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'presupuestos';", (err, res) => {
  if (err) throw err;
  console.log(JSON.stringify(res.rows.map(r => r.column_name)));
  pool.end();
});
