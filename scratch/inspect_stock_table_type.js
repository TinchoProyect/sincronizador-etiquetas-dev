const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function main() {
    try {
        const resType = await pool.query(
            `SELECT table_type 
             FROM information_schema.tables 
             WHERE table_name = 'stock_real_consolidado'`
        );
        console.log('Table Type:', resType.rows[0]?.table_type);

        if (resType.rows[0]?.table_type === 'VIEW') {
            const resDef = await pool.query(
                `SELECT view_definition 
                 FROM information_schema.views 
                 WHERE table_name = 'stock_real_consolidado'`
            );
            console.log('View Definition:', resDef.rows[0]?.view_definition);
        } else {
            console.log('It is a BASE TABLE. Let us check if there are columns.');
        }
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

main();
