const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function diagnoseMix() {
    const client = await pool.connect();
    try {
        console.log('=== 🔍 DIAGNÓSTICO EMPÍRICO: BÚSQUEDA DE "MIX" EN DICCIONARIO ===\n');

        const resMix = await client.query(`
            SELECT id, termino, abreviatura, categoria, en_revision, obsoleto
            FROM public.bunker_diccionario
            WHERE termino ILIKE '%mix%'
        `);
        console.log('1. Términos que contienen "mix" en public.bunker_diccionario:');
        console.table(resMix.rows);

        const resAllCat = await client.query(`
            SELECT categoria, count(*)::int as total
            FROM public.bunker_diccionario
            GROUP BY categoria
            ORDER BY total DESC
        `);
        console.log('\n2. Distribución de Categorías en public.bunker_diccionario:');
        console.table(resAllCat.rows);

        const resGeneral = await client.query(`
            SELECT id, termino, abreviatura, categoria
            FROM public.bunker_diccionario
            WHERE categoria = 'general' OR categoria IS NULL
            LIMIT 15
        `);
        console.log('\n3. Muestra de Términos con Categoria "general" o NULL (que se cuelan en el desplegable):');
        console.table(resGeneral.rows);

    } catch (err) {
        console.error('Error en diagnóstico empírico:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

diagnoseMix();
