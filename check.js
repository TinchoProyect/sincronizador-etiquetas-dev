require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

pool.query("SELECT trigger_name, event_manipulation, action_statement FROM information_schema.triggers WHERE event_object_table IN ('carros_articulos', 'carros_produccion')")
    .then(r => {
        console.log(r.rows);
        process.exit(0);
    })
    .catch(console.error);
