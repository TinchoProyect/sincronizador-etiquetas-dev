const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function diagLegacyMutation2() {
    try {
        console.log('=== 🔍 DIAGNÓSTICO FORENSE 2: BÚSQUEDA DE DESCRIPCIONES EN BD ===\n');

        // 1. Buscar términos similares a "granasol" o "tanda" o "GSGN"
        console.log('1. Buscando descripciones con "grana" o "tanda" en public.stock_real_consolidado...');
        const resCons = await pool.query(`
            SELECT articulo_numero, descripcion, codigo_barras 
            FROM public.stock_real_consolidado 
            WHERE descripcion ILIKE '%grana%' OR descripcion ILIKE '%tanda%' OR articulo_numero ILIKE '%GSGN%'
        `);
        console.table(resCons.rows);

        // 2. Buscar en public.bunker_articulos
        console.log('\n2. Buscando en public.bunker_articulos...');
        const resBunker = await pool.query(`
            SELECT articulo_id, descripcion, descripcion_generada, codigo_barras, propiedades_dinamicas 
            FROM public.bunker_articulos 
            WHERE descripcion ILIKE '%grana%' OR articulo_id ILIKE '%GSGN%'
        `);
        console.table(resBunker.rows);

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

diagLegacyMutation2();
