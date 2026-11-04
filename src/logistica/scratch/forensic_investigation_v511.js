const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function runForensicV511() {
    console.log('🔍 ====================================================================');
    console.log('🔍 AUDITORÍA FORENSE READ-ONLY DE INCIDENCIAS CRÍTICAS (v5.11)');
    console.log('🔍 ====================================================================\n');

    const client = await pool.connect();
    try {
        // 1. Auditar categorías registradas en bunker_familia_categorias
        console.log('1. Categorías registradas en bunker_familia_categorias:');
        const catMasterRes = await client.query(`
            SELECT familia_id, categoria, orden_posicional
            FROM public.bunker_familia_categorias
            ORDER BY familia_id, orden_posicional ASC
        `);
        catMasterRes.rows.forEach(r => {
            console.log(`   - Familia ID ${r.familia_id}: Categoria = "${r.categoria}" (Posición ${r.orden_posicional})`);
        });

        // 2. Auditar valores distintos de 'categoria' en bunker_relacion_atributo_principal
        console.log('\n2. Categorías presentes en bunker_relacion_atributo_principal:');
        const relCatRes = await client.query(`
            SELECT DISTINCT familia_id, categoria, COUNT(*) as count
            FROM public.bunker_relacion_atributo_principal
            GROUP BY familia_id, categoria
            ORDER BY familia_id, categoria ASC
        `);
        relCatRes.rows.forEach(r => {
            console.log(`   - Familia ID ${r.familia_id}: Categoria = "${r.categoria}" (${r.count} relaciones)`);
        });

        // 3. Inspeccionar Atributo Principal 951
        console.log('\n3. Inspección del Atributo Principal 951:');
        const princ951Res = await client.query(`
            SELECT r.id, r.familia_id, r.articulo_principal_id, r.articulo_principal_texto, r.termino_id, r.termino_texto, r.categoria
            FROM public.bunker_relacion_atributo_principal r
            WHERE r.articulo_principal_id = 951 OR r.termino_id = 951
        `);
        if (princ951Res.rows.length === 0) {
            console.log('   - No se encontraron relaciones para ID 951 en bunker_relacion_atributo_principal.');
        } else {
            princ951Res.rows.forEach(r => {
                console.log(`   - Relación ID ${r.id}: Principal="${r.articulo_principal_texto}" (${r.articulo_principal_id}), Término="${r.termino_texto}" (${r.termino_id}), Categoría en BD="${r.categoria}"`);
            });
        }

        // 4. Inspeccionar el término 'Nombre fantasía' vs 'nom. Fantasía' en bunker_diccionario y bunker_relacion_atributo_principal
        console.log('\n4. Discrepancias de Nombres de Categoría en bunker_diccionario y relaciones:');
        const dictCatRes = await client.query(`
            SELECT id, termino, categoria, abreviatura
            FROM public.bunker_diccionario
            WHERE LOWER(categoria) LIKE '%fantasi%' OR LOWER(termino) LIKE '%fantasi%'
        `);
        dictCatRes.rows.forEach(r => {
            console.log(`   - Diccionario ID ${r.id}: Término="${r.termino}", Categoria="${r.categoria}", Abrev="${r.abreviatura}"`);
        });

    } catch (err) {
        console.error('❌ Error en auditoría forense read-only:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

runForensicV511();
