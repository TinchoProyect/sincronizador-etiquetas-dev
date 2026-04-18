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
    let res = await client.query("SELECT id, nombre, sector_id FROM ingredientes WHERE sector_id IS NULL");
    console.log(`Hay ${res.rows.length} ingredientes sin sector (sector_id IS NULL).`);
    
    // Veamos si existe un sector literalmente llamado "Sin Sector"
    let sectores = await client.query("SELECT id, nombre FROM sectores_ingredientes WHERE nombre ILIKE '%sin%' OR nombre IS NULL OR nombre = ''");
    console.log("Sectores con nombre vacío o que contienen 'sin':", sectores.rows);
    
    // Veamos todos los sectores
    let todos = await client.query("SELECT id, nombre FROM sectores_ingredientes");
    console.log("Todos los sectores:", todos.rows);
    
    await client.end();
}

run().catch(console.error);
