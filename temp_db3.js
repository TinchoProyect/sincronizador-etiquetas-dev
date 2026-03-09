const { Client } = require('pg');
const client = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
});

async function run() {
    await client.connect();
    const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%presupuesto%'");
    console.log("Tablas relacionadas a presupuestos:", res.rows.map(r => r.table_name));
    await client.end();
}
run().catch(console.error);
