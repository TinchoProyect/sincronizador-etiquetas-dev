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
        console.log('--- REVISANDO CANTIDAD DE REGISTROS EN TABLAS CLAVE ---');
        const tablesRes = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name;
        `);
        
        for (const row of tablesRes.rows) {
            const tableName = row.table_name;
            try {
                const countRes = await client.query(`SELECT COUNT(*) FROM "${tableName}"`);
                const count = countRes.rows[0].count;
                if (count > 0 || tableName.includes('presupuestos') || tableName.includes('devolucion') || tableName.includes('retiro') || tableName.includes('factura')) {
                    console.log(`Tabla: ${tableName.padEnd(35)} | Cantidad: ${count}`);
                }
            } catch (err) {
                console.log(`Error leyendo tabla ${tableName}:`, err.message);
            }
        }
    } catch (e) {
        console.error('Error:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
