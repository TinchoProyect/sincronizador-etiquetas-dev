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
        const p = await client.query("SELECT * FROM presupuestos LIMIT 1;");
        console.log("Cols presupuestos:", Object.keys(p.rows[0]));

        const pd = await client.query("SELECT * FROM presupuestos_detalles LIMIT 1;");
        console.log("Cols detalles:", Object.keys(pd.rows[0]));
    } catch (err) {
        console.error("Error en query:", err.message);
    }
    await client.end();
}
run().catch(console.error);
