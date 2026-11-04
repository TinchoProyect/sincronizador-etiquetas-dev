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
        console.log('--- ÚLTIMOS 15 PRESUPUESTOS REGISTRADOS ---');
        const res = await client.query(`
            SELECT id, id_presupuesto_ext, id_cliente, fecha, tipo_comprobante, estado, fecha_actualizacion 
            FROM budgets 
            ORDER BY fecha DESC, id DESC
            LIMIT 15;
        `);
        console.table(res.rows);
    } catch (e) {
        // Try tables presupuestos instead of budgets
        try {
            const res = await client.query(`
                SELECT id, id_presupuesto_ext, id_cliente, fecha, tipo_comprobante, estado, fecha_actualizacion 
                FROM presupuestos 
                ORDER BY fecha DESC, id DESC
                LIMIT 15;
            `);
            console.table(res.rows);
        } catch (err) {
            console.error('Error:', err);
        }
    } finally {
        client.release();
        await pool.end();
    }
}

run();
