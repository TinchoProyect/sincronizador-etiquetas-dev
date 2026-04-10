const { Client } = require('pg');
require('dotenv').config({path: './.env'});
const client = new Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT
});
client.connect()
    .then(() => client.query("SELECT column_name, column_default FROM information_schema.columns WHERE table_name = 'mantenimiento_movimientos' AND column_name = 'estado'"))
    .then(res => { console.log('Estado default:', res.rows); client.end(); })
    .catch(err => { console.error('DB:', err.message); client.end(); });
