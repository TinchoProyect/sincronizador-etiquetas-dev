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
    let res = await client.query("SELECT id, nombre, sector_id FROM lamda_ingredientes WHERE sector_id IS NULL");
    console.log("Ingredientes sin sector (sector_id IS NULL):", res.rows);
    
    // Veamos si existe un sector literalmente llamado "Sin Sector"
    let sectores = await client.query("SELECT id, nombre FROM lamda_sectores WHERE nombre ILIKE '%sin%' OR nombre IS NULL OR nombre = ''");
    console.log("Sectores anómalos o literalmente llamados Sin Sector:", sectores.rows);
    
    await client.end();
}

run().catch(console.error);
