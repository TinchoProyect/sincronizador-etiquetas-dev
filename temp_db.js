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
    .then(() => client.query("UPDATE ingredientes SET unidad_medida = 'Kilo' WHERE id = 154"))
    .then(res => {
        console.log('Update result:', res.rowCount);
        return client.query('SELECT id, nombre, unidad_medida FROM ingredientes WHERE id = 154');
    })
    .then(res => {
        console.log('Verification:', res.rows);
        client.end();
    })
    .catch(err => {
        console.error('DB ERROR:', err.message);
        client.end();
    });
