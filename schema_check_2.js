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
    
    // Check tables columns
    for (let t of ['ingredientes']) {
        let res = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1", [t]);
        console.log(`\nTable: ${t}`);
        res.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`));
    }
    await client.end();
}

run().catch(console.error);
