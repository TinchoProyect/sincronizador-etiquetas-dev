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
    const res = await client.query("SELECT * FROM information_schema.columns WHERE table_name = 'presupuestos'");
    console.log("Columnas de presupuestos:", res.rows.map(r => r.column_name));
    await client.end();
}
run().catch(console.error);
