const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function run() {
    try {
        const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'stock_real_consolidado'");
        fs.writeFileSync('schema_stock.json', JSON.stringify(res.rows, null, 2));
    } catch(err) {
        console.error(err);
    } finally {
        pool.end();
    }
}
run();
