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
    try {
        const res = await client.query("SELECT * FROM presupuestos LIMIT 1;");
        console.log(JSON.stringify(res.rows[0], null, 2));
    } catch (err) {
        console.error("Error en query:", err.message);
    }
    await client.end();
}
run().catch(console.error);
