const { pool } = require('../config/database');

async function diag() {
    try {
        console.log('--- DIAGNÓSTICO INCIDENTE DÁTIL / FRUTAS DISECADAS / FRUTOS SECOS ---');

        // 1. Obtener familias de producto (Nivel 1)
        const resFam = await pool.query("SELECT id, nombre FROM public.bunker_familias ORDER BY id ASC");
        console.log('\n1. Familias de Producto en DB:', resFam.rows);

        // 2. Buscar relaciones de 'articulo_principal' para Frutas Disecadas (id=3) y Frutos Secos (id=1) o cualquier familia
        const resRel = await pool.query(`
            SELECT r.id, r.familia_id, f.nombre as familia_nombre, r.articulo_principal_id, d.termino, r.categoria
            FROM public.bunker_relacion_atributo_principal r
            JOIN public.bunker_familias f ON f.id = r.familia_id
            JOIN public.bunker_diccionario d ON d.id = r.articulo_principal_id
            WHERE r.categoria = 'articulo_principal'
            ORDER BY f.id, d.termino ASC
        `);
        console.log('\n2. Artículos Principales Vinculados por Familia (bunker_relacion_atributo_principal):');
        console.table(resRel.rows);

        // 3. Buscar 'dátil', 'datil', 'ciruela', 'higo', 'pasas' en bunker_diccionario
        const resDict = await pool.query(`
            SELECT id, termino, abreviatura, categoria, en_revision, obsoleto
            FROM public.bunker_diccionario
            WHERE termino ILIKE '%datil%' OR termino ILIKE '%dátil%' OR termino ILIKE '%ciruela%' OR termino ILIKE '%higo%' OR termino ILIKE '%pasas%'
            ORDER BY id ASC
        `);
        console.log('\n3. Búsqueda de términos (dátil, ciruela, higo, pasas) en bunker_diccionario:');
        console.table(resDict.rows);

        // 4. Ver si hay términos en bunker_diccionario con descripciones completas o contaminadas
        const resContam = await pool.query(`
            SELECT COUNT(*) as total_terminos,
                   COUNT(CASE WHEN categoria = 'articulo_principal' THEN 1 END) as articulos_principales,
                   COUNT(CASE WHEN termino ILIKE '%/%' OR termino ILIKE '%x%' OR termino ILIKE '%27%' THEN 1 END) as descripciones_catalogos
            FROM public.bunker_diccionario
            WHERE obsoleto IS NOT TRUE
        `);
        console.log('\n4. Estadísticas globales de bunker_diccionario:', resContam.rows[0]);

        process.exit(0);
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
}

diag();
