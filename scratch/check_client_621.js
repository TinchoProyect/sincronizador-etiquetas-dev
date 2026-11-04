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
        console.log('--- BUSCANDO PRESUPUESTOS DE CLIENTE 621 ---');
        const res = await client.query(`
            SELECT id, id_presupuesto_ext, id_cliente, fecha, tipo_comprobante, estado 
            FROM presupuestos 
            WHERE id_cliente = '621'
            ORDER BY fecha DESC;
        `);
        console.log('Filas encontradas:', res.rows.length);
        console.table(res.rows);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
