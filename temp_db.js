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
    const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    const tables = res.rows.map(r => r.table_name);
    console.log("Tablas encontradas:", tables);

    if (tables.includes('presupuestos')) {
        const pCols = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'presupuestos'");
        console.log("Columnas de presupuestos:", pCols.rows);

        const pData = await client.query("SELECT * FROM presupuestos ORDER BY fecha_creacion DESC LIMIT 5");
        console.log("Ejemplos presupuestos:", pData.rows);
    }

    if (tables.includes('facturas')) {
        const fCols = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'facturas'");
        console.log("Columnas de facturas:", fCols.rows);
    }

    await client.end();
}
run().catch(console.error);
