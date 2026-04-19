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

    console.log("== 1. CONSTRAINTS en ingredientes_ajustes ==");
    const res1 = await client.query(`
        SELECT conname, pg_get_constraintdef(c.oid)
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE conrelid = 'ingredientes_ajustes'::regclass
    `);
    console.log(res1.rows);

    await client.end();
}

run().catch(console.error);
