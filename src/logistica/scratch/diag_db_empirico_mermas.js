require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function runEmpiricalQuery() {
    const client = await pool.connect();
    try {
        console.log('🔍 1. Consultando relación para BFX50G / BFXUNI en articulos_produccion_externa_relacion...');
        const resRel = await client.query(`
            SELECT * FROM public.articulos_produccion_externa_relacion
            WHERE articulo_kilo_codigo IN ('BFX50G', 'BFXUNI') OR articulo_produccion_codigo IN ('BFX50G', 'BFXUNI', 'BFXP')
        `);
        console.log('Filas relacionales encontradas:', resRel.rows);

        console.log('\n🔍 2. Consultando produccion_externa_historial con la consulta de triangulación propuesta para BFX50G...');
        const queryProposed = `
            SELECT 
                peh.id,
                peh.carro_id,
                peh.fecha_registro,
                COALESCE(peh.kilos_entrada, peh.ingredientes_sumados) AS kilos_entrada,
                COALESCE(peh.kilos_salida, peh.kilos_producidos) AS kilos_salida,
                peh.porcentaje_merma,
                peh.articulo_padre_id,
                peh.articulo_fraccionado_id
            FROM public.produccion_externa_historial peh
            LEFT JOIN public.articulos_produccion_externa_relacion rel 
                ON (rel.articulo_kilo_codigo = $1 OR rel.articulo_produccion_codigo = $1)
            WHERE (
                peh.articulo_padre_id = $1 
                OR peh.articulo_fraccionado_id = $1
                OR peh.articulo_padre_id = rel.articulo_produccion_codigo
                OR peh.articulo_padre_id = rel.articulo_kilo_codigo
                OR peh.articulo_fraccionado_id = rel.articulo_produccion_codigo
                OR peh.articulo_fraccionado_id = rel.articulo_kilo_codigo
            )
            ORDER BY peh.fecha_registro DESC
            LIMIT 10;
        `;
        const resProposed = await client.query(queryProposed, ['BFX50G']);
        console.log(`Filas devueltas por triangulación (${resProposed.rows.length}):`, resProposed.rows);

        console.log('\n🔍 3. Consultando TODAS las filas en produccion_externa_historial para auditar el universo completo...');
        const resAllHist = await client.query(`
            SELECT id, carro_id, articulo_padre_id, articulo_fraccionado_id, kilos_entrada, kilos_salida, kilos_producidos, porcentaje_merma, fecha_registro
            FROM public.produccion_externa_historial
            ORDER BY fecha_registro DESC
            LIMIT 20;
        `);
        console.log('Universo en produccion_externa_historial (count):', resAllHist.rows.length);
        console.log('Filas produccion_externa_historial:', resAllHist.rows);

    } catch (err) {
        console.error('Error in runEmpiricalQuery:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

runEmpiricalQuery();
