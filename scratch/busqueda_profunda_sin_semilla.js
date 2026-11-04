const { Pool } = require('pg');
const pool = new Pool({
    host: 'localhost',
    user: 'postgres',
    password: 'ta3Mionga',
    database: 'etiquetas'
});

async function findSinSemillaExact() {
    console.log('🔍 Buscando "sin semilla" en public.articulos y public.bunker_articulos...');
    
    const legacyArt = await pool.query(`
        SELECT *
        FROM public.articulos
        WHERE descripcion ILIKE '%semilla%' OR descripcion ILIKE '%pasas%'
        LIMIT 10
    `);
    console.log('legacy articulos con pasas o semilla:', legacyArt.rows.map(r => ({ numero: r.articulo_numero || r.id, desc: r.descripcion })));

    const legacyDict = await pool.query(`
        SELECT id, termino, abreviatura, categoria
        FROM public.bunker_diccionario
        WHERE termino ILIKE '%sin%' OR termino ILIKE '%pasas%' OR termino ILIKE '%semilla%'
    `);
    console.log('bunker_diccionario registros:', legacyDict.rows);

    pool.end();
}

findSinSemillaExact().catch(console.error);
