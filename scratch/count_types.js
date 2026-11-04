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
        console.log('--- RESUMEN DE COMPROBANTES POR TIPO ---');
        const tipoRes = await client.query(`
            SELECT tipo_comprobante, COUNT(*) 
            FROM presupuestos 
            GROUP BY tipo_comprobante 
            ORDER BY count DESC
        `);
        console.table(tipoRes.rows);

        console.log('--- RESUMEN DE COMPROBANTES POR ESTADO ---');
        const estadoRes = await client.query(`
            SELECT estado, COUNT(*) 
            FROM presupuestos 
            GROUP BY estado 
            ORDER BY count DESC
        `);
        console.table(estadoRes.rows);

        console.log('--- EJEMPLOS DE ORDEN DE RETIRO O ADMINISTRATIVA NC ---');
        const ejRes = await client.query(`
            SELECT id_presupuesto_ext, id_cliente, fecha, tipo_comprobante, estado 
            FROM presupuestos 
            WHERE estado = 'Administrativa NC' OR tipo_comprobante = 'Orden de Retiro'
            LIMIT 10
        `);
        console.table(ejRes.rows);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
