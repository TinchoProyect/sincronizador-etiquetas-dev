const { Pool } = require('pg');
const pool = new Pool({
    host: 'localhost',
    user: 'postgres',
    password: 'ta3Mionga',
    database: 'etiquetas'
});

async function checkSinSemilla() {
    console.log('🔍 Investigando termino "sin semilla" en bunker_diccionario...');
    const res = await pool.query(`
        SELECT id, termino, abreviatura, categoria, en_revision, obsoleto 
        FROM public.bunker_diccionario 
        WHERE LOWER(termino) LIKE '%semilla%' OR LOWER(termino) LIKE '%pasas%'
    `);
    console.log('Resultados en bunker_diccionario:', res.rows);

    const resRel = await pool.query(`
        SELECT r.*, f.nombre as familia_nombre
        FROM public.bunker_relacion_atributo_principal r
        LEFT JOIN public.bunker_familias f ON r.familia_id = f.id
        WHERE LOWER(r.termino_secundario) LIKE '%semilla%'
    `);
    console.log('Resultados en bunker_relacion_atributo_principal:', resRel.rows);

    pool.end();
}

checkSinSemilla().catch(console.error);
