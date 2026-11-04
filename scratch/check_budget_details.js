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
        console.log('--- BUSCANDO EL PRESUPUESTO mobf7bcl-eyro2 ---');
        const presRes = await client.query(`
            SELECT id, id_presupuesto_ext, id_cliente, fecha, tipo_comprobante, estado 
            FROM presupuestos 
            WHERE id_presupuesto_ext = 'mobf7bcl-eyro2';
        `);
        console.table(presRes.rows);

        if (presRes.rows.length > 0) {
            const presId = presRes.rows[0].id;
            console.log(`--- DETALLES DEL PRESUPUESTO LOCAL ID: ${presId} ---`);
            const detRes = await client.query(`
                SELECT id, id_presupuesto_ext, articulo, cantidad, precio1 
                FROM presupuestos_detalles 
                WHERE id_presupuesto = $1;
            `, [presId]);
            console.table(detRes.rows);
        }
    } catch (e) {
        console.error('Error:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
