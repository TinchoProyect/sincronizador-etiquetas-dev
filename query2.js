const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT
});

pool.query("SELECT event_object_table, trigger_name, action_statement FROM information_schema.triggers WHERE event_object_table = 'bunker_articulos';")
    .then(res => {
        console.log("TRIGGERS", JSON.stringify(res.rows, null, 2));
        pool.end();
    })
    .catch(console.error);
