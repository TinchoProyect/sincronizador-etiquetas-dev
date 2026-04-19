const { Client } = require('pg');
require('dotenv').config();
const client = new Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT
});

async function run() {
    await client.connect();
    
    let res = await client.query(`
        SELECT trigger_name, event_manipulation, event_object_table, action_statement 
        FROM information_schema.triggers 
        WHERE event_object_table IN ('ingredientes', 'ingredientes_ajustes', 'ingredientes_movimientos')
    `);
    
    console.log(res.rows);
    await client.end();
}

run().catch(console.error);
