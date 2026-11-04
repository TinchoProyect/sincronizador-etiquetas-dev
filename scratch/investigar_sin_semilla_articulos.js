const { Pool } = require('pg');
const pool = new Pool({
    host: 'localhost',
    user: 'postgres',
    password: 'ta3Mionga',
    database: 'etiquetas'
});

async function checkArticulosSinSemilla() {
    console.log('🔍 Buscando "semilla" en bunker_articulos...');
    const res = await pool.query(`
        SELECT articulo_id, descripcion, propiedades_dinamicas
        FROM public.bunker_articulos
        WHERE LOWER(descripcion) LIKE '%semilla%' OR propiedades_dinamicas::text ILIKE '%semilla%'
    `);
    console.log(`Artículos con "semilla" (${res.rows.length}):`, res.rows);

    const resRel = await pool.query(`
        SELECT * FROM public.bunker_relacion_atributo_principal LIMIT 5
    `);
    console.log('Columnas de bunker_relacion_atributo_principal:', Object.keys(resRel.rows[0] || {}));

    pool.end();
}

checkArticulosSinSemilla().catch(console.error);
