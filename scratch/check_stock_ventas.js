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
    const client = await pool.connect();
    try {
        console.log('--- ESTRUCTURA DE LA TABLA stock_ventas_movimientos ---');
        const cols = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'stock_ventas_movimientos'
        `);
        console.table(cols.rows);
        
        console.log('--- REVISANDO CONSTRAINTS EN stock_ventas_movimientos ---');
        const constraintsRes = await client.query(`
            SELECT
                tc.table_name, 
                kcu.column_name, 
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name 
            FROM 
                information_schema.table_constraints AS tc 
                JOIN information_schema.key_column_usage AS kcu
                  ON tc.constraint_name = kcu.constraint_name
                  AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage AS ccu
                  ON ccu.constraint_name = tc.constraint_name
                  AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = 'stock_ventas_movimientos';
        `);
        console.table(constraintsRes.rows);

        console.log('--- ÚLTIMAS 10 FILAS EN stock_ventas_movimientos ---');
        const rowsRes = await client.query(`
            SELECT * 
            FROM stock_ventas_movimientos 
            ORDER BY id DESC 
            LIMIT 10;
        `);
        console.table(rowsRes.rows);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
