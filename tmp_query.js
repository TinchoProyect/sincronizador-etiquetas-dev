const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/etiquetas_pruebas' });
client.connect().then(async () => {
    const res = await client.query("SELECT id, tipo_comprobante, estado, estado_logistico FROM presupuestos ORDER BY id DESC LIMIT 5;");
    console.table(res.rows);
    process.exit(0);
}).catch(console.error);
