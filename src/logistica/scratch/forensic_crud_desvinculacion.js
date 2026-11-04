const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function runForensicCRUD() {
    console.log('🔍 ====================================================================');
    console.log('🔍 AUDITORÍA FORENSE CRUD: INSPECCIÓN DE RELACIONES Y ATRIBUTOS PRINCIPALES');
    console.log('🔍 ====================================================================\n');

    const client = await pool.connect();
    try {
        // 1. Buscar la familia Produccion
        const famRes = await client.query(`SELECT id, nombre FROM public.bunker_familias WHERE LOWER(nombre) LIKE '%producc%';`);
        console.log('Familias que coinciden con Producción:', famRes.rows);

        const famIds = famRes.rows.map(f => f.id);

        // 2. Buscar todas las filas en bunker_relacion_atributo_principal para Producción o terminos tipo Externa / Interna
        const relRes = await client.query(`
            SELECT id, familia_id, articulo_principal_id, articulo_principal_texto, termino_id, termino_texto, categoria
            FROM public.bunker_relacion_atributo_principal
            WHERE familia_id = ANY($1) 
               OR LOWER(articulo_principal_texto) LIKE '%externa%'
               OR LOWER(articulo_principal_texto) LIKE '%interna%'
               OR LOWER(termino_texto) LIKE '%externa%'
               OR LOWER(termino_texto) LIKE '%interna%'
        `, [famIds.length > 0 ? famIds : [0]]);

        console.log(`\nFilas en bunker_relacion_atributo_principal (${relRes.rows.length} filas):`);
        console.table(relRes.rows);

        // 3. Inspeccionar el termino_id en bunker_diccionario para Externa / Interna
        const dictRes = await client.query(`
            SELECT id, termino, categoria
            FROM public.bunker_diccionario
            WHERE LOWER(termino) IN ('externa', 'interna')
        `);
        console.log('\nRegistros en bunker_diccionario:', dictRes.rows);

    } catch (err) {
        console.error('❌ Error en auditoría forense CRUD:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

runForensicCRUD();
