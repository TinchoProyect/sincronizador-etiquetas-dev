const { Pool } = require('pg');
const pool = new Pool({
    host: 'localhost',
    user: 'postgres',
    password: 'ta3Mionga',
    database: 'etiquetas'
});

async function deepSearchSemilla() {
    console.log('🔍 [BÚSQUEDA PROFUNDA DE BD] Buscando todas las ocurrencias de "%semilla%" en tablas PostgreSQL...');

    // 1. Buscar en bunker_diccionario
    const dictRes = await pool.query(`
        SELECT id, termino, abreviatura, categoria, en_revision, obsoleto 
        FROM public.bunker_diccionario 
        WHERE termino ILIKE '%semilla%' OR abreviatura ILIKE '%semilla%'
    `);
    console.log('1. Ocurrencias en bunker_diccionario:', dictRes.rows);

    // 2. Buscar en bunker_relacion_atributo_principal
    const relRes = await pool.query(`
        SELECT * FROM public.bunker_relacion_atributo_principal 
        WHERE termino_texto ILIKE '%semilla%' OR articulo_principal_texto ILIKE '%semilla%'
    `);
    console.log('2. Ocurrencias en bunker_relacion_atributo_principal:', relRes.rows);

    // 3. Buscar en bunker_articulos
    const artRes = await pool.query(`
        SELECT articulo_id, descripcion, propiedades_dinamicas 
        FROM public.bunker_articulos 
        WHERE descripcion ILIKE '%semilla%' OR propiedades_dinamicas::text ILIKE '%semilla%'
    `);
    console.log('3. Ocurrencias en bunker_articulos:', artRes.rows.length);

    // 4. Buscar en todas las demas tablas públicas
    const tablesRes = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
    `);
    console.log('Tablas públicas encontradas:', tablesRes.rows.map(r => r.table_name));

    for (const row of tablesRes.rows) {
        const table = row.table_name;
        try {
            const checkText = await pool.query(`
                SELECT count(*) as total 
                FROM public.${table} 
                WHERE CAST(row_to_json(${table}) AS text) ILIKE '%semilla%'
            `);
            if (parseInt(checkText.rows[0].total) > 0) {
                console.log(`✨ Coincidencia en tabla public.${table}: ${checkText.rows[0].total} registros`);
            }
        } catch(e) {
            // Ignorar tablas sin filas o tipos binarios
        }
    }

    pool.end();
}

deepSearchSemilla().catch(console.error);
