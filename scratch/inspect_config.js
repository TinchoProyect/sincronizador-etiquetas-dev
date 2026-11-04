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
        console.log('--- REVISANDO CONFIGURACIÓN EN presupuestos_config ---');
        const configRes = await client.query('SELECT * FROM presupuestos_config');
        console.log('Filas encontradas:', configRes.rows.length);
        console.table(configRes.rows);
        
        console.log('--- ESTRUCTURA DE LA TABLA presupuestos ---');
        const colsRes = await client.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'presupuestos'
            ORDER BY ordinal_position;
        `);
        console.table(colsRes.rows);

        console.log('--- ESTRUCTURA DE LA TABLA presupuestos_config ---');
        const colsConfigRes = await client.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'presupuestos_config'
            ORDER BY ordinal_position;
        `);
        console.table(colsConfigRes.rows);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
