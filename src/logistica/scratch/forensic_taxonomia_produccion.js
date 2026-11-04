const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function runForensicTaxonomia() {
    console.log('🔍 ====================================================================');
    console.log('🔍 AUDITORÍA FORENSE TAXONOMÍA: INSPECCIÓN DE bunker_familia_categorias');
    console.log('🔍 ====================================================================\n');

    const client = await pool.connect();
    try {
        // 1. Buscar la familia Produccion ID
        const famRes = await client.query(`SELECT id, nombre FROM public.bunker_familias WHERE LOWER(nombre) LIKE '%producc%';`);
        console.log('Familia Producción:', famRes.rows);
        const famId = famRes.rows[0].id;

        // 2. Buscar categorias de la familia Produccion en bunker_familia_categorias
        const taxRes = await client.query(`
            SELECT id, familia_id, categoria, orden_posicional
            FROM public.bunker_familia_categorias
            WHERE familia_id = $1
            ORDER BY orden_posicional ASC;
        `, [famId]);

        console.log(`\nCategorías de la Familia ${famId} (Producción) en bunker_familia_categorias (${taxRes.rows.length} filas):`);
        console.table(taxRes.rows);

    } catch (err) {
        console.error('❌ Error en auditoría forense taxonomía:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

runForensicTaxonomia();
