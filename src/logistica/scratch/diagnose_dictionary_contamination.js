const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function diagnoseContamination() {
    const client = await pool.connect();
    try {
        console.log('=== 🔍 DIAGNÓSTICO EMPÍRICO PROFUNDO: ANÁLISIS DE REGISTROS EN DICCIONARIO ===\n');

        const resPrincipales = await client.query(`
            SELECT id, termino, abreviatura, categoria, obsoleto
            FROM public.bunker_diccionario
            WHERE LOWER(TRIM(categoria)) = 'articulo_principal'
              AND obsoleto IS NOT TRUE
            ORDER BY termino ASC
        `);

        console.log(`1. Total de registros con categoria = 'articulo_principal': ${resPrincipales.rows.length}`);
        console.table(resPrincipales.rows.slice(0, 40));

        console.log('\n2. Términos vinculados relacionalmente en bunker_relacion_atributo_principal:');
        const resVinculados = await client.query(`
            SELECT r.id as rel_id, r.familia_id, f.nombre as familia_nombre, d.id as term_id, d.termino, d.categoria
            FROM public.bunker_relacion_atributo_principal r
            JOIN public.bunker_diccionario d ON r.articulo_principal_id = d.id OR r.termino_id = d.id
            LEFT JOIN public.bunker_familias f ON r.familia_id = f.id
            WHERE r.categoria = 'articulo_principal'
            ORDER BY f.nombre ASC, d.termino ASC
        `);
        console.table(resVinculados.rows);

    } catch (err) {
        console.error('Error en diagnóstico:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

diagnoseContamination();
