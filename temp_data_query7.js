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
        const pd = await client.query("SELECT * FROM presupuestos_detalles LIMIT 1;");
        console.log("Record detalles:", pd.rows[0]);
    } catch (err) {
        console.error("Error en query:", err.message);
    }
    await client.end();
}
run().catch(console.error);
