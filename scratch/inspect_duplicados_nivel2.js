const { Pool } = require('pg');
const pool = new Pool({
    host: 'localhost',
    user: 'postgres',
    password: 'ta3Mionga',
    database: 'etiquetas'
});

async function inspectDuplicates() {
    console.log('🔍 [DIAGNÓSTICO DETERMINISTA] Investigando duplicados en Nivel 2...');

    // 1. Términos duplicados en bunker_diccionario (case-insensitive)
    console.log('\n--- 1. Duplicados en bunker_diccionario (LOWER(termino)) ---');
    const resDictDup = await pool.query(`
        SELECT LOWER(termino) as termino_lower, COUNT(*) as cantidad, array_agg(id) as ids, array_agg(termino) as terminos, array_agg(abreviatura) as abreviaturas, array_agg(categoria) as categorias
        FROM public.bunker_diccionario
        GROUP BY LOWER(termino)
        HAVING COUNT(*) > 1
    `);
    console.table(resDictDup.rows);

    // 2. Registros específicos de Almendra / ALMENDRA en bunker_diccionario
    console.log('\n--- 2. Registros de "Almendra" en bunker_diccionario ---');
    const resAlm = await pool.query(`
        SELECT id, termino, abreviatura, categoria, en_revision, obsoleto
        FROM public.bunker_diccionario
        WHERE termino ILIKE '%almendra%'
    `);
    console.table(resAlm.rows);

    // 3. Registros de relaciones en bunker_relacion_atributo_principal para Familia 1 (o Frutos Secos)
    console.log('\n--- 3. Relaciones Nivel 2 en bunker_relacion_atributo_principal para "Almendra" ---');
    const resRelAlm = await pool.query(`
        SELECT r.id, r.familia_id, f.nombre as familia_nombre, r.articulo_principal_id, r.articulo_principal_texto, r.termino_id, r.termino_texto, r.categoria
        FROM public.bunker_relacion_atributo_principal r
        LEFT JOIN public.bunker_familias f ON f.id = r.familia_id
        WHERE r.articulo_principal_texto ILIKE '%almendra%' OR r.termino_texto ILIKE '%almendra%'
    `);
    console.table(resRelAlm.rows);

    // 4. Duplicados en bunker_relacion_atributo_principal por familia y termino_texto
    console.log('\n--- 4. Duplicados en bunker_relacion_atributo_principal (familia_id + LOWER(articulo_principal_texto)) ---');
    const resRelDup = await pool.query(`
        SELECT familia_id, LOWER(articulo_principal_texto) as princ_lower, COUNT(*) as cantidad, array_agg(id) as ids, array_agg(articulo_principal_texto) as textos, array_agg(articulo_principal_id) as term_ids
        FROM public.bunker_relacion_atributo_principal
        GROUP BY familia_id, LOWER(articulo_principal_texto)
        HAVING COUNT(*) > 1
    `);
    console.table(resRelDup.rows);

    pool.end();
}

inspectDuplicates().catch(console.error);
