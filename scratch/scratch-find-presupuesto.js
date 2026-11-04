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
        console.log('--- BUSCANDO PRESUPUESTO 8234393 EN LA TABLA presupuestos ---');
        const res = await pool.query(`
            SELECT id, id_presupuesto_ext, id_cliente, fecha, tipo_comprobante, estado 
            FROM public.presupuestos 
            WHERE id = 8234393 
               OR id_presupuesto_ext = 'mq9uoy3d-a5608'
               OR id_presupuesto_ext ILIKE '%mq9uoy3d%';
        `);
        console.log('Resultados:');
        console.log(JSON.stringify(res.rows, null, 2));

        if (res.rows.length > 0) {
            const presId = res.rows[0].id;
            console.log(`\n--- DETALLES DEL PRESUPUESTO ID: ${presId} ---`);
            const detRes = await pool.query(`
                SELECT id, id_presupuesto_ext, articulo, cantidad, precio1 
                FROM public.presupuestos_detalles 
                WHERE id_presupuesto = $1;
            `, [presId]);
            console.table(detRes.rows);
        }

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
