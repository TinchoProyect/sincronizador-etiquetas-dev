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
        console.log('=== BUDGET HEADER 8234475 ===');
        const resHeader = await client.query(`
            SELECT id, id_presupuesto_ext, id_cliente, fecha, agente, usar_precios_bunker, descuento 
            FROM public.presupuestos 
            WHERE id = 8234475;
        `);
        console.log(JSON.stringify(resHeader.rows, null, 2));

        console.log('\n=== DETAILS 8234475 (raw columns) ===');
        const resDetails = await client.query(`
            SELECT id, articulo, cantidad, valor1, precio1, iva1
            FROM public.presupuestos_detalles 
            WHERE id_presupuesto = 8234475;
        `);
        console.log(JSON.stringify(resDetails.rows, null, 2));

        console.log('\n=== RUNNING BACKEND CONTROLLER QUERY ===');
        const resQuery = await client.query(`
            SELECT 
                pd.id,
                pd.articulo,
                COALESCE(ba.descripcion_generada, ba.descripcion, a.nombre, pd.articulo) as descripcion_articulo
            FROM public.presupuestos_detalles pd
            LEFT JOIN public.articulos a ON (a.codigo_barras = pd.articulo OR a.numero = pd.articulo)
            LEFT JOIN public.bunker_articulos ba ON (ba.articulo_id = pd.articulo OR ba.articulo_id = a.numero)
            WHERE pd.id_presupuesto = 8234475;
        `);
        console.log(JSON.stringify(resQuery.rows, null, 2));

    } catch (err) {
        console.error(err);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
