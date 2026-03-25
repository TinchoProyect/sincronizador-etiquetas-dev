const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT
});

pool.query("SELECT propiedades_dinamicas FROM bunker_articulos WHERE articulo_id='PRUEBA_997';")
    .then(res => {
        console.log(JSON.stringify(res.rows, null, 2));
        pool.end();
    })
    .catch(console.error);
