const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function run() {
    try {
        const res = await pool.query(`
            SELECT COUNT(*) 
            FROM stock_ventas_movimientos 
            WHERE observaciones LIKE '%Factura%' 
               OR observaciones LIKE '%Nota%' 
               OR observaciones LIKE '%Crédito%'
               OR observaciones LIKE '%#32-%';
        `);
        console.log('Count of existing invoice-related stock movements:', res.rows[0].count);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
